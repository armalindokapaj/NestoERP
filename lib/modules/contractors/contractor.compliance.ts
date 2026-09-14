import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction, recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays, daysBetween, localDate } from "@/lib/modules/calendar/calendar.time";
import { filesOpen } from "@/lib/modules/engineering/engineering.permissions";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";
import { at, dateLabel, dateOf, fail, holders, people, personOf } from "@/lib/modules/engineering/engineering.shared";
import { recordActivity } from "@/lib/modules/shared/activity";
import { ACTIVITY_ENTITY, COMPLIANCE_RECORD, contractorsOpen, MODULE, readableComplianceWhere } from "./contractor.permissions";
import type { ComplianceInput, ComplianceListQuery } from "./contractor.schema";
import { findReadableContractor } from "./contractor.service";
import { COMPLIANCE_ALERT_STATUSES, COMPLIANCE_TYPE_LABELS, type ComplianceItemDTO, type ComplianceStatus, type ComplianceType } from "./contractor.types";

/**
 * Contractor compliance (PRD #46 §41-§49, §216, §287).
 *
 * Insurance, licences, guarantees and certificates, each with its evidence as a
 * canonical Document. VALID, EXPIRING and EXPIRED follow from the expiry date
 * and the company's reminder window; MISSING is said by a person; WAIVED needs
 * its own permission and a reason, and is audited (§48, §49). The daily worker
 * moves items into EXPIRING and EXPIRED, tells the people responsible once per
 * expiry date, and attention holds until the item is renewed, waived or put
 * away.
 */

type Tx = Prisma.TransactionClient;

export const COMPLIANCE_CONDITIONS = ["CONTRACTOR_COMPLIANCE_EXPIRING", "CONTRACTOR_COMPLIANCE_EXPIRED", "CONTRACTOR_COMPLIANCE_MISSING"] as const;

const ITEM_SELECT = {
  id: true,
  companyId: true,
  contractorId: true,
  type: true,
  title: true,
  status: true,
  documentId: true,
  issuedAt: true,
  expiresAt: true,
  issuer: true,
  referenceNumber: true,
  notes: true,
  waivedReason: true,
  waivedAt: true,
  waivedByMemberId: true,
  archivedAt: true,
  contractor: { select: { id: true, legalName: true, status: true } },
  document: { select: { id: true, name: true, status: true } },
} satisfies Prisma.ContractorComplianceItemSelect;

type ItemRow = Prisma.ContractorComplianceItemGetPayload<{ select: typeof ITEM_SELECT }>;

/** The status the dates say, for anything a person has not decided (§48). */
export function deriveComplianceStatus(input: { status: ComplianceStatus; expiresAt: string | null }, today: string, reminderDays: number): ComplianceStatus {
  if (input.status === "WAIVED" || input.status === "ARCHIVED" || input.status === "MISSING") return input.status;
  if (!input.expiresAt) return "VALID";
  if (input.expiresAt < today) return "EXPIRED";
  if (input.expiresAt <= addLocalDays(today, reminderDays)) return "EXPIRING";
  return "VALID";
}

async function today(companyId: string) {
  const settings = await resolveEngineeringSettings(companyId);
  return { settings, today: localDate(new Date(), settings.timezone) };
}

async function toDTOs(context: UserContext, rows: ItemRow[], todayDate: string): Promise<ComplianceItemDTO[]> {
  const names = await people(context.companyId, rows.map((row) => row.waivedByMemberId));
  const manage = contractorsOpen(context, "contractor_compliance.manage");
  const waive = contractorsOpen(context, "contractor_compliance.waive");
  const files = filesOpen(context);
  return rows.map((row) => {
    const expires = dateOf(row.expiresAt);
    const closed = Boolean(row.archivedAt) || row.contractor.status === "ARCHIVED";
    return {
      id: row.id,
      contractor: { id: row.contractor.id, label: row.contractor.legalName, href: `/contractors/${row.contractor.id}` },
      type: row.type,
      title: row.title,
      status: row.status,
      document: files && row.document && row.document.status === "ACTIVE" ? { id: row.document.id, name: row.document.name, href: `/documents/${row.document.id}` } : null,
      issuedAt: dateOf(row.issuedAt),
      expiresAt: expires,
      daysToExpiry: expires ? daysBetween(todayDate, expires) : null,
      issuer: row.issuer,
      referenceNumber: row.referenceNumber,
      notes: row.notes,
      waivedReason: row.waivedReason,
      waivedAt: row.waivedAt?.toISOString() ?? null,
      waivedBy: personOf(names, row.waivedByMemberId),
      archived: Boolean(row.archivedAt),
      canManage: manage && !closed,
      canWaive: waive && !closed && row.status !== "WAIVED",
    };
  });
}

const ORDER: Prisma.ContractorComplianceItemOrderByWithRelationInput[] = [{ expiresAt: { sort: "asc", nulls: "last" } }, { title: "asc" }];

export async function listContractorCompliance(context: UserContext, contractorId: string): Promise<ComplianceItemDTO[]> {
  const contractor = await findReadableContractor(context, contractorId);
  if (!contractorsOpen(context, "contractor_compliance.view")) throw new AccessError("FORBIDDEN", "You cannot see contractor compliance.");
  const [rows, clock] = await Promise.all([
    prisma.contractorComplianceItem.findMany({ where: { AND: [readableComplianceWhere(context), { contractorId: contractor.id }] }, orderBy: [{ archivedAt: { sort: "desc", nulls: "first" } }, ...ORDER], take: 200, select: ITEM_SELECT }),
    today(context.companyId),
  ]);
  return toDTOs(context, rows, clock.today);
}

/** The company-wide compliance register (§160, §207). */
export async function listCompliance(context: UserContext, query: ComplianceListQuery): Promise<{ items: ComplianceItemDTO[]; total: number; page: number; pageSize: number }> {
  assertModule(context, MODULE);
  if (!contractorsOpen(context, "contractor_compliance.view")) throw new AccessError("FORBIDDEN", "You cannot see contractor compliance.");
  const pageSize = 50;
  const filters: Prisma.ContractorComplianceItemWhereInput[] = [readableComplianceWhere(context), { archivedAt: null }];
  if (query.status) filters.push({ status: query.status });
  if (query.alerts) filters.push({ status: { in: COMPLIANCE_ALERT_STATUSES } });
  if (query.type) filters.push({ type: query.type });
  if (query.q) filters.push({ OR: [{ title: { contains: query.q, mode: "insensitive" } }, { referenceNumber: { contains: query.q, mode: "insensitive" } }, { contractor: { legalName: { contains: query.q, mode: "insensitive" } } }] });
  const where = { AND: filters };
  const [rows, total, clock] = await Promise.all([
    prisma.contractorComplianceItem.findMany({ where, orderBy: ORDER, skip: (query.page - 1) * pageSize, take: pageSize, select: ITEM_SELECT }),
    prisma.contractorComplianceItem.count({ where }),
    today(context.companyId),
  ]);
  return { items: await toDTOs(context, rows, clock.today), total, page: query.page, pageSize };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

async function findManageableItem(context: UserContext, id: string, permission: "contractor_compliance.manage" | "contractor_compliance.waive"): Promise<ItemRow> {
  assertModule(context, MODULE);
  assertPermission(context, permission);
  const row = await prisma.contractorComplianceItem.findFirst({ where: { AND: [readableComplianceWhere(context), { id }] }, select: ITEM_SELECT });
  if (!row) throw fail("COMPLIANCE_NOT_FOUND", "That compliance item could not be found.", "NOT_FOUND");
  if (row.archivedAt) throw fail("COMPLIANCE_ARCHIVED", "That compliance item is archived.", "CONFLICT");
  if (row.contractor.status === "ARCHIVED") throw fail("CONTRACTOR_READ_ONLY", "Reactivate this contractor before changing its compliance.", "CONFLICT");
  return row;
}

/** The evidence is a Document on this contractor or this item, readable by the writer (§47, §127). */
async function assertEvidence(context: UserContext, contractorId: string, itemId: string | null, documentId: string | null, current: string | null = null) {
  if (!documentId || documentId === current) return;
  if (!filesOpen(context)) throw fail("COMPLIANCE_DOCUMENT_FORBIDDEN", "You cannot attach documents.", "FORBIDDEN", { field: "documentId" });
  const found = await prisma.document.count({
    where: {
      id: documentId,
      companyId: context.companyId,
      status: "ACTIVE",
      OR: [{ entityType: "contractor", entityId: contractorId }, ...(itemId ? [{ entityType: COMPLIANCE_RECORD, entityId: itemId }] : [])],
    },
  });
  if (!found) throw fail("COMPLIANCE_DOCUMENT_INVALID", "Attach a document filed on this contractor.", "VALIDATION_ERROR", { field: "documentId" });
}

function auditShape(input: { type: string; title: string; status: string; documentId: string | null; issuedAt: string | null; expiresAt: string | null; referenceNumber: string | null }) {
  return { type: input.type, title: input.title, status: input.status, documentId: input.documentId, issuedAt: input.issuedAt, expiresAt: input.expiresAt, referenceNumber: input.referenceNumber };
}

export async function createComplianceItem(context: UserContext, contractorId: string, input: ComplianceInput): Promise<{ id: string; status: ComplianceStatus }> {
  const contractor = await findReadableContractor(context, contractorId);
  assertPermission(context, "contractor_compliance.manage");
  if (contractor.status === "ARCHIVED") throw fail("CONTRACTOR_READ_ONLY", "Reactivate this contractor before changing its compliance.", "CONFLICT");
  await assertEvidence(context, contractor.id, null, input.documentId);
  const clock = await today(context.companyId);
  const status = deriveComplianceStatus({ status: input.status, expiresAt: input.expiresAt }, clock.today, clock.settings.contractorComplianceReminderDays);
  return prisma.$transaction(async (tx) => {
    const row = await tx.contractorComplianceItem.create({
      data: { companyId: context.companyId, contractorId: contractor.id, type: input.type, title: input.title, status, documentId: input.documentId, issuedAt: at(input.issuedAt), expiresAt: at(input.expiresAt), issuer: input.issuer, referenceNumber: input.referenceNumber, notes: input.notes, statusChangedAt: new Date(), createdByMemberId: context.membershipId },
      select: { id: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: contractor.id, action: "CONTRACTOR_COMPLIANCE_CREATED", message: `recorded ${input.title} for ${contractor.legalName}` });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_CREATED, entity: { type: COMPLIANCE_RECORD, id: row.id, label: `${input.title} · ${contractor.legalName}` }, after: auditShape({ ...input, status }) }, { tx });
    return { id: row.id, status };
  });
}

/** Renewing — a new certificate, a new expiry — puts the item back to what the dates say (§312). */
export async function updateComplianceItem(context: UserContext, id: string, input: ComplianceInput): Promise<{ id: string; status: ComplianceStatus }> {
  const row = await findManageableItem(context, id, "contractor_compliance.manage");
  await assertEvidence(context, row.contractorId, row.id, input.documentId, row.documentId);
  const clock = await today(context.companyId);
  const status = deriveComplianceStatus({ status: input.status, expiresAt: input.expiresAt }, clock.today, clock.settings.contractorComplianceReminderDays);
  await prisma.$transaction(async (tx) => {
    await tx.contractorComplianceItem.update({
      where: { id: row.id },
      data: {
        type: input.type, title: input.title, status, documentId: input.documentId, issuedAt: at(input.issuedAt), expiresAt: at(input.expiresAt), issuer: input.issuer, referenceNumber: input.referenceNumber, notes: input.notes,
        ...(status !== row.status ? { statusChangedAt: new Date(), waivedReason: null, waivedAt: null, waivedByMemberId: null } : {}),
      },
    });
    await recordUserAction(
      context,
      { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_UPDATED, entity: { type: COMPLIANCE_RECORD, id: row.id, label: `${input.title} · ${row.contractor.legalName}` }, before: auditShape({ ...row, issuedAt: dateOf(row.issuedAt), expiresAt: dateOf(row.expiresAt) }), after: auditShape({ ...input, status }) },
      { tx },
    );
    if (status === "VALID" && row.status !== "VALID") {
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.contractorId, action: "CONTRACTOR_COMPLIANCE_RENEWED", message: `renewed ${input.title} for ${row.contractor.legalName}` });
    }
  });
  await settleComplianceAttention(context.companyId, row.id, status);
  return { id: row.id, status };
}

export async function waiveComplianceItem(context: UserContext, id: string, input: { reason: string }): Promise<{ id: string }> {
  const row = await findManageableItem(context, id, "contractor_compliance.waive");
  if (row.status === "WAIVED") throw fail("COMPLIANCE_ALREADY_WAIVED", "This requirement is already waived.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    await tx.contractorComplianceItem.update({ where: { id: row.id }, data: { status: "WAIVED", waivedReason: input.reason, waivedAt: new Date(), waivedByMemberId: context.membershipId, statusChangedAt: new Date() } });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.contractorId, action: "CONTRACTOR_COMPLIANCE_WAIVED", message: `waived ${row.title} for ${row.contractor.legalName}` });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_WAIVED, entity: { type: COMPLIANCE_RECORD, id: row.id, label: `${row.title} · ${row.contractor.legalName}` }, before: { status: row.status }, after: { status: "WAIVED" }, reason: input.reason }, { tx });
  });
  await settleComplianceAttention(context.companyId, row.id, "WAIVED");
  return { id: row.id };
}

export async function archiveComplianceItem(context: UserContext, id: string): Promise<{ id: string }> {
  const row = await findManageableItem(context, id, "contractor_compliance.manage");
  await prisma.$transaction(async (tx) => {
    await tx.contractorComplianceItem.update({ where: { id: row.id }, data: { status: "ARCHIVED", archivedAt: new Date(), statusChangedAt: new Date() } });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_ARCHIVED, entity: { type: COMPLIANCE_RECORD, id: row.id, label: `${row.title} · ${row.contractor.legalName}` }, after: { status: "ARCHIVED" } }, { tx });
  });
  await settleComplianceAttention(context.companyId, row.id, "ARCHIVED");
  return { id: row.id };
}

/** Evidence this writer may pick: documents filed on the contractor or on the item (§47). */
export async function complianceDocumentOptions(context: UserContext, contractorId: string, itemId: string | null) {
  const contractor = await findReadableContractor(context, contractorId);
  if (!filesOpen(context) || !can(context, "contractor_compliance.manage")) return [];
  const rows = await prisma.document.findMany({
    where: { companyId: context.companyId, status: "ACTIVE", OR: [{ entityType: "contractor", entityId: contractor.id }, ...(itemId ? [{ entityType: COMPLIANCE_RECORD, entityId: itemId }] : [])] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ id: row.id, label: row.name }));
}

/* -------------------------------------------------------------------------- */
/* Worker, notifications and attention                                          */
/* -------------------------------------------------------------------------- */

/** Who answers for a contractor's compliance: the compliance owners and the managers of its live projects (§46). */
export async function complianceRecipients(db: Tx | typeof prisma, companyId: string, contractorId: string): Promise<string[]> {
  const [owners, assignments] = await Promise.all([
    holders(db, companyId, "contractor_compliance.manage"),
    db.projectContractorAssignment.findMany({ where: { companyId, contractorId, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD", "SUSPENDED"] } }, select: { internalManagerMemberId: true, project: { select: { projectManagerMemberId: true } } } }),
  ]);
  return [...new Set([...owners, ...assignments.flatMap((row) => [row.internalManagerMemberId, row.project.projectManagerMemberId])].filter((id): id is string => Boolean(id)))];
}

const WORKER_ROW = { id: true, companyId: true, contractorId: true, type: true, title: true, status: true, expiresAt: true, contractor: { select: { legalName: true, status: true } } } satisfies Prisma.ContractorComplianceItemSelect;

/**
 * Job `contractors.compliance` (daily, §44, §199): VALID → EXPIRING inside the
 * reminder window, VALID or EXPIRING → EXPIRED past the date. Each move is
 * guarded by the status it leaves; each item notifies once per expiry date.
 */
export async function runComplianceExpiry(now = new Date()): Promise<{ expiring: number; expired: number }> {
  const companies = await prisma.company.findMany({ where: { status: "ACTIVE", modules: { some: { enabled: true, module: { key: MODULE } } } }, select: { id: true } });
  let expiring = 0;
  let expired = 0;
  for (const company of companies) {
    const settings = await resolveEngineeringSettings(company.id);
    const todayDate = localDate(now, settings.timezone);
    const horizon = addLocalDays(todayDate, settings.contractorComplianceReminderDays);
    const rows = await prisma.contractorComplianceItem.findMany({
      where: { companyId: company.id, archivedAt: null, status: { in: ["VALID", "EXPIRING"] }, expiresAt: { lte: new Date(`${horizon}T23:59:59.999Z`) }, contractor: { is: { status: { not: "ARCHIVED" } } } },
      take: 2_000,
      select: WORKER_ROW,
    });
    for (const row of rows) {
      const expires = dateOf(row.expiresAt)!;
      const next: ComplianceStatus = expires < todayDate ? "EXPIRED" : "EXPIRING";
      // An item already expiring has nothing to move, but its reminder may still be due for this date.
      await prisma.$transaction(async (tx) => {
        if (next !== row.status) {
          const moved = await tx.contractorComplianceItem.updateMany({ where: { id: row.id, status: row.status }, data: { status: next, statusChangedAt: now } });
          if (!moved.count) return;
          if (next === "EXPIRED") {
            await recordSystemAction(company.id, { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_EXPIRED, entity: { type: COMPLIANCE_RECORD, id: row.id, label: `${row.title} · ${row.contractor.legalName}` }, before: { status: row.status, expiresAt: expires }, after: { status: "EXPIRED", expiresAt: expires } }, { tx });
          }
        }
        const eventType = next === "EXPIRED" ? NotificationEvent.CONTRACTOR_COMPLIANCE_EXPIRED : NotificationEvent.CONTRACTOR_COMPLIANCE_EXPIRING;
        const already = await tx.notificationEventOutbox.count({ where: { companyId: company.id, eventType, entityType: COMPLIANCE_RECORD, entityId: row.id, payloadJson: { path: ["expiresAt"], equals: expires } } });
        if (already) return;
        const memberIds = await complianceRecipients(tx, company.id, row.contractorId);
        if (!memberIds.length) return;
        await enqueueNotificationEvent(tx, {
          companyId: company.id,
          eventType,
          moduleKey: MODULE,
          entityType: COMPLIANCE_RECORD,
          entityId: row.id,
          actorMemberId: null,
          projectId: null,
          payload: { memberIds, title: row.title, contractorName: row.contractor.legalName, typeLabel: COMPLIANCE_TYPE_LABELS[row.type as ComplianceType], expiresAt: expires, dateLabel: dateLabel(expires) },
        });
        if (next === "EXPIRED") expired += 1;
        else expiring += 1;
      });
    }
  }
  if (expiring) incrementCounter(Metric.COMPLIANCE_EXPIRING, {}, expiring);
  if (expired) incrementCounter(Metric.COMPLIANCE_EXPIRED, {}, expired);
  return { expiring, expired };
}

export type ComplianceAttentionRow = { id: string; contractorId: string; title: string; status: ComplianceStatus; expiresAt: string | null; contractorName: string; statusChangedAt: Date | null; createdAt: Date };

export async function complianceInStatus(companyId: string, status: "EXPIRING" | "EXPIRED" | "MISSING", itemId?: string): Promise<ComplianceAttentionRow[]> {
  const rows = await prisma.contractorComplianceItem.findMany({
    where: { companyId, status, archivedAt: null, ...(itemId ? { id: itemId } : {}), contractor: { is: { status: { notIn: ["ARCHIVED", "OFFBOARDED"] } } } },
    take: 500,
    select: { id: true, contractorId: true, title: true, status: true, expiresAt: true, statusChangedAt: true, createdAt: true, contractor: { select: { legalName: true } } },
  });
  return rows.map((row) => ({ id: row.id, contractorId: row.contractorId, title: row.title, status: row.status, expiresAt: dateOf(row.expiresAt), contractorName: row.contractor.legalName, statusChangedAt: row.statusChangedAt, createdAt: row.createdAt }));
}

/** Ends straight away whatever a renewal, waiver or archive stopped being true (§198). */
export async function settleComplianceAttention(companyId: string, itemId: string, status: ComplianceStatus) {
  const ended = COMPLIANCE_CONDITIONS.filter((key) => key !== `CONTRACTOR_COMPLIANCE_${status}`);
  await resolveAttentionForRecord(prisma, companyId, COMPLIANCE_RECORD, itemId, [...ended]);
}
