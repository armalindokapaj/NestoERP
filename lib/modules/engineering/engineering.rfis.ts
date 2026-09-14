import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { loadRecord, moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays } from "@/lib/modules/calendar/calendar.time";
import { recordActivity } from "@/lib/modules/shared/activity";
import { loadEngineeringProject } from "./engineering.documents";
import { tasksFromRecord } from "./engineering.links";
import { notifyEngineering } from "./engineering.notify";
import { engineeringOpen, filesOpen, filesWritable, MODULE, readableEngineeringDocumentWhere, readableRfiWhere, readableSubmittalWhere, RFI_ACTIVITY, RFI_RECORD } from "./engineering.permissions";
import type { CreateRfiInput, RfiListQuery, UpdateRfiInput } from "./engineering.schema";
import { companyToday } from "./engineering.settings";
import {
  ageInDays,
  assertProjectWritable,
  assertResponsible,
  at,
  dateLabel,
  dateOf,
  fail,
  isOverdue,
  people,
  personOf,
  projectArchived,
  projectNumber,
  resolveProjectContext,
  withNumber,
} from "./engineering.shared";
import {
  DRAWING_TYPES,
  RFI_AWAITING_RESPONSE,
  RFI_OPEN_STATUSES,
  RFI_REFERENCE_LABELS,
  type Discipline,
  type Option,
  type RfiDetailDTO,
  type RfiReferenceDTO,
  type RfiReferenceType,
  type RfiRowDTO,
  type RfiStatus,
} from "./engineering.types";

/**
 * Requests for information (PRD #46 §82-§97, §219, §226, §290).
 *
 *   DRAFT → OPEN → ANSWERED → CLOSED, with ANSWERED → CLARIFICATION_REQUIRED → ANSWERED
 *
 * Every step is its own command with its own grant; an update never changes
 * the status (§252). Once open, the question is fixed — anything more is a
 * clarification, and a response, once given, is never edited: a correction is
 * another response (§90). An RFI is technical coordination, not a legal notice
 * or a claim, and nothing here turns it into one (§56, §57).
 */

export const RFI_CONDITIONS = ["RFI_OVERDUE", "RFI_RESPONSE_REQUIRED"] as const;

const RFI_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  rfiNumber: true,
  subject: true,
  question: true,
  discipline: true,
  status: true,
  priority: true,
  raisedByText: true,
  raisedByMemberId: true,
  assignedToMemberId: true,
  dueAt: true,
  openedAt: true,
  answeredAt: true,
  closedAt: true,
  closureNote: true,
  voidReason: true,
  contractorId: true,
  workPackageId: true,
  createdByMemberId: true,
  createdAt: true,
  version: true,
  project: { select: { id: true, name: true, archivedAt: true, status: true, projectManagerMemberId: true } },
  contractor: { select: { id: true, legalName: true } },
  workPackage: { select: { id: true, code: true, name: true } },
  _count: { select: { responses: { where: { clarificationRequest: false } } } },
} satisfies Prisma.RfiSelect;

type RfiRow = Prisma.RfiGetPayload<{ select: typeof RFI_SELECT }>;

async function toRows(context: UserContext, rows: RfiRow[]): Promise<RfiRowDTO[]> {
  const [names, { today }] = await Promise.all([people(context.companyId, rows.map((row) => row.assignedToMemberId)), companyToday(context.companyId)]);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    rfiNumber: row.rfiNumber,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    discipline: row.discipline as Discipline | null,
    contractor: row.contractor ? { id: row.contractor.id, label: row.contractor.legalName, href: `/contractors/${row.contractor.id}` } : null,
    workPackage: row.workPackage ? { id: row.workPackage.id, label: `${row.workPackage.code} · ${row.workPackage.name}`, href: `/projects/${row.projectId}/work-packages/${row.workPackage.id}` } : null,
    assignee: personOf(names, row.assignedToMemberId),
    dueAt: dateOf(row.dueAt),
    overdue: RFI_AWAITING_RESPONSE.includes(row.status) && isOverdue(row.dueAt, today),
    ageDays: ageInDays(row.openedAt ?? row.createdAt, row.closedAt ? dateOf(row.closedAt)! : today),
    responseCount: row._count.responses,
    href: `/projects/${row.projectId}/engineering/rfis/${row.id}`,
  }));
}

export async function listRfis(context: UserContext, query: RfiListQuery): Promise<{ items: RfiRowDTO[]; total: number; page: number; pageSize: number }> {
  assertModule(context, MODULE);
  if (!engineeringOpen(context, "rfi.view")) throw new AccessError("FORBIDDEN", "You cannot open RFIs.");
  if (query.projectId) await loadEngineeringProject(context, query.projectId, "rfi.view");
  const pageSize = 50;
  const { today } = await companyToday(context.companyId);
  const filters: Prisma.RfiWhereInput[] = [readableRfiWhere(context)];
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.status) filters.push({ status: query.status });
  if (query.open) filters.push({ status: { in: RFI_OPEN_STATUSES } });
  if (query.awaiting) filters.push({ status: { in: RFI_AWAITING_RESPONSE } });
  if (query.overdue) filters.push({ status: { in: RFI_AWAITING_RESPONSE }, dueAt: { lt: new Date(`${today}T00:00:00.000Z`) } });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.discipline) filters.push({ discipline: query.discipline });
  if (query.contractorId) filters.push({ contractorId: query.contractorId });
  if (query.workPackageId) filters.push({ workPackageId: query.workPackageId });
  if (query.assignee === "me") filters.push({ assignedToMemberId: context.membershipId });
  if (query.q) filters.push({ OR: [{ rfiNumber: { contains: query.q, mode: "insensitive" } }, { subject: { contains: query.q, mode: "insensitive" } }] });
  const where = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.rfi.findMany({ where, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { rfiNumber: "asc" }], skip: (query.page - 1) * pageSize, take: pageSize, select: RFI_SELECT }),
    prisma.rfi.count({ where }),
  ]);
  return { items: await toRows(context, rows), total, page: query.page, pageSize };
}

export async function findReadableRfi(context: UserContext, id: string): Promise<RfiRow> {
  assertModule(context, MODULE);
  const row = await prisma.rfi.findFirst({ where: { AND: [readableRfiWhere(context), { id }] }, select: RFI_SELECT });
  // A guessed id on another project answers exactly like a missing one (§247).
  if (!row) throw fail("RFI_NOT_FOUND", "That RFI could not be found.", "NOT_FOUND");
  return row;
}

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

const REGISTRY_TYPE: Record<Exclude<RfiReferenceType, "OTHER">, string> = {
  ENGINEERING_DOCUMENT: "engineering_document",
  DRAWING: "engineering_document",
  SUBMITTAL: "technical_submittal",
  MEETING: "meeting",
  DAILY_LOG: "daily_log",
  TASK: "task",
  DOCUMENT: "document",
  CONTRACT: "contract",
};

async function referenceDTOs(context: UserContext, rfiId: string): Promise<RfiReferenceDTO[]> {
  const rows = await prisma.rfiReference.findMany({ where: { companyId: context.companyId, rfiId }, orderBy: { createdAt: "asc" }, take: 100 });
  const resolved = await Promise.all(
    rows.map(async (row): Promise<RfiReferenceDTO | null> => {
      if (row.referenceType === "OTHER") return null;
      const record = await loadRecord(context, REGISTRY_TYPE[row.referenceType], row.referenceId);
      return record ? { id: row.id, type: row.referenceType, typeLabel: RFI_REFERENCE_LABELS[row.referenceType], label: record.label, href: record.href, note: row.note } : null;
    }),
  );
  return resolved.filter((row): row is RfiReferenceDTO => row !== null);
}

export async function getRfi(context: UserContext, id: string): Promise<RfiDetailDTO> {
  const row = await findReadableRfi(context, id);
  const [[base], responses, references, tasks] = await Promise.all([
    toRows(context, [row]),
    prisma.rfiResponse.findMany({ where: { companyId: context.companyId, rfiId: row.id }, orderBy: { respondedAt: "asc" }, take: 200 }),
    referenceDTOs(context, row.id),
    tasksFromRecord(context, RFI_RECORD, row.id),
  ]);
  const names = await people(context.companyId, [row.raisedByMemberId, row.createdByMemberId, ...responses.map((response) => response.respondedByMemberId)]);
  const live = !projectArchived(row.project);
  const open = live && row.status !== "CLOSED" && row.status !== "VOID";
  const responder = row.assignedToMemberId === context.membershipId || can(context, "rfi.close");
  return {
    ...base,
    question: row.question,
    raisedByText: row.raisedByText,
    raisedBy: personOf(names, row.raisedByMemberId),
    createdBy: personOf(names, row.createdByMemberId),
    openedAt: row.openedAt?.toISOString() ?? null,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    closureNote: row.closureNote,
    voidReason: row.voidReason,
    responses: responses.map((response) => ({ id: response.id, text: response.responseText, by: personOf(names, response.respondedByMemberId), at: response.respondedAt.toISOString(), final: response.finalResponse, clarificationRequest: response.clarificationRequest })),
    references,
    tasks,
    version: row.version,
    capabilities: {
      canEdit: open && can(context, "rfi.edit"),
      canOpen: live && row.status === "DRAFT" && can(context, "rfi.open"),
      canRespond: open && row.status !== "DRAFT" && can(context, "rfi.respond") && responder,
      canRequestClarification: open && row.status === "ANSWERED" && can(context, "rfi.edit"),
      canClose: open && row.status === "ANSWERED" && can(context, "rfi.close"),
      canVoid: open && can(context, "rfi.void"),
      canReference: open && (can(context, "rfi.edit") || can(context, "rfi.respond")),
      canCreateTask: open && (can(context, "rfi.edit") || can(context, "rfi.respond")) && can(context, "task.create"),
      canViewFiles: filesOpen(context),
      canUploadFiles: live && row.status !== "CLOSED" && row.status !== "VOID" && filesWritable(context) && can(context, "rfi.respond"),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

const label = (row: { rfiNumber: string }) => `RFI ${row.rfiNumber}`;

async function findWritableRfi(context: UserContext, id: string, permission: "rfi.edit" | "rfi.open" | "rfi.respond" | "rfi.close" | "rfi.void") {
  const row = await findReadableRfi(context, id);
  assertPermission(context, permission);
  assertProjectWritable(row.project);
  if (row.status === "CLOSED" || row.status === "VOID") throw fail("RFI_CLOSED", `This RFI is ${row.status.toLowerCase()}; its record is read-only.`, "CONFLICT");
  return row;
}

async function move(tx: Prisma.TransactionClient, row: RfiRow, from: RfiStatus[], data: Prisma.RfiUpdateManyMutationInput) {
  const moved = await tx.rfi.updateMany({ where: { id: row.id, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
  if (!moved.count) throw fail("RFI_STALE", "This RFI changed since you opened it. Reload to see the latest.", "CONFLICT");
}

async function openInTransaction(tx: Prisma.TransactionClient, context: UserContext, row: { id: string; projectId: string; rfiNumber: string; subject: string; assignedToMemberId: string | null; createdByMemberId: string; version: number }, project: { name: string; projectManagerMemberId: string | null }, due: string) {
  await recordUserAction(context, { actionKey: AuditAction.RFI_OPENED, entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber }, projectId: row.projectId, before: { status: "DRAFT" }, after: { status: "OPEN", assignedToMemberId: row.assignedToMemberId, dueAt: due } }, { tx });
  await recordActivity(tx, context, { module: MODULE, entityType: RFI_ACTIVITY, entityId: row.id, action: "RFI_OPENED", message: `opened ${label(row)}` });
  const common = { companyId: context.companyId, entityType: RFI_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: context.membershipId };
  const payload = { number: row.rfiNumber, subject: row.subject, projectName: project.name, dueDate: due, dateLabel: dateLabel(due) };
  await notifyEngineering(tx, { ...common, eventType: NotificationEvent.RFI_OPENED, memberIds: [project.projectManagerMemberId], payload });
  await notifyEngineering(tx, { ...common, eventType: NotificationEvent.RFI_ASSIGNED, memberIds: [row.assignedToMemberId], payload: { ...payload, assignment: `${row.assignedToMemberId}:${row.version}` } });
  incrementCounter(Metric.RFI_OPENED);
}

export async function createRfi(context: UserContext, projectId: string, input: CreateRfiInput): Promise<{ id: string; rfiNumber: string }> {
  const project = await loadEngineeringProject(context, projectId, "rfi.view");
  assertPermission(context, "rfi.create");
  if (input.open) assertPermission(context, "rfi.open");
  assertProjectWritable(project);
  const [scope] = await Promise.all([
    resolveProjectContext(context.companyId, project.id, input, { newWork: true }),
    assertResponsible(context.companyId, project.id, input.assignedToMemberId, "rfi.respond", "assignedToMemberId"),
  ]);
  const { settings, today } = await companyToday(context.companyId);
  const due = input.dueAt ?? (input.open ? addLocalDays(today, settings.rfiDefaultDueDays) : null);
  if (input.open && due && due < today) throw fail("RFI_DUE_IN_PAST", "An RFI is opened with a due date that is still ahead.", "VALIDATION_ERROR", { field: "dueAt" });

  const created = await withNumber("rfiNumber", input.rfiNumber, { code: "RFI_NUMBER_TAKEN", message: "That RFI number is already used on this project." }, () =>
    prisma.$transaction(async (tx) => {
      const rfiNumber = await projectNumber(tx, {
        companyId: context.companyId,
        moduleKey: MODULE,
        entityType: RFI_RECORD,
        prefix: "RFI",
        manual: input.rfiNumber,
        count: () => tx.rfi.count({ where: { companyId: context.companyId, projectId: project.id } }),
        taken: async (candidate) => (await tx.rfi.count({ where: { companyId: context.companyId, projectId: project.id, rfiNumber: candidate } })) > 0,
      });
      const row = await tx.rfi.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          contractorId: scope.contractorId,
          workPackageId: scope.workPackageId,
          rfiNumber,
          subject: input.subject,
          question: input.question,
          discipline: input.discipline,
          priority: input.priority,
          status: input.open ? "OPEN" : "DRAFT",
          raisedByText: input.raisedByText,
          raisedByMemberId: context.membershipId,
          assignedToMemberId: input.assignedToMemberId,
          dueAt: at(due),
          openedAt: input.open ? new Date() : null,
          createdByMemberId: context.membershipId,
        },
        select: { id: true, projectId: true, rfiNumber: true, subject: true, assignedToMemberId: true, createdByMemberId: true, version: true },
      });
      await recordUserAction(context, { actionKey: AuditAction.RFI_CREATED, entity: { type: RFI_RECORD, id: row.id, label: rfiNumber }, projectId: project.id, after: { rfiNumber, status: input.open ? "OPEN" : "DRAFT", priority: input.priority, contractorId: scope.contractorId, workPackageId: scope.workPackageId, assignedToMemberId: input.assignedToMemberId, dueAt: due } }, { tx });
      if (input.open && due) await openInTransaction(tx, context, row, project, due);
      else await recordActivity(tx, context, { module: MODULE, entityType: RFI_ACTIVITY, entityId: row.id, action: "RFI_CREATED", message: `drafted ${label(row)}` });
      return row;
    }),
  );
  await subscribeStakeholders({ companyId: context.companyId, parentType: RFI_RECORD, parentId: created.id, memberIds: [context.membershipId, ...(input.assignedToMemberId ? [input.assignedToMemberId] : [])] });
  return { id: created.id, rfiNumber: created.rfiNumber };
}

export async function updateRfi(context: UserContext, id: string, input: UpdateRfiInput): Promise<{ id: string; version: number }> {
  const row = await findWritableRfi(context, id, "rfi.edit");
  if (row.status !== "DRAFT" && (input.subject !== row.subject || input.question !== row.question)) {
    throw fail("RFI_QUESTION_LOCKED", "The question is fixed once the RFI is open. Add a clarification or a response instead.", "CONFLICT", { field: "question" });
  }
  const reassigned = input.assignedToMemberId !== row.assignedToMemberId;
  const [scope] = await Promise.all([
    resolveProjectContext(context.companyId, row.projectId, input, { newWork: input.contractorId !== row.contractorId || input.workPackageId !== row.workPackageId }),
    reassigned ? assertResponsible(context.companyId, row.projectId, input.assignedToMemberId, "rfi.respond", "assignedToMemberId") : undefined,
  ]);
  if (row.status !== "DRAFT" && !input.dueAt) throw fail("RFI_DUE_REQUIRED", "An open RFI keeps a due date.", "VALIDATION_ERROR", { field: "dueAt" });
  await prisma.$transaction(async (tx) => {
    const moved = await tx.rfi.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: { notIn: ["CLOSED", "VOID"] } },
      data: { subject: input.subject, question: input.question, priority: input.priority, discipline: input.discipline, contractorId: scope.contractorId, workPackageId: scope.workPackageId, assignedToMemberId: input.assignedToMemberId, dueAt: at(input.dueAt), raisedByText: input.raisedByText, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("RFI_STALE", "This RFI changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.RFI_UPDATED,
        entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber },
        projectId: row.projectId,
        before: { priority: row.priority, discipline: row.discipline, contractorId: row.contractorId, workPackageId: row.workPackageId, assignedToMemberId: row.assignedToMemberId, dueAt: dateOf(row.dueAt) },
        after: { priority: input.priority, discipline: input.discipline, contractorId: scope.contractorId, workPackageId: scope.workPackageId, assignedToMemberId: input.assignedToMemberId, dueAt: input.dueAt },
      },
      { tx },
    );
    if (reassigned && row.status !== "DRAFT") {
      await notifyEngineering(tx, { companyId: context.companyId, eventType: NotificationEvent.RFI_ASSIGNED, entityType: RFI_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: context.membershipId, memberIds: [input.assignedToMemberId], payload: { number: row.rfiNumber, subject: row.subject, dueDate: input.dueAt, dateLabel: dateLabel(input.dueAt), assignment: `${input.assignedToMemberId}:${input.expectedVersion + 1}` } });
    }
  });
  if (reassigned || input.dueAt !== dateOf(row.dueAt)) await resolveAttentionForRecord(prisma, context.companyId, RFI_RECORD, row.id, [...RFI_CONDITIONS]);
  if (reassigned && input.assignedToMemberId) await subscribeStakeholders({ companyId: context.companyId, parentType: RFI_RECORD, parentId: row.id, memberIds: [input.assignedToMemberId] });
  return { id: row.id, version: input.expectedVersion + 1 };
}

export async function openRfi(context: UserContext, id: string): Promise<{ id: string }> {
  const row = await findWritableRfi(context, id, "rfi.open");
  if (row.status !== "DRAFT") throw fail("RFI_NOT_DRAFT", "Only a draft RFI is opened.", "CONFLICT");
  const { settings, today } = await companyToday(context.companyId);
  const due = dateOf(row.dueAt) ?? addLocalDays(today, settings.rfiDefaultDueDays);
  if (due < today) throw fail("RFI_DUE_IN_PAST", "Move the due date forward before opening this RFI.", "VALIDATION_ERROR", { field: "dueAt" });
  await prisma.$transaction(async (tx) => {
    await move(tx, row, ["DRAFT"], { status: "OPEN", openedAt: new Date(), dueAt: at(due) });
    await openInTransaction(tx, context, { ...row, version: row.version + 1 }, row.project, due);
  });
  return { id: row.id };
}

/** An answer is added, never edited; the assignee answers, or somebody who may close RFIs (§89, §90). */
export async function respondRfi(context: UserContext, id: string, input: { text: string; final: boolean }): Promise<{ id: string; responseId: string }> {
  const row = await findWritableRfi(context, id, "rfi.respond");
  if (row.status === "DRAFT") throw fail("RFI_NOT_OPEN", "Open the RFI before answering it.", "CONFLICT");
  if (row.assignedToMemberId !== context.membershipId && !can(context, "rfi.close")) throw fail("RFI_NOT_ASSIGNED", "This RFI is assigned to somebody else.", "FORBIDDEN");
  const now = new Date();
  const response = await prisma.$transaction(async (tx) => {
    const created = await tx.rfiResponse.create({ data: { companyId: context.companyId, rfiId: row.id, responseText: input.text, respondedByMemberId: context.membershipId, respondedAt: now, finalResponse: input.final }, select: { id: true } });
    await move(tx, row, ["OPEN", "CLARIFICATION_REQUIRED", "ANSWERED"], { status: "ANSWERED", answeredAt: row.answeredAt ?? now });
    await recordUserAction(context, { actionKey: AuditAction.RFI_RESPONDED, entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber }, projectId: row.projectId, after: { status: "ANSWERED", responseId: created.id, finalResponse: input.final } }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: RFI_ACTIVITY, entityId: row.id, action: "RFI_ANSWERED", message: `answered ${label(row)}` });
    await notifyEngineering(tx, { companyId: context.companyId, eventType: NotificationEvent.RFI_ANSWERED, entityType: RFI_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: context.membershipId, memberIds: [row.createdByMemberId, row.raisedByMemberId], payload: { number: row.rfiNumber, subject: row.subject, actorName: context.fullName } });
    return created;
  });
  if (!row.answeredAt && row.openedAt) incrementCounter(Metric.RFI_RESPONSE_DURATION, {}, Math.max(0, Math.round((now.getTime() - row.openedAt.getTime()) / 1000)));
  await resolveAttentionForRecord(prisma, context.companyId, RFI_RECORD, row.id, [...RFI_CONDITIONS]);
  return { id: row.id, responseId: response.id };
}

/** "That does not answer it": the loop back to the assignee (§86). */
export async function requestClarification(context: UserContext, id: string, input: { text: string }): Promise<{ id: string }> {
  const row = await findWritableRfi(context, id, "rfi.edit");
  if (row.status !== "ANSWERED") throw fail("RFI_NOT_ANSWERED", "Only an answered RFI goes back for clarification.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    const created = await tx.rfiResponse.create({ data: { companyId: context.companyId, rfiId: row.id, responseText: input.text, respondedByMemberId: context.membershipId, clarificationRequest: true }, select: { id: true } });
    await move(tx, row, ["ANSWERED"], { status: "CLARIFICATION_REQUIRED" });
    await recordUserAction(context, { actionKey: AuditAction.RFI_CLARIFICATION_REQUESTED, entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber }, projectId: row.projectId, after: { status: "CLARIFICATION_REQUIRED", responseId: created.id } }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: RFI_ACTIVITY, entityId: row.id, action: "RFI_CLARIFICATION_REQUIRED", message: `asked for clarification on ${label(row)}` });
    await notifyEngineering(tx, { companyId: context.companyId, eventType: NotificationEvent.RFI_CLARIFICATION_REQUIRED, entityType: RFI_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: context.membershipId, memberIds: [row.assignedToMemberId], payload: { number: row.rfiNumber, subject: row.subject } });
  });
  return { id: row.id };
}

export async function closeRfi(context: UserContext, id: string, input: { note: string | null }): Promise<{ id: string }> {
  const row = await findWritableRfi(context, id, "rfi.close");
  if (row.status !== "ANSWERED") throw fail("RFI_NOT_ANSWERED", "An RFI is closed once it has been answered.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    await move(tx, row, ["ANSWERED"], { status: "CLOSED", closedAt: new Date(), closureNote: input.note });
    await recordUserAction(context, { actionKey: AuditAction.RFI_CLOSED, entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber }, projectId: row.projectId, before: { status: row.status }, after: { status: "CLOSED" } }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: RFI_ACTIVITY, entityId: row.id, action: "RFI_CLOSED", message: `closed ${label(row)}` });
    await notifyEngineering(tx, { companyId: context.companyId, eventType: NotificationEvent.RFI_CLOSED, entityType: RFI_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: context.membershipId, memberIds: [row.assignedToMemberId, row.raisedByMemberId, row.createdByMemberId], payload: { number: row.rfiNumber, subject: row.subject } });
  });
  await resolveAttentionForRecord(prisma, context.companyId, RFI_RECORD, row.id, [...RFI_CONDITIONS]);
  return { id: row.id };
}

export async function voidRfi(context: UserContext, id: string, input: { reason: string }): Promise<{ id: string }> {
  const row = await findWritableRfi(context, id, "rfi.void");
  await prisma.$transaction(async (tx) => {
    await move(tx, row, ["DRAFT", "OPEN", "ANSWERED", "CLARIFICATION_REQUIRED"], { status: "VOID", voidedAt: new Date(), voidReason: input.reason });
    await recordUserAction(context, { actionKey: AuditAction.RFI_VOIDED, entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber }, projectId: row.projectId, before: { status: row.status }, after: { status: "VOID" }, reason: input.reason }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: RFI_ACTIVITY, entityId: row.id, action: "RFI_VOIDED", message: `voided ${label(row)}` });
  });
  await resolveAttentionForRecord(prisma, context.companyId, RFI_RECORD, row.id, [...RFI_CONDITIONS]);
  return { id: row.id };
}

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

async function findReferenceableRfi(context: UserContext, id: string) {
  const row = await findReadableRfi(context, id);
  if (!can(context, "rfi.edit") && !can(context, "rfi.respond")) throw new AccessError("FORBIDDEN", "You cannot change this RFI's references.");
  assertProjectWritable(row.project);
  if (row.status === "CLOSED" || row.status === "VOID") throw fail("RFI_CLOSED", `This RFI is ${row.status.toLowerCase()}; its record is read-only.`, "CONFLICT");
  return row;
}

/** A reference is to a record on the same project that the writer can open (§91, §305). */
export async function addRfiReference(context: UserContext, id: string, input: { referenceType: RfiReferenceType; referenceId: string; note: string | null }): Promise<{ id: string }> {
  const row = await findReferenceableRfi(context, id);
  if (input.referenceType === "OTHER") throw fail("RFI_REFERENCE_INVALID", "Choose the record the RFI refers to.");
  const record = await loadRecord(context, REGISTRY_TYPE[input.referenceType], input.referenceId);
  if (!record || record.companyId !== context.companyId) throw fail("RFI_REFERENCE_INVALID", "You cannot reference that record.", "NOT_FOUND");
  if (record.projectId && record.projectId !== row.projectId) throw fail("RFI_REFERENCE_PROJECT_MISMATCH", "That record belongs to another project.");
  if (input.referenceType === "DRAWING") {
    const drawing = await prisma.engineeringDocument.count({ where: { id: record.id, documentType: { in: DRAWING_TYPES } } });
    if (!drawing) throw fail("RFI_REFERENCE_INVALID", "That document is not a drawing.");
  }
  const existing = await prisma.rfiReference.findFirst({ where: { rfiId: row.id, referenceType: input.referenceType, referenceId: record.id }, select: { id: true } });
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    const created = await tx.rfiReference.create({ data: { companyId: context.companyId, rfiId: row.id, referenceType: input.referenceType, referenceId: record.id, note: input.note, createdByMemberId: context.membershipId }, select: { id: true } });
    await recordUserAction(context, { actionKey: AuditAction.RFI_UPDATED, entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber }, projectId: row.projectId, after: { referenceType: input.referenceType, referenceId: record.id } }, { tx });
    return created;
  });
}

export async function removeRfiReference(context: UserContext, id: string, referenceId: string): Promise<void> {
  const row = await findReferenceableRfi(context, id);
  const reference = await prisma.rfiReference.findFirst({ where: { id: referenceId, rfiId: row.id, companyId: context.companyId } });
  if (!reference) throw fail("RFI_REFERENCE_NOT_FOUND", "That reference could not be found.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.rfiReference.delete({ where: { id: reference.id } });
    await recordUserAction(context, { actionKey: AuditAction.RFI_UPDATED, entity: { type: RFI_RECORD, id: row.id, label: row.rfiNumber }, projectId: row.projectId, after: { referenceType: reference.referenceType, referenceId: reference.referenceId, removed: true } }, { tx });
  });
}

/** Records of one kind on the RFI's project this writer could reference. */
export async function rfiReferenceOptions(context: UserContext, id: string, type: RfiReferenceType): Promise<Option[]> {
  const row = await findReadableRfi(context, id);
  if (type === "OTHER") return [];
  const definition = recordDefinition(REGISTRY_TYPE[type]);
  if (!definition || !moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions)) return [];
  const projectId = row.projectId;
  const companyId = context.companyId;
  let rows: Option[] = [];
  switch (type) {
    case "ENGINEERING_DOCUMENT":
    case "DRAWING":
      rows = (await prisma.engineeringDocument.findMany({ where: { AND: [readableEngineeringDocumentWhere(context), { projectId, status: { not: "VOID" }, ...(type === "DRAWING" ? { documentType: { in: DRAWING_TYPES } } : {}) }] }, orderBy: { documentNumber: "asc" }, take: 300, select: { id: true, documentNumber: true, title: true } })).map((item) => ({ id: item.id, label: `${item.documentNumber} · ${item.title}` }));
      break;
    case "SUBMITTAL":
      rows = (await prisma.technicalSubmittal.findMany({ where: { AND: [readableSubmittalWhere(context), { projectId, status: { not: "VOID" } }] }, orderBy: { submittalNumber: "asc" }, take: 300, select: { id: true, submittalNumber: true, title: true } })).map((item) => ({ id: item.id, label: `${item.submittalNumber} · ${item.title}` }));
      break;
    case "MEETING":
      rows = (await prisma.meeting.findMany({ where: { companyId, projectId, archivedAt: null }, orderBy: { startsAt: "desc" }, take: 100, select: { id: true, title: true, startsAt: true } })).map((item) => ({ id: item.id, label: `${item.title} · ${dateLabel(dateOf(item.startsAt))}` }));
      break;
    case "DAILY_LOG":
      rows = (await prisma.dailyLog.findMany({ where: { companyId, projectId, status: { not: "VOID" } }, orderBy: { workDate: "desc" }, take: 100, select: { id: true, workDate: true } })).map((item) => ({ id: item.id, label: `Daily log · ${dateLabel(dateOf(item.workDate))}` }));
      break;
    case "TASK":
      rows = (await prisma.task.findMany({ where: { companyId, projectId, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true } })).map((item) => ({ id: item.id, label: item.title }));
      break;
    case "DOCUMENT":
      rows = (await prisma.document.findMany({ where: { companyId, projectId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, name: true } })).map((item) => ({ id: item.id, label: item.name }));
      break;
    case "CONTRACT":
      rows = (await prisma.contract.findMany({ where: { companyId, projectId, archivedAt: null }, orderBy: { contractNumber: "asc" }, take: 100, select: { id: true, contractNumber: true, title: true } })).map((item) => ({ id: item.id, label: `${item.contractNumber} · ${item.title}` }));
      break;
  }
  const reachable = new Set(await definition.reachable(context, rows.map((item) => item.id)));
  return rows.filter((item) => reachable.has(item.id));
}
