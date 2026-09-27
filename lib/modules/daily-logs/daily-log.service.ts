import { Prisma } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission, type SecurityReasonCode } from "@/lib/access/guards";
import { buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import { prisma } from "@/lib/database/prisma";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import { listDocuments } from "@/lib/modules/documents/document.service";
import { buildReceiptScopeWhere as buildInventoryReceiptScopeWhere } from "@/lib/modules/inventory/inventory.scope";
import { buildOrderScopeWhere, buildReceiptScopeWhere as buildGoodsReceiptScopeWhere } from "@/lib/modules/procurement/procurement.scope";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { canEditSection, dailyLogsOpen, isEditable, MODULE, projectDoor, readableDailyLogWhere, RECORD } from "./daily-log.permissions";
import type { DailyLogListQuery, UpdateDailyLogInput } from "./daily-log.schema";
import { resolveDailyLogSettings } from "./daily-log.settings";
import { businessInstant, clockOf, dateLabel, dateOf, daysBetween, localDate } from "./daily-log.time";
import {
  SECTION_KEYS,
  type DailyLogDetailDTO,
  type DailyLogHistoryEntry,
  type DailyLogIssue,
  type DailyLogListDTO,
  type DailyLogPerson,
  type DailyLogStatus,
  type DocumentCategory,
  type EvidenceDTO,
  type LinkedRecordDTO,
  type Ref,
} from "./daily-log.types";

/**
 * Daily logs: creating, reading and describing a site day (PRD #43 §10-§19,
 * §84-§86, §145-§160, §185, §201-§204, §216).
 *
 * One canonical log per company, project and work date, enforced by the
 * database. Reading one builds everything the workspace shows in a bounded
 * number of queries: its sections, the names behind every id (batched), what
 * each reader may see of the linked procurement, inventory, task, QA/QC and
 * HSE records, the evidence gallery, corrections, history, counts and the
 * issues that would stop a submission.
 */

export const ACTIVITY_ENTITY = "DailyLog";
export const RECORD_LINK_TYPE = "DAILY_LOG_RECORD";

/** `reason` is the security reason a refusal is logged under (PRD #47 §118); the response keeps code and message. */
export function fail(code: string, message: string, status: "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" = "VALIDATION_ERROR", extra: Record<string, unknown> = {}, reason?: SecurityReasonCode): AccessError {
  return new AccessError(status, message, { code, ...extra }, reason);
}

const decimal = (value: Prisma.Decimal | null) => (value === null ? null : Number(value.toString()));

export async function findReadableLog(context: UserContext, dailyLogId: string) {
  assertModule(context, MODULE);
  if (!dailyLogsOpen(context)) throw new AccessError("FORBIDDEN");
  const log = await prisma.dailyLog.findFirst({
    where: { AND: [readableDailyLogWhere(context), { id: dailyLogId }] },
    select: { id: true, companyId: true, projectId: true, workDate: true, status: true, version: true, createdByMemberId: true, submittedByMemberId: true, reviewerMemberId: true, submissionCount: true, project: { select: { name: true, code: true, projectManagerMemberId: true } } },
  });
  if (!log) throw fail("DAILY_LOG_NOT_FOUND", "That daily log could not be found.", "NOT_FOUND");
  return log;
}

export type ReadableLog = Awaited<ReturnType<typeof findReadableLog>>;

/** Bumps the version of a log still being written, or refuses (§159, §192, §232). */
export async function touchLog(tx: Prisma.TransactionClient, dailyLogId: string, expectedVersion?: number): Promise<number> {
  const moved = await tx.dailyLog.updateMany({
    where: { id: dailyLogId, status: { in: ["DRAFT", "CORRECTION_REQUIRED"] }, ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) },
    data: { version: { increment: 1 } },
  });
  if (moved.count === 0) {
    const current = await tx.dailyLog.findUnique({ where: { id: dailyLogId }, select: { status: true } });
    if (current && !isEditable(current.status)) throw lockedError(current.status);
    throw fail("DAILY_LOG_STALE", "This log changed since you opened it. Reload to see the latest.", "CONFLICT");
  }
  const row = await tx.dailyLog.findUniqueOrThrow({ where: { id: dailyLogId }, select: { version: true } });
  return row.version;
}

export function lockedError(status: DailyLogStatus): AccessError {
  if (status === "LOCKED") return fail("DAILY_LOG_LOCKED", "This log is locked as the official record. Add a correction instead.", "CONFLICT");
  if (status === "VOID") return fail("DAILY_LOG_VOID", "This log was voided.", "CONFLICT");
  return fail("DAILY_LOG_NOT_EDITABLE", "This log has been submitted, so it cannot change until it is returned.", "CONFLICT");
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Starts the log for a project and day (§10, §17-§19). A future day is
 * refused, one further back than the company allows too; a day that already
 * has its log answers with that log, so two people starting "today" at once
 * end up in the same record.
 */
export async function createDailyLog(context: UserContext, input: { projectId: string; workDate: string }): Promise<{ id: string; created: boolean }> {
  assertModule(context, MODULE);
  assertPermission(context, "daily_log.create");
  const door = projectDoor(context);
  const project = door ? await prisma.project.findFirst({ where: { AND: [door, { id: input.projectId }] }, select: { id: true, status: true, archivedAt: true, projectManagerMemberId: true } }) : null;
  if (!project) throw fail("DAILY_LOG_PROJECT_NOT_FOUND", "That project could not be found.", "NOT_FOUND");
  if (project.archivedAt || project.status === "ARCHIVED") throw fail("DAILY_LOG_PROJECT_ARCHIVED", "That project is archived.", "CONFLICT");

  const settings = await resolveDailyLogSettings(context.companyId, project.id);
  const today = localDate(new Date(), settings.timezone);
  if (input.workDate > today) throw fail("DAILY_LOG_FUTURE_DATE", "A daily log records a day that has happened.");
  const age = daysBetween(input.workDate, today);
  if (age > settings.backdateDays) throw fail("DAILY_LOG_BACKDATE_LIMIT", `A log can be started up to ${settings.backdateDays} days back.`);

  const existing = await prisma.dailyLog.findFirst({ where: { companyId: context.companyId, projectId: project.id, workDate: businessInstant(input.workDate) }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const log = await tx.dailyLog.create({
        data: { companyId: context.companyId, projectId: project.id, workDate: businessInstant(input.workDate), createdByMemberId: context.membershipId, lateEntry: age > 0 },
        select: { id: true },
      });
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: log.id, action: "DAILY_LOG_CREATED", message: `started the daily log for ${dateLabel(input.workDate)}` });
      await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_CREATED, entity: { type: RECORD, id: log.id, label: `Daily log ${input.workDate}` }, after: { projectId: project.id, workDate: input.workDate, lateEntry: age > 0 } }, { tx });
      return log;
    });
    // The author and the project manager follow its discussion (§125).
    await subscribeStakeholders({ companyId: context.companyId, parentType: RECORD, parentId: created.id, memberIds: [context.membershipId, ...(project.projectManagerMemberId ? [project.projectManagerMemberId] : [])] });
    incrementCounter(Metric.DAILY_LOG_CREATE_SUCCESS);
    return { id: created.id, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.dailyLog.findFirst({ where: { companyId: context.companyId, projectId: project.id, workDate: businessInstant(input.workDate) }, select: { id: true } });
      if (winner) return { id: winner.id, created: false };
    }
    throw error;
  }
}

/** The log for a project and day, if there is one the reader may open (§163). */
export async function findLogByDate(context: UserContext, projectId: string, workDate: string): Promise<string | null> {
  assertModule(context, MODULE);
  const row = await prisma.dailyLog.findFirst({ where: { AND: [readableDailyLogWhere(context), { projectId, workDate: businessInstant(workDate) }] }, select: { id: true } });
  return row?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Top-level fields                                                            */
/* -------------------------------------------------------------------------- */

const TOP_FIELDS = ["summary", "generalNotes", "delaySummary", "instructionSummary", "weatherSummary", "siteCondition", "siteConditionNotes"] as const;

export async function updateDailyLog(context: UserContext, dailyLogId: string, input: UpdateDailyLogInput): Promise<{ version: number }> {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.edit");
  if (!isEditable(log.status)) throw lockedError(log.status);
  // Only the fields the request named (AUD-09 §4, FV-05); `null` clears one.
  const named = TOP_FIELDS.filter((field) => input[field] !== undefined);
  const data = Object.fromEntries(named.map((field) => [field, input[field]]));
  const version = await prisma.$transaction(async (tx) => {
    const next = await touchLog(tx, log.id, input.expectedVersion);
    await tx.dailyLog.update({ where: { id: log.id }, data });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_UPDATED, entity: { type: RECORD, id: log.id }, after: { fields: named.filter((field) => input[field] !== null).join(","), siteCondition: input.siteCondition } }, { tx });
    return next;
  });
  return { version };
}

/* -------------------------------------------------------------------------- */
/* List                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The newest site day first, then the newest log; the id breaks ties so a
 * page never repeats or drops a log (AUD-08 §4, DT-04). The review queue reads
 * the oldest submission first. `workDate` and `createdAt` are required; a
 * submitted log always has `submittedAt`, and one without sorts last.
 */
const LIST_ORDER: Prisma.DailyLogOrderByWithRelationInput[] = [{ workDate: "desc" }, { createdAt: "desc" }, { id: "asc" }];
const REVIEW_ORDER: Prisma.DailyLogOrderByWithRelationInput[] = [{ submittedAt: { sort: "asc", nulls: "last" } }, { workDate: "asc" }, { id: "asc" }];
const LIST_SNAPSHOT = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };

/**
 * One page of daily logs (AUD-08 §3, §4): the reader's scope, then the section
 * (a project, or the review queue — an explicit option the API reads as
 * `queue=review`), then the filters, AND across them; then the order and the
 * page, in the database. Rows and total share one snapshot (DT-06), and `page`
 * is the request clamped to the last real page so a page past the end moves
 * there once (DT-05). A project the reader cannot open narrows to no rows (DT-22).
 */
export async function listDailyLogs(context: UserContext, query: DailyLogListQuery, options: { reviewQueue?: boolean } = {}): Promise<DailyLogListDTO> {
  assertModule(context, MODULE);
  if (!dailyLogsOpen(context)) throw new AccessError("FORBIDDEN");
  const settings = await resolveDailyLogSettings(context.companyId, query.projectId ?? null);
  const where: Prisma.DailyLogWhereInput = {
    AND: [
      readableDailyLogWhere(context),
      query.projectId ? { projectId: query.projectId } : {},
      query.from ? { workDate: { gte: businessInstant(query.from) } } : {},
      query.to ? { workDate: { lte: businessInstant(query.to) } } : {},
      query.status ? { status: query.status } : {},
      query.authorId ? { OR: [{ createdByMemberId: query.authorId }, { submittedByMemberId: query.authorId }] } : {},
      query.q ? { OR: [{ summary: { contains: query.q, mode: "insensitive" } }, { project: { is: { name: { contains: query.q, mode: "insensitive" } } } }] } : {},
      options.reviewQueue ? { status: "SUBMITTED", OR: [{ reviewerMemberId: context.membershipId }, { reviewerMemberId: null }, { project: { is: { projectManagerMemberId: context.membershipId } } }] } : {},
    ],
  };
  const [total, rows] = await prisma.$transaction([
    prisma.dailyLog.count({ where }),
    prisma.dailyLog.findMany({
      where,
      orderBy: options.reviewQueue ? REVIEW_ORDER : LIST_ORDER,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, workDate: true, status: true, lateEntry: true, summary: true, createdByMemberId: true, reviewerMemberId: true,
        project: { select: { id: true, name: true, code: true } },
        _count: { select: { workActivities: true, delayEntries: true, corrections: true } },
      },
    }),
  ], LIST_SNAPSHOT);
  const ids = rows.map((row) => row.id);
  const [workforce, photos, people] = await Promise.all([
    ids.length ? prisma.dailyLogWorkforceEntry.groupBy({ by: ["dailyLogId"], where: { dailyLogId: { in: ids } }, _sum: { headcount: true } }) : [],
    ids.length ? prisma.dailyLogDocumentLink.groupBy({ by: ["dailyLogId"], where: { dailyLogId: { in: ids }, category: "PHOTO" }, _count: { _all: true } }) : [],
    names(context.companyId, rows.flatMap((row) => [row.createdByMemberId, row.reviewerMemberId])),
  ]);
  const headcount = new Map(workforce.map((row) => [row.dailyLogId, row._sum.headcount ?? 0]));
  const photoCount = new Map(photos.map((row) => [row.dailyLogId, row._count._all]));

  let today: DailyLogListDTO["today"] = null;
  if (query.projectId) {
    const date = localDate(new Date(), settings.timezone);
    const existing = await prisma.dailyLog.findFirst({ where: { AND: [readableDailyLogWhere(context), { projectId: query.projectId, workDate: businessInstant(date) }] }, select: { id: true } });
    today = { date, logId: existing?.id ?? null, canCreate: can(context, "daily_log.create") };
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      project: row.project,
      workDate: dateOf(row.workDate),
      status: row.status,
      lateEntry: row.lateEntry,
      summary: row.summary,
      author: people.get(row.createdByMemberId) ?? null,
      reviewer: row.reviewerMemberId ? (people.get(row.reviewerMemberId) ?? null) : null,
      workforceTotal: headcount.get(row.id) ?? 0,
      activities: row._count.workActivities,
      delays: row._count.delayEntries,
      photos: photoCount.get(row.id) ?? 0,
      corrected: row._count.corrections > 0,
      href: `/projects/${row.project.id}/daily-logs/${row.id}`,
    })),
    total,
    page: paginationMeta(total, query.page, query.pageSize).page,
    pageSize: query.pageSize,
    today,
  };
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

export async function names(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, DailyLogPerson>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, { memberId: row.id, name: `${row.user.firstName} ${row.user.lastName}` }]));
}

const DETAIL_INCLUDE = {
  project: { select: { id: true, name: true, code: true, projectManagerMemberId: true } },
  weatherEntries: { orderBy: { observedAt: "asc" } },
  workforce: { orderBy: { createdAt: "asc" } },
  workActivities: { orderBy: { createdAt: "asc" } },
  equipmentEntries: { orderBy: { createdAt: "asc" } },
  deliveryEntries: { orderBy: { createdAt: "asc" } },
  visitorEntries: { orderBy: { createdAt: "asc" } },
  delayEntries: { orderBy: { createdAt: "asc" } },
  instructionEntries: { orderBy: { createdAt: "asc" } },
  taskLinks: { orderBy: { createdAt: "asc" } },
  documentLinks: true,
  corrections: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.DailyLogInclude;

type DetailRow = Prisma.DailyLogGetPayload<{ include: typeof DETAIL_INCLUDE }>;

async function referenceLabels(context: UserContext, row: DetailRow) {
  const supplierIds = [...row.workforce.map((entry) => entry.supplierId), ...row.equipmentEntries.map((entry) => entry.supplierId), ...row.deliveryEntries.map((entry) => entry.supplierId)].filter((id): id is string => Boolean(id));
  const taskIds = [...row.workActivities.map((entry) => entry.linkedTaskId), ...row.delayEntries.map((entry) => entry.linkedTaskId), ...row.instructionEntries.map((entry) => entry.linkedTaskId), ...row.taskLinks.map((link) => link.taskId)].filter((id): id is string => Boolean(id));
  const orderIds = row.deliveryEntries.map((entry) => entry.purchaseOrderId).filter((id): id is string => Boolean(id));
  const receiptIds = row.deliveryEntries.map((entry) => entry.goodsReceiptId).filter((id): id is string => Boolean(id));
  const stockIds = row.deliveryEntries.map((entry) => entry.inventoryReceiptId).filter((id): id is string => Boolean(id));
  const procurementOpen = canAccessModule(context, "procurement");
  const tasksOpen = canAccessModule(context, "tasks") && can(context, "task.view");
  const contractorIds = [...row.workforce.map((entry) => entry.contractorId), ...row.workActivities.map((entry) => entry.contractorId)].filter((id): id is string => Boolean(id));
  const packageIds = [...row.workforce.map((entry) => entry.workPackageId), ...row.workActivities.map((entry) => entry.workPackageId)].filter((id): id is string => Boolean(id));
  const contractorsOpen = isModuleEnabled(context, "contractors") && canAccessModule(context, "contractors") && can(context, "contractor.view");

  const [contractors, packages] = await Promise.all([
    contractorIds.length ? prisma.contractorProfile.findMany({ where: { companyId: context.companyId, id: { in: [...new Set(contractorIds)] } }, select: { id: true, legalName: true } }) : [],
    packageIds.length ? prisma.workPackage.findMany({ where: { companyId: context.companyId, id: { in: [...new Set(packageIds)] } }, select: { id: true, code: true, name: true, projectId: true } }) : [],
  ]);
  // The name is part of the site record; the link only for readers who can open contractors (PRD #46 §140).
  const contractorRef = new Map(contractors.map((item) => [item.id, { id: item.id, label: item.legalName, href: contractorsOpen ? `/contractors/${item.id}` : null }]));
  const packageRef = new Map(packages.map((item) => [item.id, { id: item.id, label: `${item.code} · ${item.name}`, href: contractorsOpen && can(context, "work_package.view") ? `/projects/${item.projectId}/work-packages/${item.id}` : null }]));

  const [suppliers, allTasks, visibleTasks, orders, receipts, stock] = await Promise.all([
    supplierIds.length ? prisma.supplier.findMany({ where: { companyId: context.companyId, id: { in: [...new Set(supplierIds)] } }, select: { id: true, name: true } }) : [],
    taskIds.length ? prisma.task.findMany({ where: { companyId: context.companyId, id: { in: [...new Set(taskIds)] } }, select: { id: true, title: true, status: true } }) : [],
    taskIds.length && tasksOpen ? prisma.task.findMany({ where: { AND: [buildTaskScopeWhere(context), { id: { in: [...new Set(taskIds)] } }] }, select: { id: true } }) : [],
    orderIds.length && procurementOpen && can(context, "procurement.order.view") ? prisma.purchaseOrder.findMany({ where: { AND: [buildOrderScopeWhere(context), { id: { in: orderIds } }] }, select: { id: true, poNumber: true } }) : [],
    receiptIds.length && procurementOpen && can(context, "procurement.receipt.view") ? prisma.goodsReceipt.findMany({ where: { AND: [buildGoodsReceiptScopeWhere(context), { id: { in: receiptIds } }] }, select: { id: true, receiptNumber: true, purchaseOrderId: true } }) : [],
    stockIds.length && canAccessModule(context, "inventory") && can(context, "inventory.receipt.view") ? prisma.inventoryReceipt.findMany({ where: { AND: [buildInventoryReceiptScopeWhere(context), { id: { in: stockIds } }] }, select: { id: true, receiptNumber: true } }) : [],
  ]);
  const supplierRef = new Map(suppliers.map((supplier) => [supplier.id, { id: supplier.id, label: supplier.name, href: procurementOpen && can(context, "procurement.supplier.view") ? `/procurement/suppliers/${supplier.id}` : null }]));
  const visible = new Set(visibleTasks.map((task) => task.id));
  const taskInfo = new Map(allTasks.map((task) => [task.id, task]));
  const taskRef = (id: string | null): Ref | null => {
    if (!id) return null;
    const task = taskInfo.get(id);
    if (!task) return null;
    return visible.has(id) ? { id, label: task.title, href: `/tasks/${id}` } : { id, label: "A task you cannot open", href: null };
  };
  const orderRef = new Map(orders.map((order) => [order.id, { id: order.id, label: order.poNumber, href: `/procurement/orders/${order.id}` }]));
  const receiptRef = new Map(receipts.map((receipt) => [receipt.id, { id: receipt.id, label: receipt.receiptNumber, href: `/procurement/orders/${receipt.purchaseOrderId}` }]));
  const stockRef = new Map(stock.map((receipt) => [receipt.id, { id: receipt.id, label: receipt.receiptNumber, href: `/inventory/receipts/${receipt.id}` }]));
  const restricted = (id: string | null, map: Map<string, Ref>, noun: string): Ref | null => (id ? (map.get(id) ?? { id, label: `${noun} you cannot open`, href: null }) : null);
  return {
    supplier: (id: string | null) => (id ? (supplierRef.get(id) ?? null) : null),
    contractor: (id: string | null) => (id ? (contractorRef.get(id) ?? null) : null),
    workPackage: (id: string | null) => (id ? (packageRef.get(id) ?? null) : null),
    task: taskRef,
    taskInfo,
    visibleTask: (id: string) => visible.has(id),
    order: (id: string | null) => restricted(id, orderRef, "A purchase order"),
    receipt: (id: string | null) => restricted(id, receiptRef, "A goods receipt"),
    stock: (id: string | null) => restricted(id, stockRef, "An inventory receipt"),
  };
}

/** QA/QC and HSE records on the log, each as far as this reader may see it (§62-§69, §222-§225). */
async function linkedRecords(context: UserContext, dailyLogId: string): Promise<LinkedRecordDTO[]> {
  const links = await prisma.integrationLink.findMany({
    where: { companyId: context.companyId, integrationType: RECORD_LINK_TYPE, sourceEntityType: RECORD, sourceEntityId: dailyLogId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, targetModule: true, targetEntityType: true, targetEntityId: true },
  });
  const result: LinkedRecordDTO[] = [];
  const byType = new Map<string, string[]>();
  for (const link of links) byType.set(link.targetEntityType, [...(byType.get(link.targetEntityType) ?? []), link.targetEntityId]);
  const summaries = new Map<string, { label: string; href: string }>();
  for (const [type, ids] of byType) {
    const definition = recordDefinition(type);
    // The record's own door first — its module and view grants — then its scope (§223).
    if (!definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) continue;
    const reachable = new Set(await definition.reachable(context, ids));
    for (const id of ids) {
      if (!reachable.has(id)) continue;
      const summary = await definition.find(context, id);
      if (summary) summaries.set(`${type}:${id}`, { label: summary.label, href: summary.href });
    }
  }
  for (const link of links) {
    const domain = link.targetModule === "hse" ? "hse" : "qaqc";
    const summary = summaries.get(`${link.targetEntityType}:${link.targetEntityId}`);
    const noun = recordDefinition(link.targetEntityType)?.noun ?? "Record";
    result.push({
      linkId: link.id,
      domain,
      recordType: link.targetEntityType,
      recordId: link.targetEntityId,
      // Somebody without the module sees that the day has a record, never what it says (§69).
      label: summary ? summary.label : domain === "hse" ? (link.targetEntityType === "incident" ? "HSE incident recorded" : "HSE record") : "QA/QC record",
      detail: summary ? noun : null,
      status: null,
      href: summary?.href ?? null,
      restricted: !summary,
    });
  }
  return result;
}

async function evidence(context: UserContext, row: DetailRow): Promise<EvidenceDTO[] | null> {
  if (!canAccessModule(context, "documents") || !can(context, "document.view")) return null;
  const { data } = await listDocuments(context, documentListQuerySchema.parse({ entityType: RECORD, entityId: row.id, limit: 100 }));
  const meta = new Map(row.documentLinks.map((link) => [link.documentId, link]));
  return data
    .map((document): EvidenceDTO => {
      const link = meta.get(document.id);
      const isImage = Boolean(document.mimeType?.startsWith("image/")) || ["jpg", "jpeg", "png", "webp", "gif", "heic"].includes((document.extension ?? "").toLowerCase());
      return {
        documentId: document.id,
        name: document.name,
        fileName: document.originalFileName,
        mimeType: document.mimeType,
        extension: document.extension,
        category: (link?.category ?? (isImage ? "PHOTO" : "OTHER")) as DocumentCategory,
        caption: link?.caption ?? null,
        takenAt: link?.takenAt?.toISOString() ?? null,
        uploadedAt: document.createdAt,
        uploadedBy: document.uploadedBy?.fullName ?? null,
        uploadedByMemberId: document.uploadedBy?.memberId ?? null,
        href: `/documents/${document.id}`,
        previewHref: isImage && document.storageStatus === "AVAILABLE" ? `/api/documents/${document.id}/preview` : null,
        isImage,
      };
    })
    .sort((a, b) => (meta.get(a.documentId)?.sortOrder ?? 9_999) - (meta.get(b.documentId)?.sortOrder ?? 9_999) || a.uploadedAt.localeCompare(b.uploadedAt));
}

function issuesFor(row: DetailRow, evidenceCount: number): DailyLogIssue[] {
  const issues: DailyLogIssue[] = [];
  // §185: something observed on the day — work, people, or evidence.
  if (row.workActivities.length === 0 && row.workforce.length === 0 && evidenceCount === 0) {
    issues.push({ section: "activities", message: "Record at least one work activity, workforce entry or photo." });
  }
  for (const entry of row.workforce) if (entry.headcount < 1) issues.push({ section: "workforce", message: `${entry.organizationName}: headcount must be at least 1.` });
  for (const entry of row.workActivities) {
    const value = decimal(entry.progressPercent);
    if (value !== null && (value < 0 || value > 100)) issues.push({ section: "activities", message: `${entry.title}: progress must be between 0 and 100%.` });
  }
  return issues;
}

export async function getDailyLog(context: UserContext, dailyLogId: string): Promise<DailyLogDetailDTO> {
  const started = Date.now();
  const log = await findReadableLog(context, dailyLogId);
  const row = await prisma.dailyLog.findUniqueOrThrow({ where: { id: log.id }, include: DETAIL_INCLUDE });
  const settings = await resolveDailyLogSettings(context.companyId, row.projectId);
  const zone = settings.timezone;
  const workDate = dateOf(row.workDate);

  const [refs, records, files, activities] = await Promise.all([
    referenceLabels(context, row),
    linkedRecords(context, row.id),
    evidence(context, row),
    prisma.activity.findMany({ where: { companyId: context.companyId, entityType: ACTIVITY_ENTITY, entityId: row.id }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, action: true, actorMemberId: true, createdAt: true, metadata: true } }),
  ]);
  const people = await names(context.companyId, [
    row.createdByMemberId, row.submittedByMemberId, row.reviewerMemberId, row.reviewedByMemberId, row.lockedByMemberId, row.returnedByMemberId, row.voidedByMemberId,
    ...row.workActivities.map((entry) => entry.createdByMemberId),
    ...row.visitorEntries.map((entry) => entry.escortedByMemberId),
    ...row.instructionEntries.map((entry) => entry.issuedByMemberId),
    ...row.corrections.map((entry) => entry.createdByMemberId),
    ...activities.map((entry) => entry.actorMemberId),
  ]);
  const person = (id: string | null) => (id ? (people.get(id) ?? null) : null);
  const photos = files?.filter((file) => file.category === "PHOTO").length ?? row.documentLinks.filter((link) => link.category === "PHOTO").length;
  const documentsCount = files?.length ?? row.documentLinks.length;

  const status = row.status;
  const editable = isEditable(status);
  const sections = Object.fromEntries([...SECTION_KEYS, "qaqc", "hse"].map((section) => [section, canEditSection(context, status, section as never)])) as DailyLogDetailDTO["capabilities"]["sections"];
  const canCreateTask = editable && can(context, "daily_log.edit") && canAccessModule(context, "tasks") && can(context, "task.create");
  const submitter = row.submittedByMemberId === context.membershipId;

  const HISTORY: Record<string, { label: string; tone: DailyLogHistoryEntry["tone"] }> = {
    DAILY_LOG_CREATED: { label: "Started", tone: "neutral" },
    DAILY_LOG_SUBMITTED: { label: "Submitted", tone: "info" },
    DAILY_LOG_RETURNED: { label: "Returned for correction", tone: "warning" },
    DAILY_LOG_REVIEWED: { label: "Reviewed", tone: "success" },
    DAILY_LOG_LOCKED: { label: "Locked", tone: "success" },
    DAILY_LOG_VOIDED: { label: "Voided", tone: "danger" },
    DAILY_LOG_CORRECTION_ADDED: { label: "Official correction added", tone: "warning" },
    DAILY_LOG_MAJOR_DELAY: { label: "Major delay recorded", tone: "warning" },
  };
  const history: DailyLogHistoryEntry[] = activities
    .filter((entry) => HISTORY[entry.action])
    .map((entry) => ({
      id: entry.id,
      action: HISTORY[entry.action].label,
      actorName: person(entry.actorMemberId)?.name ?? null,
      actorMemberId: person(entry.actorMemberId) ? entry.actorMemberId : null,
      occurredAt: entry.createdAt.toISOString(),
      note: (entry.metadata as { note?: string } | null)?.note ?? null,
      tone: HISTORY[entry.action].tone,
    }));

  const detail: DailyLogDetailDTO = {
    id: row.id,
    project: { id: row.project.id, name: row.project.name, code: row.project.code },
    workDate,
    today: localDate(new Date(), zone),
    status,
    version: row.version,
    lateEntry: row.lateEntry,
    createdBy: person(row.createdByMemberId),
    submittedBy: person(row.submittedByMemberId),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewer: person(row.reviewerMemberId),
    reviewedBy: person(row.reviewedByMemberId),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    lockedBy: person(row.lockedByMemberId),
    lockedAt: row.lockedAt?.toISOString() ?? null,
    returnReason: row.returnReason,
    voidReason: row.voidReason,
    summary: row.summary,
    generalNotes: row.generalNotes,
    delaySummary: row.delaySummary,
    instructionSummary: row.instructionSummary,
    weatherSummary: row.weatherSummary,
    siteCondition: row.siteCondition,
    siteConditionNotes: row.siteConditionNotes,
    weather: row.weatherEntries.map((entry) => ({
      id: entry.id,
      observedAt: clockOf(entry.observedAt, zone) ?? "",
      temperatureC: decimal(entry.temperatureC),
      condition: entry.condition,
      precipitationMm: decimal(entry.precipitationMm),
      windKph: decimal(entry.windKph),
      humidityPct: entry.humidityPct,
      notes: entry.notes,
      updatedAt: entry.updatedAt.toISOString(),
    })),
    workforce: row.workforce.map((entry) => ({ id: entry.id, organizationName: entry.organizationName, supplier: refs.supplier(entry.supplierId), contractor: refs.contractor(entry.contractorId), workPackage: refs.workPackage(entry.workPackageId), trade: entry.trade, crewName: entry.crewName, crewId: entry.crewId, headcount: entry.headcount, notes: entry.notes, updatedAt: entry.updatedAt.toISOString() })),
    activities: row.workActivities.map((entry) => ({
      id: entry.id, title: entry.title, description: entry.description, projectArea: entry.projectArea, floorZone: entry.floorZone, trade: entry.trade,
      progressPercent: decimal(entry.progressPercent), task: refs.task(entry.linkedTaskId), contractor: refs.contractor(entry.contractorId), workPackage: refs.workPackage(entry.workPackageId), createdBy: person(entry.createdByMemberId), updatedAt: entry.updatedAt.toISOString(),
    })),
    equipment: row.equipmentEntries.map((entry) => ({ id: entry.id, equipmentName: entry.equipmentName, equipmentCode: entry.equipmentCode, supplier: refs.supplier(entry.supplierId), quantity: entry.quantity, hoursUsed: decimal(entry.hoursUsed), status: entry.status, notes: entry.notes, updatedAt: entry.updatedAt.toISOString() })),
    deliveries: row.deliveryEntries.map((entry) => ({
      id: entry.id, description: entry.description, supplier: refs.supplier(entry.supplierId), purchaseOrder: refs.order(entry.purchaseOrderId), goodsReceipt: refs.receipt(entry.goodsReceiptId), inventoryReceipt: refs.stock(entry.inventoryReceiptId),
      quantityText: entry.quantityText, deliveredAt: entry.deliveredAt?.toISOString() ?? null, deliveredTime: clockOf(entry.deliveredAt, zone), deliveredDate: entry.deliveredAt ? localDate(entry.deliveredAt, zone) : null, outsideWorkDate: Boolean(entry.deliveredAt && localDate(entry.deliveredAt, zone) !== workDate),
      conditionNote: entry.conditionNote, notes: entry.notes, updatedAt: entry.updatedAt.toISOString(),
    })),
    visitors: row.visitorEntries.map((entry) => ({ id: entry.id, name: entry.name, organization: entry.organization, purpose: entry.purpose, arrivedAt: clockOf(entry.arrivedAt, zone), departedAt: clockOf(entry.departedAt, zone), escortedBy: person(entry.escortedByMemberId), notes: entry.notes, updatedAt: entry.updatedAt.toISOString() })),
    delays: row.delayEntries.map((entry) => ({
      id: entry.id, category: entry.category, title: entry.title, description: entry.description, startedAt: clockOf(entry.startedAt, zone), endedAt: clockOf(entry.endedAt, zone), durationMinutes: entry.durationMinutes,
      responsiblePartyText: entry.responsiblePartyText, impact: entry.impact, task: refs.task(entry.linkedTaskId), updatedAt: entry.updatedAt.toISOString(),
    })),
    instructions: row.instructionEntries.map((entry) => ({
      id: entry.id, title: entry.title, description: entry.description, issuedByText: entry.issuedByText, issuedBy: person(entry.issuedByMemberId), recipientText: entry.recipientText, issuedAt: clockOf(entry.issuedAt, zone),
      requiresAction: entry.requiresAction, task: refs.task(entry.linkedTaskId), updatedAt: entry.updatedAt.toISOString(),
    })),
    tasks: row.taskLinks.map((link) => {
      const visible = refs.visibleTask(link.taskId);
      const task = refs.taskInfo.get(link.taskId);
      return { linkId: link.id, taskId: link.taskId, title: visible && task ? task.title : "A task you cannot open", status: visible && task ? task.status : null, linkType: link.linkType, href: visible ? `/tasks/${link.taskId}` : null, visible };
    }),
    records,
    evidence: files,
    corrections: row.corrections.map((entry) => ({ id: entry.id, reason: entry.reason, correctionSummary: entry.correctionSummary, createdBy: person(entry.createdByMemberId), createdAt: entry.createdAt.toISOString() })),
    history,
    counts: {
      workforce: row.workforce.reduce((sum, entry) => sum + entry.headcount, 0),
      activities: row.workActivities.length,
      equipment: row.equipmentEntries.reduce((sum, entry) => sum + entry.quantity, 0),
      deliveries: row.deliveryEntries.length,
      visitors: row.visitorEntries.length,
      delays: row.delayEntries.length,
      delayMinutes: row.delayEntries.reduce((sum, entry) => sum + (entry.durationMinutes ?? 0), 0),
      instructions: row.instructionEntries.length,
      qaqc: records.filter((record) => record.domain === "qaqc").length,
      hse: records.filter((record) => record.domain === "hse").length,
      photos,
      documents: documentsCount,
      tasks: row.taskLinks.length,
    },
    issues: editable ? issuesFor(row, documentsCount) : [],
    capabilities: {
      canEdit: editable && can(context, "daily_log.edit"),
      sections: { ...sections, tasks: editable && can(context, "daily_log.edit") },
      canSubmit: editable && can(context, "daily_log.submit"),
      canReview: status === "SUBMITTED" && can(context, "daily_log.review") && !submitter,
      canReturn: status === "SUBMITTED" && can(context, "daily_log.return") && !submitter,
      canLock: status === "REVIEWED" && can(context, "daily_log.lock"),
      canVoid: status !== "VOID" && can(context, "daily_log.void"),
      canCorrect: status === "LOCKED" && can(context, "daily_log.correct_locked"),
      canUploadEvidence: editable && can(context, "daily_log.edit") && canAccessModule(context, "documents") && can(context, "document.create"),
      canCreateTask,
      canViewEvidence: files !== null,
    },
  };
  incrementCounter(Metric.DAILY_LOG_DETAIL_DURATION_MS, {}, Date.now() - started);
  return detail;
}
