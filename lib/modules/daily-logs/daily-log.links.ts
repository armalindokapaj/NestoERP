import type { Prisma } from "@prisma/client";
import type { z } from "zod";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertPermission } from "@/lib/access/guards";
import { buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import { isRecordType } from "@/lib/core/records/record.types";
import { prisma } from "@/lib/database/prisma";
import { buildReceiptScopeWhere as buildInventoryReceiptScopeWhere } from "@/lib/modules/inventory/inventory.scope";
import { buildOrderScopeWhere, buildReceiptScopeWhere as buildGoodsReceiptScopeWhere } from "@/lib/modules/procurement/procurement.scope";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import { createTaskFromContext } from "@/lib/modules/tasks/task.service";
import { canEditSection, isEditable, RECORD } from "./daily-log.permissions";
import type { createTaskFromLogSchema, evidenceMetaSchema, linkTaskSchema, recordLinkSchema } from "./daily-log.schema";
import { assertTask } from "./daily-log.entries";
import { fail, findReadableLog, lockedError, RECORD_LINK_TYPE, touchLog, type ReadableLog } from "./daily-log.service";
import { resolveDailyLogSettings } from "./daily-log.settings";
import { addLocalDays, businessInstant, dateOf, timeOn } from "./daily-log.time";

/**
 * What a log points at (PRD #43 §62-§79, §116, §117, §179-§183).
 *
 * Tasks are linked, or created through the task service with the log as their
 * parent — never written here, and never completed from here. QA/QC and HSE
 * records are referenced through integration links, which change nothing on
 * the record; each reader then sees as much of it as their own access allows.
 * Documents are uploaded through the canonical pipeline against the log, and
 * the log keeps only how each file sits in the day's evidence.
 */

const QAQC_TYPES = ["quality_inspection", "non_conformance_report", "quality_defect", "corrective_action"] as const;
const HSE_TYPES = ["incident", "hazard", "toolbox_talk", "work_permit", "hse_inspection", "hse_action"] as const;
const CANDIDATE_LIMIT = 10;

function assertEditable(log: ReadableLog) {
  if (!isEditable(log.status)) throw lockedError(log.status);
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

export async function linkTask(context: UserContext, dailyLogId: string, input: z.infer<typeof linkTaskSchema>) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.edit");
  assertEditable(log);
  await assertTask(context, log, input.taskId);
  return prisma.$transaction(async (tx) => {
    const version = await touchLog(tx, log.id);
    const link = await tx.dailyLogTaskLink.upsert({
      where: { dailyLogId_taskId: { dailyLogId: log.id, taskId: input.taskId } },
      create: { companyId: context.companyId, dailyLogId: log.id, taskId: input.taskId, linkType: input.linkType, createdByMemberId: context.membershipId },
      update: { linkType: input.linkType },
      select: { id: true },
    });
    return { linkId: link.id, version };
  });
}

export async function unlinkTask(context: UserContext, dailyLogId: string, linkId: string) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.edit");
  assertEditable(log);
  return prisma.$transaction(async (tx) => {
    const removed = await tx.dailyLogTaskLink.deleteMany({ where: { id: linkId, dailyLogId: log.id } });
    if (!removed.count) throw fail("DAILY_LOG_LINK_NOT_FOUND", "That link could not be found.", "NOT_FOUND");
    return { version: await touchLog(tx, log.id) };
  });
}

/**
 * A follow-up task raised from the log (§61, §70-§73): created by the task
 * service with the log as its trusted parent and the log's project, then
 * linked — and pointed at from the delay or instruction it answers.
 */
export async function createTaskFromLog(context: UserContext, dailyLogId: string, input: z.infer<typeof createTaskFromLogSchema>) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.edit");
  assertEditable(log);
  if (input.source && !canEditSection(context, log.status, input.source.section)) throw new AccessError("FORBIDDEN", "You cannot change that entry.", { code: "DAILY_LOG_SECTION_FORBIDDEN" });

  if (input.source) {
    const exists =
      input.source.section === "delays"
        ? await prisma.dailyLogDelayEntry.count({ where: { id: input.source.entryId, dailyLogId: log.id } })
        : input.source.section === "instructions"
          ? await prisma.dailyLogInstructionEntry.count({ where: { id: input.source.entryId, dailyLogId: log.id } })
          : await prisma.dailyLogWorkActivity.count({ where: { id: input.source.entryId, dailyLogId: log.id } });
    if (!exists) throw fail("DAILY_LOG_ENTRY_NOT_FOUND", "That entry could not be found.", "NOT_FOUND");
  }

  const task = await createTaskFromContext(context, {
    ...createTaskSchema.parse({
      title: input.title,
      description: input.description ?? undefined,
      projectId: log.projectId,
      assigneeMemberId: input.assigneeMemberId ?? undefined,
      status: "TODO",
      priority: input.priority,
      dueDate: input.dueDate ?? undefined,
    }),
    parentType: RECORD,
    parentId: log.id,
  });

  const linkType = input.source?.section === "delays" ? "DELAY_ACTION" : input.source?.section === "instructions" ? "INSTRUCTION_ACTION" : input.linkType;
  const version = await prisma.$transaction(async (tx) => {
    const next = await touchLog(tx, log.id);
    await tx.dailyLogTaskLink.upsert({
      where: { dailyLogId_taskId: { dailyLogId: log.id, taskId: task.id } },
      create: { companyId: context.companyId, dailyLogId: log.id, taskId: task.id, linkType, createdByMemberId: context.membershipId },
      update: { linkType },
    });
    if (input.source?.section === "delays") await tx.dailyLogDelayEntry.update({ where: { id: input.source.entryId }, data: { linkedTaskId: task.id } });
    if (input.source?.section === "instructions") await tx.dailyLogInstructionEntry.update({ where: { id: input.source.entryId }, data: { linkedTaskId: task.id } });
    if (input.source?.section === "activities") await tx.dailyLogWorkActivity.update({ where: { id: input.source.entryId }, data: { linkedTaskId: task.id } });
    await recordUserAction(context, { actionKey: AuditAction.DAILY_LOG_TASK_CREATED, entity: { type: RECORD, id: log.id }, after: { taskId: task.id, linkType, section: input.source?.section ?? null, entryId: input.source?.entryId ?? null } }, { tx });
    return next;
  });
  return { taskId: task.id, href: `/tasks/${task.id}`, version };
}

/* -------------------------------------------------------------------------- */
/* QA/QC and HSE                                                               */
/* -------------------------------------------------------------------------- */

function domainOf(recordType: string): "qaqc" | "hse" | null {
  if ((QAQC_TYPES as readonly string[]).includes(recordType)) return "qaqc";
  if ((HSE_TYPES as readonly string[]).includes(recordType)) return "hse";
  return null;
}

export async function linkRecord(context: UserContext, dailyLogId: string, input: z.infer<typeof recordLinkSchema>) {
  const log = await findReadableLog(context, dailyLogId);
  const domain = domainOf(input.recordType);
  if (!domain || !isRecordType(input.recordType)) throw fail("DAILY_LOG_RECORD_TYPE_INVALID", "Only QA/QC and HSE records are linked to a daily log.");
  if (!canEditSection(context, log.status, domain)) {
    if (!isEditable(log.status)) throw lockedError(log.status);
    throw new AccessError("FORBIDDEN", "You cannot link records of that kind.", { code: "DAILY_LOG_SECTION_FORBIDDEN" });
  }
  const definition = recordDefinition(input.recordType)!;
  // The writer must be able to open the record, and it must be on this log's project (§191, §223).
  const record = moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions) ? await definition.find(context, input.recordId) : null;
  if (!record) throw fail("DAILY_LOG_RECORD_INVALID", "You cannot link that record.", "NOT_FOUND");
  if (record.projectId && record.projectId !== log.projectId) throw fail("DAILY_LOG_RECORD_PROJECT_MISMATCH", "That record is on another project.");

  return prisma.$transaction(async (tx) => {
    const version = await touchLog(tx, log.id);
    const key = `${log.id}:${input.recordType}:${input.recordId}`;
    const link = await tx.integrationLink.upsert({
      where: { companyId_integrationType_idempotencyKey: { companyId: context.companyId, integrationType: RECORD_LINK_TYPE, idempotencyKey: key } },
      create: {
        companyId: context.companyId, integrationType: RECORD_LINK_TYPE, mode: "REFERENCE",
        sourceModule: "dailyLogs", sourceEntityType: RECORD, sourceEntityId: log.id,
        targetModule: definition.moduleKey, targetEntityType: input.recordType, targetEntityId: input.recordId,
        idempotencyKey: key, createdByMemberId: context.membershipId,
      },
      update: { status: "ACTIVE" },
      select: { id: true },
    });
    return { linkId: link.id, version };
  });
}

export async function unlinkRecord(context: UserContext, dailyLogId: string, linkId: string) {
  const log = await findReadableLog(context, dailyLogId);
  const link = await prisma.integrationLink.findFirst({ where: { id: linkId, companyId: context.companyId, integrationType: RECORD_LINK_TYPE, sourceEntityId: log.id, status: "ACTIVE" }, select: { id: true, targetEntityType: true } });
  if (!link) throw fail("DAILY_LOG_LINK_NOT_FOUND", "That link could not be found.", "NOT_FOUND");
  const domain = domainOf(link.targetEntityType) ?? "qaqc";
  if (!canEditSection(context, log.status, domain)) {
    if (!isEditable(log.status)) throw lockedError(log.status);
    throw new AccessError("FORBIDDEN");
  }
  return prisma.$transaction(async (tx) => {
    const version = await touchLog(tx, log.id);
    await tx.integrationLink.update({ where: { id: link.id }, data: { status: "CANCELLED" } });
    return { version };
  });
}

export type RecordCandidate = { recordType: string; recordId: string; label: string; noun: string; domain: "qaqc" | "hse"; linked: boolean };

/** QA/QC and HSE records on this project around the log's day that this reader could link (§62, §65). */
export async function recordCandidates(context: UserContext, dailyLogId: string): Promise<RecordCandidate[]> {
  const log = await findReadableLog(context, dailyLogId);
  const date = dateOf(log.workDate);
  const settings = await resolveDailyLogSettings(context.companyId, log.projectId);
  const dayStart = timeOn(date, "00:00", settings.timezone)!;
  const dayEnd = timeOn(addLocalDays(date, 1), "00:00", settings.timezone)!;
  const onDay = { gte: new Date(businessInstant(date).getTime() - 12 * 3_600_000), lte: new Date(businessInstant(date).getTime() + 12 * 3_600_000) };
  const base = { companyId: context.companyId, projectId: log.projectId };
  const pick = { select: { id: true }, take: CANDIDATE_LIMIT } as const;

  const wantsQa = canAccessModule(context, "qaqc") && can(context, "daily_log.qaqc.manage");
  const wantsHse = canAccessModule(context, "hse") && can(context, "daily_log.hse.manage");
  const [inspections, ncrs, defects, actions, incidents, hazards, talks, permits, hseInspections, hseActions] = await Promise.all([
    wantsQa ? prisma.qualityInspection.findMany({ where: { ...base, inspectionDate: onDay }, ...pick }) : [],
    wantsQa ? prisma.nonConformanceReport.findMany({ where: { ...base, createdAt: { gte: dayStart, lt: dayEnd } }, ...pick }) : [],
    wantsQa ? prisma.qualityDefect.findMany({ where: { ...base, createdAt: { gte: dayStart, lt: dayEnd } }, ...pick }) : [],
    wantsQa ? prisma.correctiveAction.findMany({ where: { ...base, OR: [{ dueDate: onDay }, { createdAt: { gte: dayStart, lt: dayEnd } }] }, ...pick }) : [],
    wantsHse ? prisma.hseIncident.findMany({ where: { ...base, occurredAt: { gte: dayStart, lt: dayEnd } }, ...pick }) : [],
    wantsHse ? prisma.hseHazard.findMany({ where: { ...base, observedAt: { gte: dayStart, lt: dayEnd } }, ...pick }) : [],
    wantsHse ? prisma.toolboxTalk.findMany({ where: { ...base, talkDate: onDay }, ...pick }) : [],
    wantsHse ? prisma.hseWorkPermit.findMany({ where: { ...base, validFrom: { lte: dayEnd }, validUntil: { gte: dayStart } }, ...pick }) : [],
    wantsHse ? prisma.hseInspection.findMany({ where: { ...base, OR: [{ inspectionDate: onDay }, { scheduledDate: onDay }] }, ...pick }) : [],
    wantsHse ? prisma.hseAction.findMany({ where: { ...base, OR: [{ dueDate: onDay }, { createdAt: { gte: dayStart, lt: dayEnd } }] }, ...pick }) : [],
  ]);
  const found: Array<[string, Array<{ id: string }>]> = [
    ["quality_inspection", inspections], ["non_conformance_report", ncrs], ["quality_defect", defects], ["corrective_action", actions],
    ["incident", incidents], ["hazard", hazards], ["toolbox_talk", talks], ["work_permit", permits], ["hse_inspection", hseInspections], ["hse_action", hseActions],
  ];
  const linked = await prisma.integrationLink.findMany({ where: { companyId: context.companyId, integrationType: RECORD_LINK_TYPE, sourceEntityId: log.id, status: "ACTIVE" }, select: { targetEntityType: true, targetEntityId: true } });
  const linkedKeys = new Set(linked.map((row) => `${row.targetEntityType}:${row.targetEntityId}`));

  const candidates: RecordCandidate[] = [];
  for (const [type, rows] of found) {
    if (!rows.length) continue;
    const definition = recordDefinition(type);
    if (!definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) continue;
    const reachable = await definition.reachable(context, rows.map((row) => row.id));
    for (const id of reachable) {
      const summary = await definition.find(context, id);
      if (!summary) continue;
      candidates.push({ recordType: type, recordId: id, label: summary.label, noun: definition.noun, domain: domainOf(type)!, linked: linkedKeys.has(`${type}:${id}`) });
    }
  }
  return candidates;
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

/** Category, caption and time for a file on the log (§77-§80). The file itself stays the document's. */
export async function setEvidenceMeta(context: UserContext, dailyLogId: string, documentId: string, input: z.infer<typeof evidenceMetaSchema>) {
  const log = await findReadableLog(context, dailyLogId);
  assertPermission(context, "daily_log.edit");
  assertEditable(log);
  const document = await prisma.document.findFirst({ where: { id: documentId, companyId: context.companyId, entityType: RECORD, entityId: log.id }, select: { id: true } });
  if (!document) throw fail("DAILY_LOG_DOCUMENT_NOT_FOUND", "That file is not on this log.", "NOT_FOUND");
  const settings = await resolveDailyLogSettings(context.companyId, log.projectId);
  const takenAt = timeOn(dateOf(log.workDate), input.takenTime, settings.timezone);
  return prisma.$transaction(async (tx) => {
    const version = await touchLog(tx, log.id);
    await tx.dailyLogDocumentLink.upsert({
      where: { dailyLogId_documentId: { dailyLogId: log.id, documentId } },
      create: { dailyLogId: log.id, documentId, companyId: context.companyId, category: input.category, caption: input.caption, takenAt, sortOrder: input.sortOrder },
      update: { category: input.category, caption: input.caption, takenAt, sortOrder: input.sortOrder },
    });
    return { version };
  });
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

/** Options the section forms offer this writer: only what the server would accept (§191). */
export async function entryOptions(context: UserContext, dailyLogId: string) {
  const log = await findReadableLog(context, dailyLogId);
  const procurementOpen = canAccessModule(context, "procurement");
  const project = { projectId: log.projectId } satisfies Prisma.PurchaseOrderWhereInput;
  const [suppliers, orders, receipts, stock, tasks, members] = await Promise.all([
    prisma.supplier.findMany({ where: { companyId: context.companyId, status: { not: "ARCHIVED" } }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true } }),
    procurementOpen && can(context, "procurement.order.view") ? prisma.purchaseOrder.findMany({ where: { AND: [buildOrderScopeWhere(context), project] }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, poNumber: true, supplierId: true } }) : [],
    procurementOpen && can(context, "procurement.receipt.view") ? prisma.goodsReceipt.findMany({ where: { AND: [buildGoodsReceiptScopeWhere(context), { projectId: log.projectId }] }, orderBy: { receiptDate: "desc" }, take: 50, select: { id: true, receiptNumber: true, purchaseOrderId: true } }) : [],
    canAccessModule(context, "inventory") && can(context, "inventory.receipt.view") ? prisma.inventoryReceipt.findMany({ where: buildInventoryReceiptScopeWhere(context), orderBy: { receiptDate: "desc" }, take: 50, select: { id: true, receiptNumber: true } }) : [],
    canAccessModule(context, "tasks") && can(context, "task.view") ? prisma.task.findMany({ where: { AND: [buildTaskScopeWhere(context), { projectId: log.projectId, archivedAt: null }] }, orderBy: [{ status: "asc" }, { title: "asc" }], take: 100, select: { id: true, title: true, status: true } }) : [],
    prisma.companyMember.findMany({ where: { companyId: context.companyId, status: "ACTIVE", OR: [{ projectMemberships: { some: { projectId: log.projectId, status: "ACTIVE" } } }, { managedProjects: { some: { id: log.projectId } } }] }, orderBy: [{ user: { firstName: "asc" } }], take: 200, select: { id: true, user: { select: { firstName: true, lastName: true } } } }),
  ]);
  return {
    suppliers: suppliers.map((row) => ({ id: row.id, label: row.name })),
    purchaseOrders: orders.map((row) => ({ id: row.id, label: row.poNumber, supplierId: row.supplierId })),
    goodsReceipts: receipts.map((row) => ({ id: row.id, label: row.receiptNumber, purchaseOrderId: row.purchaseOrderId })),
    inventoryReceipts: stock.map((row) => ({ id: row.id, label: row.receiptNumber })),
    tasks: tasks.map((row) => ({ id: row.id, label: row.title, status: row.status })),
    members: members.map((row) => ({ id: row.id, label: `${row.user.firstName} ${row.user.lastName}` })),
  };
}
