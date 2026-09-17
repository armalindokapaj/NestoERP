import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { closeReservation, expireReservedProfile, notifyReservation, recordStatusChange, reservationAudience } from "./unit-sales.core";
import { cancelSaleApprovals } from "./unit-sale-approval.service";

/**
 * Job `sales.unit-reservations` (E-05E §25, §51, §52): every few minutes, an
 * ACTIVE reservation past its expiry becomes EXPIRED and its unit For Sale again;
 * one about to expire within a day tells the salesperson and the deal owner once
 * per expiry date.
 *
 * The same rules a person's release follows, acting as the system: the reservation
 * closes only while still active and already expired, the unit moves only from
 * Reserved, both in one transaction with the status trail, the audit event and the
 * notice. A second run finds nothing to do; an extension made a moment before the
 * job reached the row leaves it alone (PRD #51 §30-§36).
 *
 * A unit under a live contract is not released by the clock (E-05F §8): its
 * reservation is neither expired nor warned about until Legal cancels or
 * terminates the contract. A reservation that expires takes its pending sale
 * approval with it (E-05F §42).
 */

export const JOB = "sales.unit-reservations";
const BATCH = 100;
const DAY = 86_400_000;

const ROW = {
  id: true,
  unitId: true,
  expiresAt: true,
  opportunityId: true,
  createdByMemberId: true,
  opportunity: { select: { ownerMemberId: true } },
  unit: { select: { unitCode: true, projectId: true, project: { select: { name: true } } } },
} as const;

type Row = { id: string; unitId: string; expiresAt: Date; opportunityId: string; createdByMemberId: string; opportunity: { ownerMemberId: string }; unit: { unitCode: string; projectId: string; project: { name: string } } };

async function expireOne(companyId: string, row: Row, now: Date): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Re-read under the transaction: a contract drafted a moment ago keeps the unit (E-05F §8).
    if (await tx.contractUnit.findFirst({ where: { companyId, unitId: row.unitId, releasedAt: null }, select: { id: true } })) return false;
    if (!(await closeReservation(tx, { companyId, reservationId: row.id, status: "EXPIRED", closedByMemberId: null, reason: null, expiredBefore: now }))) return false;
    await cancelSaleApprovals(tx, null, companyId, row.unitId);
    const profile = await tx.unitCommercialProfile.findFirst({ where: { companyId, unitId: row.unitId }, select: { id: true, companyId: true, status: true } });
    if (profile?.status === "RESERVED" && (await expireReservedProfile(tx, profile))) {
      await recordStatusChange(tx, { companyId, projectId: row.unit.projectId, unitId: row.unitId, from: "RESERVED", to: "FOR_SALE", source: "SYSTEM_EXPIRY", actorMemberId: null, reservationId: row.id, opportunityId: row.opportunityId });
    }
    await recordSystemAction(
      companyId,
      {
        actionKey: AuditAction.UNIT_RESERVATION_EXPIRED,
        entity: { type: "ProjectUnit", id: row.unitId, label: row.unit.unitCode },
        projectId: row.unit.projectId,
        before: { status: "RESERVED", reservationStatus: "ACTIVE", expiresAt: row.expiresAt.toISOString() },
        after: { status: "FOR_SALE", reservationId: row.id, reservationStatus: "EXPIRED" },
      },
      { tx },
    );
    if (await claimIdempotencyKey(tx, { companyId, jobKey: JOB, key: `expired:${row.id}` })) {
      await notifyReservation(tx, { eventType: NotificationEvent.UNIT_RESERVATION_EXPIRED, companyId, unit: { id: row.unitId, unitCode: row.unit.unitCode, projectId: row.unit.projectId, projectName: row.unit.project.name }, reservationId: row.id, memberIds: reservationAudience(row), actorMemberId: null, expiresAt: row.expiresAt });
    }
    return true;
  });
}

async function warnOne(companyId: string, row: Row): Promise<boolean> {
  const claim = { companyId, jobKey: JOB, key: `expiring:${row.id}:${row.expiresAt.toISOString()}` };
  if (await idempotencyKeyClaimed(prisma, claim)) return false;
  return prisma.$transaction(async (tx) => {
    // Bound to the expiry the warning is about: an extension in between earns its own.
    const marked = await tx.unitReservation.updateMany({ where: { id: row.id, companyId, status: "ACTIVE", expiresAt: row.expiresAt, expiryWarnedAt: null }, data: { expiryWarnedAt: new Date() } });
    if (!marked.count || !(await claimIdempotencyKey(tx, claim))) return false;
    const hours = Math.max(1, Math.round((row.expiresAt.getTime() - Date.now()) / 3_600_000));
    await notifyReservation(tx, { eventType: NotificationEvent.UNIT_RESERVATION_EXPIRING, companyId, unit: { id: row.unitId, unitCode: row.unit.unitCode, projectId: row.unit.projectId, projectName: row.unit.project.name }, reservationId: row.id, memberIds: reservationAudience(row), actorMemberId: null, expiresAt: row.expiresAt, whenLabel: `in about ${hours} ${hours === 1 ? "hour" : "hours"}` });
    return true;
  });
}

export async function runUnitReservationExpiry(now = new Date()): Promise<{ expired: number; warned: number }> {
  const counts = { expired: 0, warned: 0 };
  const run = await forEachCompany(
    JOB,
    async ({ companyId }) => {
      let failed = 0;
      const pass = async (where: object, settle: (row: Row) => Promise<boolean>, count: "expired" | "warned", idKey: string) => {
        for (let after: string | undefined; !jobStopRequested(); ) {
          const rows = (await prisma.unitReservation.findMany({ where: { companyId, status: "ACTIVE", unit: { is: { contractLinks: { none: { releasedAt: null } } } }, ...where, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: BATCH, select: ROW })) as Row[];
          for (const row of rows) {
            try {
              if (await settle(row)) counts[count] += 1;
            } catch (error) {
              failed += 1;
              logger.error(`${JOB}.item_failed`, { companyId, [idKey]: row.id, ...serialiseError(error) });
            }
          }
          if (rows.length < BATCH) break;
          after = rows[rows.length - 1]!.id;
        }
      };
      await pass({ expiresAt: { lte: now } }, (row) => expireOne(companyId, row, now), "expired", "reservationId");
      await pass({ expiresAt: { gt: now, lte: new Date(now.getTime() + DAY) }, expiryWarnedAt: null }, (row) => warnOne(companyId, row), "warned", "reservationId");
      if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} unit reservations could not be settled`);
    },
    { moduleKey: "projects" },
  );
  if (counts.expired) incrementCounter(Metric.UNIT_RESERVATIONS_EXPIRED, {}, counts.expired);
  if (counts.warned) incrementCounter(Metric.UNIT_RESERVATIONS_WARNED, {}, counts.warned);
  assertEveryCompanySucceeded(JOB, run);
  return counts;
}
