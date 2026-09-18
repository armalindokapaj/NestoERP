import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";
import type { PlacementDoor } from "@/lib/modules/team/team.placement";
import { performChange } from "./employment.change.service";
import { dayOf, dbDay, todayDay } from "./employment.dates";
import { lockEmployment } from "./employment.history";
import { changeTypeLabels } from "./employment.labels";
import { employmentChangeSchema } from "./employment.schema";

/**
 * Job `hr.employment-changes` (E-03 §153-§157, §208-§210; PRD #51).
 *
 * Every scheduled employment change whose day has come is applied once, as it
 * would have been by hand on that day: the same service, the same rules, the
 * history rows dated the change's own effective date — so a run missed for a
 * week applies each overdue change once, on its date (§156). The claim — the
 * change moving from SCHEDULED to APPLIED — commits with the change itself, so
 * a second worker, a retry or a rerun finds nothing to do (§155). A change that
 * can no longer apply (its department closed, a later change already in effect)
 * is marked FAILED with why, the person who scheduled it is told, and it is
 * never retried silently (§226). A cancelled change is never read (§210).
 */

export const JOB = "hr.employment-changes";
const BATCH = 100;

type Due = { id: string; employeeProfileId: string; type: string; effectiveDate: Date; payload: Prisma.JsonValue; requestedByUserId: string };

export async function runScheduledEmploymentChanges(now: Date, options: { placement: PlacementDoor }): Promise<{ applied: number; failed: number }> {
  const counts = { applied: 0, failed: 0 };
  const today = todayDay(now);
  const run = await forEachCompany(
    JOB,
    async ({ companyId }) => {
      let broken = 0;
      for (let after: string | undefined; !jobStopRequested(); ) {
        const rows: Due[] = await prisma.employmentChange.findMany({
          where: { companyId, status: "SCHEDULED", effectiveDate: { lte: dbDay(today) }, ...(after ? { id: { gt: after } } : {}) },
          orderBy: { id: "asc" },
          take: BATCH,
          select: { id: true, employeeProfileId: true, type: true, effectiveDate: true, payload: true, requestedByUserId: true },
        });
        // Oldest first within the batch, so two changes to one employment apply in the order they take effect.
        rows.sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime());
        for (const row of rows) {
          try {
            const outcome = await applyOne(companyId, row, options.placement);
            if (outcome === "APPLIED") counts.applied += 1;
            if (outcome === "FAILED") counts.failed += 1;
          } catch (error) {
            broken += 1;
            logger.error(`${JOB}.item_failed`, { companyId, employmentChangeId: row.id, ...serialiseError(error) });
          }
        }
        if (rows.length < BATCH) break;
        after = rows.reduce((max, row) => (row.id > max ? row.id : max), rows[0]!.id);
      }
      if (broken) throw new JobError("PARTIAL_FAILURE", `${broken} scheduled employment changes could not be processed`);
    },
    { moduleKey: "hr" },
  );
  assertEveryCompanySucceeded(JOB, run);
  return counts;
}

async function applyOne(companyId: string, row: Due, placement: PlacementDoor): Promise<"APPLIED" | "FAILED" | "SKIPPED"> {
  const parsed = employmentChangeSchema.safeParse(row.payload);
  if (!parsed.success) return fail(companyId, row, "The scheduled change could not be read.");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockEmployment(tx, row.employeeProfileId);
      const claimed = await tx.employmentChange.updateMany({ where: { id: row.id, companyId, status: "SCHEDULED" }, data: { status: "APPLIED", appliedAt: new Date() } });
      if (claimed.count === 0) return "SKIPPED";
      const employment = await tx.employeeProfile.findFirstOrThrow({
        where: { id: row.employeeProfileId, companyId },
        select: { id: true, companyId: true, companyMemberId: true, personProfileId: true, employmentStatus: true, offboardingStatus: true, personProfile: { select: { firstName: true, lastName: true } } },
      });
      if (employment.employmentStatus === "ENDED") throw new AccessError("CONFLICT", "The employment had already ended.", { code: "ENDED" });
      await performChange(tx, {
        actor: { kind: "system", companyId, onBehalfOfUserId: row.requestedByUserId },
        target: {
          id: employment.id,
          companyId: employment.companyId,
          companyMemberId: employment.companyMemberId,
          personProfileId: employment.personProfileId,
          employmentStatus: employment.employmentStatus,
          offboardingStatus: employment.offboardingStatus,
          name: `${employment.personProfile.firstName} ${employment.personProfile.lastName}`,
        },
        input: parsed.data,
        effective: dayOf(row.effectiveDate),
        source: "SCHEDULED",
        placement,
        targetContext: null,
        scheduledChangeId: row.id,
      });
      await recordSystemAction(
        companyId,
        {
          actionKey: AuditAction.HR_EMPLOYMENT_CHANGE_APPLIED,
          entity: { type: "EmployeeProfile", id: employment.id, label: `${employment.personProfile.firstName} ${employment.personProfile.lastName}` },
          before: { scheduledChangeId: row.id, changeStatus: "SCHEDULED" },
          after: { scheduledChangeId: row.id, changeStatus: "APPLIED", changeType: row.type, effectiveDate: dayOf(row.effectiveDate), requestedByUserId: row.requestedByUserId },
        },
        { tx },
      );
      return "APPLIED" as const;
    });
  } catch (error) {
    // A rule the change breaks today is a failure to report, not to retry (E-03 §226).
    if (error instanceof AccessError) return fail(companyId, row, error.message);
    throw error;
  }
}

async function fail(companyId: string, row: Due, reason: string): Promise<"FAILED" | "SKIPPED"> {
  return prisma.$transaction(async (tx) => {
    const marked = await tx.employmentChange.updateMany({ where: { id: row.id, companyId, status: "SCHEDULED" }, data: { status: "FAILED", failureReason: reason.slice(0, 500) } });
    if (marked.count === 0) return "SKIPPED" as const;
    const employment = await tx.employeeProfile.findFirst({ where: { id: row.employeeProfileId, companyId }, select: { id: true, companyMemberId: true, personProfile: { select: { firstName: true, lastName: true } } } });
    const name = employment ? `${employment.personProfile.firstName} ${employment.personProfile.lastName}` : "an employee";
    await recordSystemAction(
      companyId,
      {
        actionKey: AuditAction.HR_EMPLOYMENT_CHANGE_FAILED,
        entity: { type: "EmployeeProfile", id: row.employeeProfileId, label: name },
        before: { scheduledChangeId: row.id, changeStatus: "SCHEDULED" },
        after: { scheduledChangeId: row.id, changeStatus: "FAILED", changeType: row.type, effectiveDate: dayOf(row.effectiveDate), failureReason: reason.slice(0, 500) },
      },
      { tx },
    );
    const requester = await tx.companyMember.findFirst({ where: { companyId, userId: row.requestedByUserId, status: "ACTIVE" }, select: { id: true } });
    if (requester && employment?.companyMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId,
        eventType: NotificationEvent.EMPLOYMENT_CHANGE_FAILED,
        moduleKey: "hr",
        entityType: "employee",
        entityId: employment.companyMemberId,
        actorMemberId: null,
        payload: { memberIds: [requester.id], change: `${changeTypeLabels[row.type as keyof typeof changeTypeLabels] ?? "Change"} for ${name}`, effectiveDate: dayOf(row.effectiveDate), reason: reason.slice(0, 300) },
      });
    }
    return "FAILED" as const;
  });
}
