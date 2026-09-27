import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import type { AttentionRowPage } from "@/lib/core/notifications/attention.conditions";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { claimIdempotencyKey, idempotencyKeyClaimed } from "@/lib/core/jobs/job.idempotency";
import { assertEveryCompanySucceeded, forEachCompany } from "@/lib/core/jobs/system-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordSystemAction, recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays, daysBetween, localDate } from "@/lib/modules/calendar/calendar.time";
import { filesOpen } from "@/lib/modules/engineering/engineering.permissions";
import { resolveEngineeringSettings } from "@/lib/modules/engineering/engineering.settings";
import { kept } from "@/lib/modules/engineering/engineering.fields";
import { at, dateLabel, dateOf, fail, holders, LIST_SNAPSHOT, people, personOf, REGISTER_PAGE_SIZE } from "@/lib/modules/engineering/engineering.shared";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { recordActivity } from "@/lib/modules/shared/activity";
import { ACTIVITY_ENTITY, COMPLIANCE_RECORD, contractorsOpen, MODULE, readableComplianceWhere } from "./contractor.permissions";
import type { ComplianceInput, ComplianceListQuery, UpdateComplianceInput } from "./contractor.schema";
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

/** Soonest expiry first, undated items last, then title; the id breaks ties (AUD-08 §4, DT-04). */
const ORDER: Prisma.ContractorComplianceItemOrderByWithRelationInput[] = [{ expiresAt: { sort: "asc", nulls: "last" } }, { title: "asc" }, { id: "asc" }];

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
  const pageSize = REGISTER_PAGE_SIZE;
  const filters: Prisma.ContractorComplianceItemWhereInput[] = [readableComplianceWhere(context), { archivedAt: null }];
  if (query.status) filters.push({ status: query.status });
  if (query.alerts) filters.push({ status: { in: COMPLIANCE_ALERT_STATUSES } });
  if (query.type) filters.push({ type: query.type });
  if (query.q) filters.push({ OR: [{ title: { contains: query.q, mode: "insensitive" } }, { referenceNumber: { contains: query.q, mode: "insensitive" } }, { contractor: { legalName: { contains: query.q, mode: "insensitive" } } }] });
  const where = { AND: filters };
  // Rows and total from one snapshot; the page clamped so a page past the end moves once (AUD-08 §4, DT-05, DT-06).
  const [[rows, total], clock] = await Promise.all([
    prisma.$transaction([prisma.contractorComplianceItem.findMany({ where, orderBy: ORDER, skip: (query.page - 1) * pageSize, take: pageSize, select: ITEM_SELECT }), prisma.contractorComplianceItem.count({ where })], LIST_SNAPSHOT),
    today(context.companyId),
  ]);
  return { items: await toDTOs(context, rows, clock.today), total, page: paginationMeta(total, query.page, pageSize).page, pageSize };
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

/**
 * Renewing — a new certificate, a new expiry — puts the item back to what the
 * dates say (§312).
 *
 * The write is bound to the status and expiry it was decided from. The daily
 * job moves the same rows, and without the binding either side could land a
 * status that belongs to the other's dates: a renewal overwritten to EXPIRED
 * with next year's expiry, which the job never looks at again (PRD #51 §80).
 */
export async function updateComplianceItem(context: UserContext, id: string, input: UpdateComplianceInput): Promise<{ id: string; status: ComplianceStatus }> {
  const row = await findManageableItem(context, id, "contractor_compliance.manage");
  /*
   * What the edit names, over what is stored (AUD-09 §4, §5, FV-05, FV-10).
   * Absent evidence is kept; a reader who cannot open files is never shown it,
   * so they may not unlink it either. An absent status keeps a waiver: a typo
   * fixed in the title does not quietly withdraw it.
   */
  if (input.documentId !== undefined && input.documentId !== row.documentId && !filesOpen(context)) {
    throw fail("COMPLIANCE_DOCUMENT_FORBIDDEN", "You cannot change the evidence.", "FORBIDDEN", { field: "documentId" });
  }
  const next = {
    documentId: kept(input.documentId, row.documentId),
    issuedAt: kept(input.issuedAt, dateOf(row.issuedAt)),
    expiresAt: kept(input.expiresAt, dateOf(row.expiresAt)),
    issuer: kept(input.issuer, row.issuer),
    referenceNumber: kept(input.referenceNumber, row.referenceNumber),
    notes: kept(input.notes, row.notes),
  };
  if (next.issuedAt && next.expiresAt && next.expiresAt < next.issuedAt) {
    throw fail("COMPLIANCE_DATES", "The end is before the start.", "VALIDATION_ERROR", { field: input.expiresAt !== undefined ? "expiresAt" : "issuedAt" });
  }
  await assertEvidence(context, row.contractorId, row.id, next.documentId, row.documentId);
  const clock = await today(context.companyId);
  const held: ComplianceStatus = input.status ?? (row.status === "WAIVED" || row.status === "MISSING" ? row.status : "VALID");
  const status = deriveComplianceStatus({ status: held, expiresAt: next.expiresAt }, clock.today, clock.settings.contractorComplianceReminderDays);
  await prisma.$transaction(async (tx) => {
    const moved = await tx.contractorComplianceItem.updateMany({
      where: { id: row.id, companyId: context.companyId, status: row.status, expiresAt: row.expiresAt },
      data: {
        type: input.type, title: input.title, status, documentId: next.documentId, issuedAt: at(next.issuedAt), expiresAt: at(next.expiresAt), issuer: next.issuer, referenceNumber: next.referenceNumber, notes: next.notes,
        ...(status !== row.status ? { statusChangedAt: new Date(), waivedReason: null, waivedAt: null, waivedByMemberId: null } : {}),
      },
    });
    if (!moved.count) throw fail("COMPLIANCE_STALE", "This compliance item changed while you were saving it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(
      context,
      { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_UPDATED, entity: { type: COMPLIANCE_RECORD, id: row.id, label: `${input.title} · ${row.contractor.legalName}` }, before: auditShape({ ...row, issuedAt: dateOf(row.issuedAt), expiresAt: dateOf(row.expiresAt) }), after: auditShape({ type: input.type, title: input.title, ...next, status }) },
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

/**
 * Evidence this writer may pick: documents filed on the contractor or on the
 * item (§47). The item comes from the query string, so it is read inside the
 * writer's compliance scope and must belong to this contractor — otherwise
 * another contractor's evidence would be listed under this one (PRD #47 §50).
 */
export async function complianceDocumentOptions(context: UserContext, contractorId: string, itemId: string | null) {
  const contractor = await findReadableContractor(context, contractorId);
  if (itemId) {
    const item = await prisma.contractorComplianceItem.findFirst({ where: { AND: [readableComplianceWhere(context), { id: itemId, contractorId: contractor.id }] }, select: { id: true } });
    if (!item) throw fail("COMPLIANCE_NOT_FOUND", "That compliance item could not be found.", "NOT_FOUND");
  }
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

const JOB = "contractors.compliance";
/** Items read at a time; a company with more is walked by cursor, never cut off (PRD #51 §133-§138). */
const BATCH = 100;
/** A contractor the company has finished with, or put away, is not chased for its paperwork. */
const CLOSED_CONTRACTOR: Array<"ARCHIVED" | "OFFBOARDED"> = ["ARCHIVED", "OFFBOARDED"];

const WORKER_ROW = { id: true, companyId: true, contractorId: true, type: true, title: true, status: true, expiresAt: true, contractor: { select: { legalName: true, status: true } } } satisfies Prisma.ContractorComplianceItemSelect;
type WorkerRow = Prisma.ContractorComplianceItemGetPayload<{ select: typeof WORKER_ROW }>;

/**
 * Brings one item to what its expiry date says and tells the people
 * responsible, once per status per expiry date.
 *
 * The move is bound to the status and expiry as read, so a renewal saved
 * meanwhile is never overtaken. The notice is claimed in the idempotency
 * ledger in the same transaction, so two runs at once, or a run after
 * retention has purged the first event from the outbox, tell people once
 * (PRD #51 §15-§19, §80). An item with nobody to tell claims nothing: whoever
 * takes compliance on before the next run still hears.
 */
async function settleExpiry(companyId: string, row: WorkerRow, todayDate: string, now: Date): Promise<{ moved: boolean; notified: ComplianceStatus | null }> {
  const expires = dateOf(row.expiresAt)!;
  const next: ComplianceStatus = expires < todayDate ? "EXPIRED" : "EXPIRING";
  const moving = next !== row.status;
  const claim = { companyId, jobKey: JOB, key: `${row.id}:${next}:${expires}` };
  // Already in its status and already told: nothing to open a transaction for.
  if (!moving && (await idempotencyKeyClaimed(prisma, claim))) return { moved: false, notified: null };
  return prisma.$transaction(async (tx) => {
    if (moving) {
      const moved = await tx.contractorComplianceItem.updateMany({ where: { id: row.id, companyId, status: row.status, expiresAt: row.expiresAt }, data: { status: next, statusChangedAt: now } });
      if (!moved.count) return { moved: false, notified: null };
      if (next === "EXPIRED") {
        await recordSystemAction(companyId, { actionKey: AuditAction.CONTRACTOR_COMPLIANCE_EXPIRED, entity: { type: COMPLIANCE_RECORD, id: row.id, label: `${row.title} · ${row.contractor.legalName}` }, before: { status: row.status, expiresAt: expires }, after: { status: "EXPIRED", expiresAt: expires } }, { tx });
      }
    }
    const memberIds = await complianceRecipients(tx, companyId, row.contractorId);
    if (!memberIds.length || !(await claimIdempotencyKey(tx, claim))) return { moved: moving, notified: null };
    await enqueueNotificationEvent(tx, {
      companyId,
      eventType: next === "EXPIRED" ? NotificationEvent.CONTRACTOR_COMPLIANCE_EXPIRED : NotificationEvent.CONTRACTOR_COMPLIANCE_EXPIRING,
      moduleKey: MODULE,
      entityType: COMPLIANCE_RECORD,
      entityId: row.id,
      actorMemberId: null,
      projectId: null,
      payload: { memberIds, title: row.title, contractorName: row.contractor.legalName, typeLabel: COMPLIANCE_TYPE_LABELS[row.type as ComplianceType], expiresAt: expires, dateLabel: dateLabel(expires) },
    });
    return { moved: moving, notified: next };
  });
}

/**
 * Job `contractors.compliance` (daily, §44, §199): VALID → EXPIRING inside the
 * reminder window, VALID or EXPIRING → EXPIRED past the date, in the company's
 * own day. `expiring` and `expired` count the people told; `moved`, the items
 * whose status changed.
 *
 * Every item in the company is reached, however many, and one that fails is
 * logged by id and stepped over, its move and its notice rolled back together;
 * the company's run then fails, after every other item has been settled
 * (PRD #51 §30-§36, §133-§138). MISSING and WAIVED are a person's word and are
 * never derived here (§48).
 */
export async function runComplianceExpiry(now = new Date()): Promise<{ expiring: number; expired: number; moved: number }> {
  const counts = { expiring: 0, expired: 0, moved: 0 };
  const companyRun = await forEachCompany(JOB, async ({ companyId }) => {
    const settings = await resolveEngineeringSettings(companyId);
    const todayDate = localDate(now, settings.timezone);
    const horizon = addLocalDays(todayDate, settings.contractorComplianceReminderDays);
    let failed = 0;
    for (let after: string | undefined; !jobStopRequested(); ) {
      const rows = await prisma.contractorComplianceItem.findMany({
        where: { companyId, archivedAt: null, status: { in: ["VALID", "EXPIRING"] }, expiresAt: { lte: new Date(`${horizon}T23:59:59.999Z`) }, contractor: { is: { status: { notIn: CLOSED_CONTRACTOR } } }, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH,
        select: WORKER_ROW,
      });
      for (const row of rows) {
        try {
          const result = await settleExpiry(companyId, row, todayDate, now);
          if (result.moved) counts.moved += 1;
          if (result.notified === "EXPIRED") counts.expired += 1;
          if (result.notified === "EXPIRING") counts.expiring += 1;
        } catch (error) {
          failed += 1;
          logger.error(`${JOB}.item_failed`, { companyId, complianceItemId: row.id, ...serialiseError(error) });
        }
      }
      if (rows.length < BATCH) break;
      after = rows[rows.length - 1]!.id;
    }
    if (failed) throw new JobError("PARTIAL_FAILURE", `${failed} compliance items could not be settled`);
  }, { moduleKey: MODULE });
  if (counts.expiring) incrementCounter(Metric.COMPLIANCE_EXPIRING, {}, counts.expiring);
  if (counts.expired) incrementCounter(Metric.COMPLIANCE_EXPIRED, {}, counts.expired);
  assertEveryCompanySucceeded(JOB, companyRun);
  return counts;
}

export type ComplianceAttentionRow = { id: string; contractorId: string; title: string; status: ComplianceStatus; expiresAt: string | null; contractorName: string; statusChangedAt: Date | null; createdAt: Date };

/**
 * Compliance items in an alert status on contractors still engaged. Given a
 * page, one page of them by id, so the attention reconciler walks them all
 * (PRD #51 §133-§135).
 */
export async function complianceInStatus(companyId: string, status: "EXPIRING" | "EXPIRED" | "MISSING", itemId?: string, page?: AttentionRowPage): Promise<ComplianceAttentionRow[]> {
  const rows = await prisma.contractorComplianceItem.findMany({
    where: { companyId, status, archivedAt: null, ...(itemId ? { id: itemId } : {}), ...(page?.after ? { id: { gt: page.after } } : {}), contractor: { is: { status: { notIn: CLOSED_CONTRACTOR } } } },
    orderBy: { id: "asc" },
    take: page?.take ?? 500,
    select: { id: true, contractorId: true, title: true, status: true, expiresAt: true, statusChangedAt: true, createdAt: true, contractor: { select: { legalName: true } } },
  });
  return rows.map((row) => ({ id: row.id, contractorId: row.contractorId, title: row.title, status: row.status, expiresAt: dateOf(row.expiresAt), contractorName: row.contractor.legalName, statusChangedAt: row.statusChangedAt, createdAt: row.createdAt }));
}

/** Ends straight away whatever a renewal, waiver or archive stopped being true (§198). */
export async function settleComplianceAttention(companyId: string, itemId: string, status: ComplianceStatus) {
  const ended = COMPLIANCE_CONDITIONS.filter((key) => key !== `CONTRACTOR_COMPLIANCE_${status}`);
  await resolveAttentionForRecord(prisma, companyId, COMPLIANCE_RECORD, itemId, [...ended]);
}
