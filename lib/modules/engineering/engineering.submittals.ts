import type { Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission, stateDenied } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { transitionFor } from "@/lib/core/state/machine";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { loadEngineeringProject, projectEngineeringOptions, type ProjectEngineeringOptions } from "./engineering.documents";
import { linkableTypesFor, listLinks, tasksFromRecord } from "./engineering.links";
import { notifyEngineering } from "./engineering.notify";
import { engineeringOpen, filesOpen, filesWritable, LINK_TYPE, MODULE, readableRfiWhere, readableSubmittalWhere, SUBMITTAL_ACTIVITY, SUBMITTAL_RECORD } from "./engineering.permissions";
import { loadRevisionParent, revisionCapabilities, revisionDTOs, revisionsOf } from "./engineering.revisions";
import type { CreateSubmittalInput, SubmittalListQuery, UpdateSubmittalInput } from "./engineering.schema";
import { companyToday, resolveEngineeringSettings } from "./engineering.settings";
import {
  assertProjectWritable,
  assertResponsible,
  at,
  dateLabel,
  dateOf,
  fail,
  isOverdue,
  LIST_SNAPSHOT,
  people,
  personOf,
  projectArchived,
  projectNumber,
  REGISTER_PAGE_SIZE,
  resolveProjectContext,
  withNumber,
} from "./engineering.shared";
import { submittalRevisionMachine } from "./engineering.submittal-revision.machine";
import { technicalSubmittalMachine } from "./engineering.submittal.machine";
import {
  isMaterialSubmittal,
  isMethodSubmittal,
  LINKABLE_TYPES,
  SUBMITTAL_IN_REVIEW,
  type Discipline,
  type Option,
  type RevisionStatus,
  type SubmittalDetailDTO,
  type SubmittalRowDTO,
  type SubmittalStatus,
  type SubmittalType,
} from "./engineering.types";

/**
 * Technical submittals — shop drawings, material submittals, method statements
 * and the rest (PRD #46 §98-§117, §220, §227, §291).
 *
 * One model, one review workflow; the type decides which details matter —
 * manufacturer and product for a material, activity and work area for a
 * method statement. A material submittal may name the Supplier and link the
 * purchase order, but approving it buys nothing, receives nothing and releases
 * nothing: Procurement and Inventory stay authoritative (§116, §117, §153,
 * §154). A method statement may link HSE and QA/QC records; approving it
 * changes neither (§112, §113).
 */

const SUBMITTAL_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  submittalNumber: true,
  title: true,
  description: true,
  submittalType: true,
  discipline: true,
  status: true,
  assignedReviewerMemberId: true,
  dueAt: true,
  currentRevisionId: true,
  specificationReference: true,
  manufacturer: true,
  productName: true,
  modelNumber: true,
  supplierId: true,
  activity: true,
  workArea: true,
  voidReason: true,
  contractorId: true,
  workPackageId: true,
  createdByMemberId: true,
  version: true,
  project: { select: { id: true, name: true, archivedAt: true, status: true, projectManagerMemberId: true } },
  contractor: { select: { id: true, legalName: true } },
  workPackage: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, name: true } },
  currentRevision: { select: { revisionCode: true, status: true } },
  _count: { select: { revisions: { where: { status: { not: "VOID" } } } } },
} satisfies Prisma.TechnicalSubmittalSelect;

type SubmittalRow = Prisma.TechnicalSubmittalGetPayload<{ select: typeof SUBMITTAL_SELECT }>;

/** Which decisions a submittal is closed out from — the machine's answer, so the button and the command agree. */
const closable = (status: SubmittalStatus) => transitionFor(technicalSubmittalMachine, "close")!.from.includes(status);

async function toRows(context: UserContext, rows: SubmittalRow[]): Promise<SubmittalRowDTO[]> {
  const [names, { today }] = await Promise.all([people(context.companyId, rows.map((row) => row.assignedReviewerMemberId)), companyToday(context.companyId)]);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    submittalNumber: row.submittalNumber,
    title: row.title,
    submittalType: row.submittalType,
    discipline: row.discipline as Discipline | null,
    status: row.status,
    contractor: row.contractor ? { id: row.contractor.id, label: row.contractor.legalName, href: `/contractors/${row.contractor.id}` } : null,
    workPackage: row.workPackage ? { id: row.workPackage.id, label: `${row.workPackage.code} · ${row.workPackage.name}`, href: `/projects/${row.projectId}/work-packages/${row.workPackage.id}` } : null,
    currentRevision: row.currentRevision ? { code: row.currentRevision.revisionCode, status: row.currentRevision.status as RevisionStatus } : null,
    revisionCount: row._count.revisions,
    reviewer: personOf(names, row.assignedReviewerMemberId),
    dueAt: dateOf(row.dueAt),
    overdue: SUBMITTAL_IN_REVIEW.includes(row.status) && isOverdue(row.dueAt, today),
    href: `/projects/${row.projectId}/engineering/submittals/${row.id}`,
  }));
}

/**
 * One register page (AUD-08 §3, §4): authorized scope, then the section
 * (`projectId`, `drawings`/`types`) and the filters, then the order — due date ascending with undated submittals last, then submittal number; the id breaks ties
 * (DT-04) — then the page, all in the database. Rows and total share one
 * snapshot (DT-06); `page` is the request clamped to the last real page, so a
 * page past the end moves there once (DT-05). A project id outside the
 * reader's reach is refused like a missing one (DT-22).
 */
export async function listSubmittals(context: UserContext, query: SubmittalListQuery): Promise<{ items: SubmittalRowDTO[]; total: number; page: number; pageSize: number }> {
  assertModule(context, MODULE);
  if (!engineeringOpen(context, "submittal.view")) throw new AccessError("FORBIDDEN", "You cannot open submittals.");
  if (query.projectId) await loadEngineeringProject(context, query.projectId, "submittal.view");
  const pageSize = REGISTER_PAGE_SIZE;
  const { today } = await companyToday(context.companyId);
  const filters: Prisma.TechnicalSubmittalWhereInput[] = [readableSubmittalWhere(context)];
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.status) filters.push({ status: query.status });
  if (query.type) filters.push({ submittalType: query.type });
  if (query.types?.length) filters.push({ submittalType: { in: query.types } });
  if (query.discipline) filters.push({ discipline: query.discipline });
  if (query.contractorId) filters.push({ contractorId: query.contractorId });
  if (query.workPackageId) filters.push({ workPackageId: query.workPackageId });
  if (query.reviewer === "me") filters.push({ assignedReviewerMemberId: context.membershipId });
  if (query.inReview) filters.push({ status: { in: SUBMITTAL_IN_REVIEW } });
  if (query.overdue) filters.push({ status: { in: SUBMITTAL_IN_REVIEW }, dueAt: { lt: new Date(`${today}T00:00:00.000Z`) } });
  if (query.q) filters.push({ OR: [{ submittalNumber: { contains: query.q, mode: "insensitive" } }, { title: { contains: query.q, mode: "insensitive" } }, { manufacturer: { contains: query.q, mode: "insensitive" } }, { productName: { contains: query.q, mode: "insensitive" } }] });
  const where = { AND: filters };
  const [rows, total] = await prisma.$transaction(
    [prisma.technicalSubmittal.findMany({ where, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { submittalNumber: "asc" }, { id: "asc" }], skip: (query.page - 1) * pageSize, take: pageSize, select: SUBMITTAL_SELECT }), prisma.technicalSubmittal.count({ where })],
    LIST_SNAPSHOT,
  );
  return { items: await toRows(context, rows), total, page: paginationMeta(total, query.page, pageSize).page, pageSize };
}

async function findReadableSubmittal(context: UserContext, id: string): Promise<SubmittalRow> {
  assertModule(context, MODULE);
  const row = await prisma.technicalSubmittal.findFirst({ where: { AND: [readableSubmittalWhere(context), { id }] }, select: SUBMITTAL_SELECT });
  if (!row) throw fail("SUBMITTAL_NOT_FOUND", "That submittal could not be found.", "NOT_FOUND");
  return row;
}

export async function getSubmittal(context: UserContext, id: string): Promise<SubmittalDetailDTO> {
  const row = await findReadableSubmittal(context, id);
  const parent = await loadRevisionParent(context, "submittal", row.id);
  const [[base], revisions, settings, links, tasks, rfis] = await Promise.all([
    toRows(context, [row]),
    revisionsOf(prisma, "submittal", row.id),
    resolveEngineeringSettings(context.companyId),
    listLinks(context, SUBMITTAL_RECORD, row.id),
    tasksFromRecord(context, SUBMITTAL_RECORD, row.id),
    engineeringOpen(context, "rfi.view") ? prisma.rfi.findMany({ where: { AND: [readableRfiWhere(context), { references: { some: { referenceType: "SUBMITTAL", referenceId: row.id } } }] }, take: 50, select: { id: true, projectId: true, rfiNumber: true, subject: true } }) : [],
  ]);
  const live = !projectArchived(row.project) && row.status !== "VOID" && row.status !== "CLOSED";
  const edit = live && can(context, "submittal.edit");
  const supplierVisible = row.supplier && canAccessModule(context, "procurement") && can(context, "procurement.supplier.view");
  return {
    ...base,
    description: row.description,
    specificationReference: row.specificationReference,
    manufacturer: row.manufacturer,
    productName: row.productName,
    modelNumber: row.modelNumber,
    supplier: supplierVisible ? { id: row.supplier!.id, label: row.supplier!.name, href: `/procurement/suppliers/${row.supplier!.id}` } : null,
    activity: row.activity,
    workArea: row.workArea,
    voidReason: row.voidReason,
    revisions: await revisionDTOs(context, parent, revisions),
    revisionCapabilities: Object.fromEntries(revisions.map((revision) => [revision.id, revisionCapabilities(context, parent, revision, settings)])),
    links: [...links, ...tasks.map((task) => ({ linkId: "", type: "task" as const, typeLabel: "Task", id: task.id, label: task.label, href: task.href }))],
    linkedRfis: rfis.map((rfi) => ({ id: rfi.id, label: `${rfi.rfiNumber} · ${rfi.subject}`, href: `/projects/${rfi.projectId}/engineering/rfis/${rfi.id}` })),
    version: row.version,
    capabilities: {
      canEdit: edit,
      canAddRevision: edit,
      // A decided submittal is closed out by the people who decide them (§227).
      canClose: live && closable(row.status) && can(context, "submittal.approve"),
      canVoid: live && can(context, "submittal.edit") && can(context, "submittal.approve"),
      canLink: edit && linkableTypesFor(context, LINKABLE_TYPES).length > 0,
      canCreateTask: edit && can(context, "task.create"),
      canViewFiles: filesOpen(context),
      canUploadFiles: edit && filesWritable(context),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** The Supplier on a material submittal is Procurement's record, from this company (§116, §244). */
async function assertSupplier(context: UserContext, supplierId: string | null, current: string | null = null) {
  if (!supplierId || supplierId === current) return;
  if (!canAccessModule(context, "procurement") || !can(context, "procurement.supplier.view")) throw fail("SUBMITTAL_SUPPLIER_FORBIDDEN", "You cannot link suppliers.", "FORBIDDEN", { field: "supplierId" });
  const found = await prisma.supplier.count({ where: { id: supplierId, companyId: context.companyId, archivedAt: null } });
  if (!found) throw fail("SUBMITTAL_SUPPLIER_INVALID", "That supplier could not be found.", "VALIDATION_ERROR", { field: "supplierId" });
}

/**
 * The product fields describe a product submittal and the method fields a
 * method statement; for any other type they are cleared, whatever was sent —
 * the server's half of the dialog's conditional fields (AUD-09 §5, FV-10).
 */
function typedDetails(input: { submittalType: string; manufacturer: string | null; productName: string | null; modelNumber: string | null; supplierId: string | null; activity: string | null; workArea: string | null }) {
  const material = isMaterialSubmittal(input.submittalType);
  const method = isMethodSubmittal(input.submittalType);
  return {
    manufacturer: material ? input.manufacturer : null,
    productName: material ? input.productName : null,
    modelNumber: material ? input.modelNumber : null,
    supplierId: material ? input.supplierId : null,
    activity: method ? input.activity : null,
    workArea: method ? input.workArea : null,
  };
}

function detailData(input: CreateSubmittalInput | (Omit<UpdateSubmittalInput, "supplierId"> & { supplierId: string | null })) {
  return {
    title: input.title,
    description: input.description,
    submittalType: input.submittalType as SubmittalType,
    discipline: input.discipline,
    assignedReviewerMemberId: input.assignedReviewerMemberId,
    dueAt: at(input.dueAt),
    specificationReference: input.specificationReference,
    ...typedDetails(input),
  };
}

export async function createSubmittal(context: UserContext, projectId: string, input: CreateSubmittalInput): Promise<{ id: string; submittalNumber: string }> {
  const project = await loadEngineeringProject(context, projectId, "submittal.view");
  assertPermission(context, "submittal.create");
  assertProjectWritable(project);
  const settings = await resolveEngineeringSettings(context.companyId);
  if (settings.requireSubmittalDueDate && !input.dueAt) throw fail("SUBMITTAL_DUE_REQUIRED", "Give the review a due date.", "VALIDATION_ERROR", { field: "dueAt" });
  const [scope] = await Promise.all([
    resolveProjectContext(context, project.id, input, { newWork: true }),
    assertResponsible(context.companyId, project.id, input.assignedReviewerMemberId, "submittal.review", "assignedReviewerMemberId"),
    assertSupplier(context, typedDetails(input).supplierId),
  ]);
  const created = await withNumber("submittalNumber", input.submittalNumber, { code: "SUBMITTAL_NUMBER_TAKEN", message: "That submittal number is already used on this project." }, () =>
    prisma.$transaction(async (tx) => {
      const submittalNumber = await projectNumber(tx, {
        companyId: context.companyId,
        moduleKey: MODULE,
        entityType: SUBMITTAL_RECORD,
        prefix: "SUB",
        manual: input.submittalNumber,
        count: () => tx.technicalSubmittal.count({ where: { companyId: context.companyId, projectId: project.id } }),
        taken: async (candidate) => (await tx.technicalSubmittal.count({ where: { companyId: context.companyId, projectId: project.id, submittalNumber: candidate } })) > 0,
      });
      const row = await tx.technicalSubmittal.create({
        data: { companyId: context.companyId, projectId: project.id, contractorId: scope.contractorId, workPackageId: scope.workPackageId, submittalNumber, ...detailData(input), createdByMemberId: context.membershipId },
        select: { id: true, submittalNumber: true },
      });
      await recordActivity(tx, context, { module: MODULE, entityType: SUBMITTAL_ACTIVITY, entityId: row.id, action: "SUBMITTAL_CREATED", message: `registered submittal ${submittalNumber} ${input.title}` });
      await recordUserAction(context, { actionKey: AuditAction.SUBMITTAL_CREATED, entity: { type: SUBMITTAL_RECORD, id: row.id, label: submittalNumber }, projectId: project.id, after: { submittalNumber, submittalType: input.submittalType, contractorId: scope.contractorId, workPackageId: scope.workPackageId, assignedReviewerMemberId: input.assignedReviewerMemberId, dueAt: input.dueAt, supplierId: input.supplierId } }, { tx });
      if (input.assignedReviewerMemberId) {
        await notifyEngineering(tx, { companyId: context.companyId, eventType: NotificationEvent.SUBMITTAL_REVIEW_ASSIGNED, entityType: SUBMITTAL_RECORD, entityId: row.id, projectId: project.id, actorMemberId: context.membershipId, memberIds: [input.assignedReviewerMemberId], payload: { number: submittalNumber, title: input.title, assignment: `${input.assignedReviewerMemberId}:1` } });
      }
      return row;
    }),
  );
  await subscribeStakeholders({ companyId: context.companyId, parentType: SUBMITTAL_RECORD, parentId: created.id, memberIds: [context.membershipId, ...(input.assignedReviewerMemberId ? [input.assignedReviewerMemberId] : [])] });
  return created;
}

async function findWritableSubmittal(context: UserContext, id: string) {
  const row = await findReadableSubmittal(context, id);
  assertPermission(context, "submittal.edit");
  assertProjectWritable(row.project);
  if (row.status === "VOID" || row.status === "CLOSED") throw fail("SUBMITTAL_CLOSED", `This submittal is ${row.status.toLowerCase()}; its record is read-only.`, "CONFLICT");
  return row;
}

/** With the reviewer, or decided: what is being (or was) reviewed. */
const FROZEN_DETAIL_STATUSES: SubmittalStatus[] = [...SUBMITTAL_IN_REVIEW, "APPROVED", "APPROVED_WITH_COMMENTS", "REJECTED"];
const FROZEN_DETAIL_FIELDS = ["submittalType", "specificationReference", "manufacturer", "productName", "modelNumber", "supplierId"] as const;

/**
 * What the reviewer is looking at — the product, its make and model, the
 * specification clause, the supplier and the kind of submittal — does not
 * change under them, nor after they decided (PRD #46 §102, §117, PRD #47 §85,
 * §87). An approval of one product is never quietly carried over to another:
 * a changed product is a new revision after "revision required", or a new
 * submittal.
 */
function assertDetailsUnfrozen(row: SubmittalRow, input: Record<(typeof FROZEN_DETAIL_FIELDS)[number], string | null>) {
  if (!FROZEN_DETAIL_STATUSES.includes(row.status)) return;
  const changed = FROZEN_DETAIL_FIELDS.filter((field) => (input[field] ?? null) !== (row[field] ?? null));
  if (!changed.length) return;
  const when = SUBMITTAL_IN_REVIEW.includes(row.status) ? "while it is under review" : "once it has been decided";
  throw stateDenied(`The submitted product details cannot change ${when}.`, { code: "SUBMITTAL_DETAILS_FROZEN", fields: changed });
}

export async function updateSubmittal(context: UserContext, id: string, sent: UpdateSubmittalInput): Promise<{ id: string; version: number }> {
  const row = await findWritableSubmittal(context, id);
  // An absent supplier is the one stored (AUD-09 §4, FV-05); the type rule then decides whether it stays.
  const input = { ...sent, supplierId: sent.supplierId === undefined ? row.supplierId : sent.supplierId };
  const details = typedDetails(input);
  assertDetailsUnfrozen(row, { submittalType: input.submittalType, specificationReference: input.specificationReference, ...details });
  // The company's rule holds on an edit as on a create: a required due date cannot be cleared (AUD-09 §4, FV-04).
  if (!input.dueAt && row.dueAt && (await resolveEngineeringSettings(context.companyId)).requireSubmittalDueDate) throw fail("SUBMITTAL_DUE_REQUIRED", "Give the review a due date.", "VALIDATION_ERROR", { field: "dueAt" });
  const reassigned = input.assignedReviewerMemberId !== row.assignedReviewerMemberId;
  const [scope] = await Promise.all([
    resolveProjectContext(context, row.projectId, input, { newWork: input.contractorId !== row.contractorId || input.workPackageId !== row.workPackageId }),
    reassigned ? assertResponsible(context.companyId, row.projectId, input.assignedReviewerMemberId, "submittal.review", "assignedReviewerMemberId") : undefined,
    assertSupplier(context, details.supplierId, row.supplierId),
  ]);
  await prisma.$transaction(async (tx) => {
    // The version guard also keeps the freeze honest: a decision in between moves the version on.
    const moved = await tx.technicalSubmittal.updateMany({ where: { id: row.id, version: input.expectedVersion, status: { notIn: ["VOID", "CLOSED"] } }, data: { ...detailData(input), contractorId: scope.contractorId, workPackageId: scope.workPackageId, version: { increment: 1 } } });
    if (!moved.count) throw fail("SUBMITTAL_STALE", "This submittal changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.SUBMITTAL_UPDATED,
        entity: { type: SUBMITTAL_RECORD, id: row.id, label: row.submittalNumber },
        projectId: row.projectId,
        before: { title: row.title, submittalType: row.submittalType, discipline: row.discipline, contractorId: row.contractorId, workPackageId: row.workPackageId, assignedReviewerMemberId: row.assignedReviewerMemberId, dueAt: dateOf(row.dueAt), supplierId: row.supplierId, manufacturer: row.manufacturer, productName: row.productName, modelNumber: row.modelNumber },
        after: { title: input.title, submittalType: input.submittalType, discipline: input.discipline, contractorId: scope.contractorId, workPackageId: scope.workPackageId, assignedReviewerMemberId: input.assignedReviewerMemberId, dueAt: input.dueAt, supplierId: details.supplierId, manufacturer: details.manufacturer, productName: details.productName, modelNumber: details.modelNumber },
      },
      { tx },
    );
    if (reassigned) {
      await notifyEngineering(tx, { companyId: context.companyId, eventType: NotificationEvent.SUBMITTAL_REVIEW_ASSIGNED, entityType: SUBMITTAL_RECORD, entityId: row.id, projectId: row.projectId, actorMemberId: context.membershipId, memberIds: [input.assignedReviewerMemberId], payload: { number: row.submittalNumber, title: input.title, dueDate: input.dueAt, dateLabel: dateLabel(input.dueAt), assignment: `${input.assignedReviewerMemberId}:${input.expectedVersion + 1}` } });
    }
  });
  if (reassigned || input.dueAt !== dateOf(row.dueAt)) await resolveAttentionForRecord(prisma, context.companyId, SUBMITTAL_RECORD, row.id, ["SUBMITTAL_REVIEW_OVERDUE"]);
  if (reassigned && input.assignedReviewerMemberId) await subscribeStakeholders({ companyId: context.companyId, parentType: SUBMITTAL_RECORD, parentId: row.id, memberIds: [input.assignedReviewerMemberId] });
  return { id: row.id, version: input.expectedVersion + 1 };
}

export async function closeSubmittal(context: UserContext, id: string): Promise<{ id: string }> {
  const row = await findWritableSubmittal(context, id);
  assertPermission(context, "submittal.approve");
  if (!closable(row.status)) throw fail("SUBMITTAL_NOT_DECIDED", "A submittal is closed once its review has a final decision.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, { machine: technicalSubmittalMachine, action: "close", id: row.id, context, from: row.status, data: { closedAt: new Date(), version: { increment: 1 } } });
    await recordUserAction(context, { actionKey: AuditAction.SUBMITTAL_CLOSED, entity: { type: SUBMITTAL_RECORD, id: row.id, label: row.submittalNumber }, projectId: row.projectId, before: { status: row.status }, after: { status: "CLOSED" } }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: SUBMITTAL_ACTIVITY, entityId: row.id, action: "SUBMITTAL_CLOSED", message: `closed submittal ${row.submittalNumber}` });
  });
  await resolveAttentionForRecord(prisma, context.companyId, SUBMITTAL_RECORD, row.id, ["SUBMITTAL_REVIEW_OVERDUE", "SUBMITTAL_REVISION_REQUIRED"]);
  return { id: row.id };
}

export async function voidSubmittal(context: UserContext, id: string, input: { reason: string }): Promise<{ id: string }> {
  const row = await findWritableSubmittal(context, id);
  assertPermission(context, "submittal.approve");
  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, { machine: technicalSubmittalMachine, action: "void", id: row.id, context, from: row.status, reason: input.reason, data: { voidedAt: new Date(), voidReason: input.reason, version: { increment: 1 } } });
    // A draft left behind has nothing to become; each is discarded from the draft it still is.
    const drafts = await tx.technicalSubmittalRevision.findMany({ where: { submittalId: row.id, status: "DRAFT" }, select: { id: true, status: true } });
    for (const draft of drafts) {
      await applyTransition(tx, { machine: submittalRevisionMachine, action: "void", id: draft.id, context, from: draft.status, data: { voidedAt: new Date() } });
    }
    await recordUserAction(context, { actionKey: AuditAction.SUBMITTAL_VOIDED, entity: { type: SUBMITTAL_RECORD, id: row.id, label: row.submittalNumber }, projectId: row.projectId, before: { status: row.status }, after: { status: "VOID" }, reason: input.reason }, { tx });
    await recordActivity(tx, context, { module: MODULE, entityType: SUBMITTAL_ACTIVITY, entityId: row.id, action: "SUBMITTAL_VOIDED", message: `voided submittal ${row.submittalNumber}` });
  });
  await resolveAttentionForRecord(prisma, context.companyId, SUBMITTAL_RECORD, row.id, ["SUBMITTAL_REVIEW_OVERDUE", "SUBMITTAL_REVISION_REQUIRED"]);
  return { id: row.id };
}

export async function submittalOptions(context: UserContext, projectId: string): Promise<ProjectEngineeringOptions & { suppliers: Option[] }> {
  const [base, suppliers] = await Promise.all([
    projectEngineeringOptions(context, projectId, "submittal.review"),
    canAccessModule(context, "procurement") && can(context, "procurement.supplier.view") ? prisma.supplier.findMany({ where: { companyId: context.companyId, archivedAt: null }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true } }) : [],
  ]);
  return { ...base, suppliers: suppliers.map((row) => ({ id: row.id, label: row.name })) };
}

/** Drawings and documents a submittal points at, through links, for the drawing register (§79). */
export async function submittalIdsLinkedTo(companyId: string, documentId: string): Promise<string[]> {
  const rows = await prisma.integrationLink.findMany({ where: { companyId, integrationType: LINK_TYPE, status: "ACTIVE", sourceEntityType: SUBMITTAL_RECORD, targetEntityType: "engineering_document", targetEntityId: documentId }, select: { sourceEntityId: true } });
  return rows.map((row) => row.sourceEntityId);
}
