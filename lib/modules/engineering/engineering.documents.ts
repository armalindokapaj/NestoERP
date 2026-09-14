import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { linkableTypesFor, listLinks, tasksFromRecord } from "./engineering.links";
import {
  DOCUMENT_ACTIVITY,
  DOCUMENT_RECORD,
  engineeringOpen,
  engineeringProjectDoor,
  filesOpen,
  filesWritable,
  LINK_TYPE,
  MODULE,
  readableEngineeringDocumentWhere,
  readableRfiWhere,
  readableSubmittalWhere,
  readableTransmittalWhere,
} from "./engineering.permissions";
import { loadRevisionParent, revisionCapabilities, revisionDTOs, revisionsOf } from "./engineering.revisions";
import type { CreateEngineeringDocumentInput, EngineeringDocumentListQuery, UpdateEngineeringDocumentInput } from "./engineering.schema";
import { companyToday, resolveEngineeringSettings } from "./engineering.settings";
import {
  assertProjectWritable,
  assertResponsible,
  at,
  dateOf,
  fail,
  isOverdue,
  isUniqueViolation,
  loadProjectThrough,
  memberOptions,
  people,
  personOf,
  projectArchived,
  resolveProjectContext,
  type ProjectRef,
} from "./engineering.shared";
import {
  DRAWING_TYPES,
  LINKABLE_TYPES,
  type Discipline,
  type EngineeringDocumentDetailDTO,
  type EngineeringDocumentRowDTO,
  type EngineeringDocumentType,
  type Option,
  type RevisionStatus,
} from "./engineering.types";

/**
 * The engineering document and drawing register (PRD #46 §59-§65, §76-§81,
 * §169, §217, §288).
 *
 * Metadata and review state live here; every file is a Document on the record.
 * A document number is unique on its project and is the company's own format
 * (§64, §65). The drawing register is this register narrowed to drawings and
 * shop drawings (§76). A superseded or void document stays readable, clearly
 * marked, and takes no new revisions (§81).
 */

const DOCUMENT_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  documentNumber: true,
  title: true,
  documentType: true,
  discipline: true,
  status: true,
  currentRevisionId: true,
  authorText: true,
  responsibleMemberId: true,
  reviewerMemberId: true,
  reviewDueAt: true,
  voidReason: true,
  contractorId: true,
  workPackageId: true,
  createdByMemberId: true,
  version: true,
  project: { select: { id: true, name: true, archivedAt: true, status: true } },
  contractor: { select: { id: true, legalName: true } },
  workPackage: { select: { id: true, code: true, name: true } },
  currentRevision: { select: { revisionCode: true, status: true, submittedAt: true } },
  _count: { select: { revisions: { where: { status: { not: "VOID" } } } } },
} satisfies Prisma.EngineeringDocumentSelect;

type DocumentRow = Prisma.EngineeringDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

const AWAITING = ["SUBMITTED", "UNDER_REVIEW"] as const;

async function toRows(context: UserContext, rows: DocumentRow[]): Promise<EngineeringDocumentRowDTO[]> {
  const [names, { today }] = await Promise.all([people(context.companyId, rows.map((row) => row.reviewerMemberId)), companyToday(context.companyId)]);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    documentNumber: row.documentNumber,
    title: row.title,
    documentType: row.documentType,
    discipline: row.discipline as Discipline,
    status: row.status,
    contractor: row.contractor ? { id: row.contractor.id, label: row.contractor.legalName, href: `/contractors/${row.contractor.id}` } : null,
    workPackage: row.workPackage ? { id: row.workPackage.id, label: `${row.workPackage.code} · ${row.workPackage.name}`, href: `/projects/${row.projectId}/work-packages/${row.workPackage.id}` } : null,
    currentRevision: row.currentRevision ? { code: row.currentRevision.revisionCode, status: row.currentRevision.status as RevisionStatus, submittedAt: row.currentRevision.submittedAt?.toISOString() ?? null } : null,
    revisionCount: row._count.revisions,
    reviewer: personOf(names, row.reviewerMemberId),
    reviewDueAt: dateOf(row.reviewDueAt),
    overdue: (AWAITING as readonly string[]).includes(row.status) && isOverdue(row.reviewDueAt, today),
    href: `/projects/${row.projectId}/engineering/documents/${row.id}`,
  }));
}

export async function loadEngineeringProject(context: UserContext, projectId: string, permission: Parameters<typeof engineeringProjectDoor>[1] = "rfi.view"): Promise<ProjectRef> {
  assertModule(context, MODULE);
  return loadProjectThrough(engineeringProjectDoor(context, permission), projectId, "You cannot open this project's engineering records.");
}

export async function listEngineeringDocuments(context: UserContext, query: EngineeringDocumentListQuery): Promise<{ items: EngineeringDocumentRowDTO[]; total: number; page: number; pageSize: number }> {
  assertModule(context, MODULE);
  if (!engineeringOpen(context, "engineering_document.view")) throw new AccessError("FORBIDDEN", "You cannot open the document register.");
  if (query.projectId) await loadEngineeringProject(context, query.projectId, "engineering_document.view");
  const pageSize = 50;
  const filters: Prisma.EngineeringDocumentWhereInput[] = [readableEngineeringDocumentWhere(context)];
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.drawings) filters.push({ documentType: { in: DRAWING_TYPES } });
  if (query.type) filters.push({ documentType: query.type });
  if (query.status) filters.push({ status: query.status });
  if (query.discipline) filters.push({ discipline: query.discipline });
  if (query.contractorId) filters.push({ contractorId: query.contractorId });
  if (query.workPackageId) filters.push({ workPackageId: query.workPackageId });
  if (query.reviewer === "me") filters.push({ reviewerMemberId: context.membershipId });
  if (query.awaitingReview) filters.push({ status: { in: [...AWAITING] } });
  if (query.q) filters.push({ OR: [{ documentNumber: { contains: query.q, mode: "insensitive" } }, { title: { contains: query.q, mode: "insensitive" } }] });
  const where = { AND: filters };
  const [rows, total] = await Promise.all([
    prisma.engineeringDocument.findMany({ where, orderBy: [{ project: { name: "asc" } }, { documentNumber: "asc" }], skip: (query.page - 1) * pageSize, take: pageSize, select: DOCUMENT_SELECT }),
    prisma.engineeringDocument.count({ where }),
  ]);
  return { items: await toRows(context, rows), total, page: query.page, pageSize };
}

export async function getEngineeringDocument(context: UserContext, id: string): Promise<EngineeringDocumentDetailDTO> {
  assertModule(context, MODULE);
  const row = await prisma.engineeringDocument.findFirst({ where: { AND: [readableEngineeringDocumentWhere(context), { id }] }, select: DOCUMENT_SELECT });
  if (!row) throw fail("ENGINEERING_DOCUMENT_NOT_FOUND", "That document could not be found.", "NOT_FOUND");
  const parent = await loadRevisionParent(context, "document", row.id);
  const [[base], names, revisions, settings, links, tasks, rfiRefs, submittalLinks, transmittalItems] = await Promise.all([
    toRows(context, [row]),
    people(context.companyId, [row.responsibleMemberId]),
    revisionsOf(prisma, "document", row.id),
    resolveEngineeringSettings(context.companyId),
    listLinks(context, DOCUMENT_RECORD, row.id),
    tasksFromRecord(context, DOCUMENT_RECORD, row.id),
    engineeringOpen(context, "rfi.view") ? prisma.rfi.findMany({ where: { AND: [readableRfiWhere(context), { references: { some: { referenceType: { in: ["ENGINEERING_DOCUMENT", "DRAWING"] }, referenceId: row.id } } }] }, orderBy: { rfiNumber: "asc" }, take: 50, select: { id: true, projectId: true, rfiNumber: true, subject: true } }) : [],
    prisma.integrationLink.findMany({ where: { companyId: context.companyId, integrationType: LINK_TYPE, status: "ACTIVE", OR: [{ sourceEntityType: "technical_submittal", targetEntityType: DOCUMENT_RECORD, targetEntityId: row.id }, { sourceEntityType: DOCUMENT_RECORD, sourceEntityId: row.id, targetEntityType: "technical_submittal" }] }, select: { sourceEntityId: true, targetEntityId: true, sourceEntityType: true } }),
    engineeringOpen(context, "transmittal.view") ? prisma.documentTransmittal.findMany({ where: { AND: [readableTransmittalWhere(context), { items: { some: { engineeringDocumentId: row.id } } }] }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, projectId: true, transmittalNumber: true, status: true } }) : [],
  ]);
  const submittalIds = submittalLinks.map((link) => (link.sourceEntityType === DOCUMENT_RECORD ? link.targetEntityId : link.sourceEntityId));
  const submittals = submittalIds.length && engineeringOpen(context, "submittal.view") ? await prisma.technicalSubmittal.findMany({ where: { AND: [readableSubmittalWhere(context), { id: { in: submittalIds } }] }, select: { id: true, projectId: true, submittalNumber: true, title: true } }) : [];
  const live = !projectArchived(row.project) && row.status !== "VOID" && row.status !== "SUPERSEDED";
  const edit = live && can(context, "engineering_document.edit");
  const capabilitiesByRevision = Object.fromEntries(revisions.map((revision) => [revision.id, revisionCapabilities(context, parent, revision, settings)]));
  return {
    ...base,
    authorText: row.authorText,
    responsible: personOf(names, row.responsibleMemberId),
    voidReason: row.voidReason,
    revisions: await revisionDTOs(context, parent, revisions),
    revisionCapabilities: capabilitiesByRevision,
    linkedRfis: rfiRefs.map((rfi) => ({ id: rfi.id, label: `${rfi.rfiNumber} · ${rfi.subject}`, href: `/projects/${rfi.projectId}/engineering/rfis/${rfi.id}` })),
    linkedSubmittals: submittals.map((item) => ({ id: item.id, label: `${item.submittalNumber} · ${item.title}`, href: `/projects/${item.projectId}/engineering/submittals/${item.id}` })),
    linkedTransmittals: transmittalItems.map((item) => ({ id: item.id, label: `${item.transmittalNumber}${item.status === "VOID" ? " (void)" : ""}`, href: `/projects/${item.projectId}/engineering/transmittals/${item.id}` })),
    links: [...links, ...tasks.map((task) => ({ linkId: "", type: "task" as const, typeLabel: "Task", id: task.id, label: task.label, href: task.href }))],
    version: row.version,
    capabilities: {
      canEdit: edit,
      canAddRevision: edit,
      canVoid: live && can(context, "engineering_document.edit") && can(context, "engineering_document.approve"),
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

const NUMBER_TAKEN = { code: "ENGINEERING_DOCUMENT_NUMBER_TAKEN", message: "That document number is already used on this project." };

export async function createEngineeringDocument(context: UserContext, projectId: string, input: CreateEngineeringDocumentInput): Promise<{ id: string }> {
  const project = await loadEngineeringProject(context, projectId, "engineering_document.view");
  assertPermission(context, "engineering_document.create");
  assertProjectWritable(project);
  const [scope] = await Promise.all([
    resolveProjectContext(context.companyId, project.id, input, { newWork: true }),
    assertResponsible(context.companyId, project.id, input.responsibleMemberId, "engineering_document.view", "responsibleMemberId"),
    assertResponsible(context.companyId, project.id, input.reviewerMemberId, "engineering_document.review", "reviewerMemberId"),
  ]);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.engineeringDocument.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          contractorId: scope.contractorId,
          workPackageId: scope.workPackageId,
          documentNumber: input.documentNumber,
          title: input.title,
          documentType: input.documentType as EngineeringDocumentType,
          discipline: input.discipline,
          authorText: input.authorText,
          responsibleMemberId: input.responsibleMemberId,
          reviewerMemberId: input.reviewerMemberId,
          reviewDueAt: at(input.reviewDueAt),
          createdByMemberId: context.membershipId,
        },
        select: { id: true },
      });
      await recordActivity(tx, context, { module: MODULE, entityType: DOCUMENT_ACTIVITY, entityId: row.id, action: "ENGINEERING_DOCUMENT_CREATED", message: `registered ${input.documentNumber} ${input.title}` });
      await recordUserAction(context, { actionKey: AuditAction.ENGINEERING_DOCUMENT_CREATED, entity: { type: DOCUMENT_RECORD, id: row.id, label: input.documentNumber }, projectId: project.id, after: { documentNumber: input.documentNumber, documentType: input.documentType, discipline: input.discipline, contractorId: scope.contractorId, workPackageId: scope.workPackageId, reviewerMemberId: input.reviewerMemberId, reviewDueAt: input.reviewDueAt } }, { tx });
      return row;
    });
    await subscribeStakeholders({ companyId: context.companyId, parentType: DOCUMENT_RECORD, parentId: created.id, memberIds: [context.membershipId, input.responsibleMemberId, input.reviewerMemberId].filter((id): id is string => Boolean(id)) });
    return created;
  } catch (error) {
    if (isUniqueViolation(error, "documentNumber")) throw fail(NUMBER_TAKEN.code, NUMBER_TAKEN.message, "CONFLICT", { field: "documentNumber" });
    throw error;
  }
}

async function findWritableDocument(context: UserContext, id: string) {
  assertModule(context, MODULE);
  const row = await prisma.engineeringDocument.findFirst({ where: { AND: [readableEngineeringDocumentWhere(context), { id }] }, select: DOCUMENT_SELECT });
  if (!row) throw fail("ENGINEERING_DOCUMENT_NOT_FOUND", "That document could not be found.", "NOT_FOUND");
  assertPermission(context, "engineering_document.edit");
  assertProjectWritable(row.project);
  if (row.status === "VOID" || row.status === "SUPERSEDED") throw fail("ENGINEERING_DOCUMENT_CLOSED", `This document is ${row.status.toLowerCase()}; it is read-only.`, "CONFLICT");
  return row;
}

export async function updateEngineeringDocument(context: UserContext, id: string, input: UpdateEngineeringDocumentInput): Promise<{ id: string; version: number }> {
  const row = await findWritableDocument(context, id);
  const [scope] = await Promise.all([
    resolveProjectContext(context.companyId, row.projectId, input, { newWork: input.contractorId !== row.contractorId || input.workPackageId !== row.workPackageId }),
    input.responsibleMemberId !== row.responsibleMemberId ? assertResponsible(context.companyId, row.projectId, input.responsibleMemberId, "engineering_document.view", "responsibleMemberId") : undefined,
    input.reviewerMemberId !== row.reviewerMemberId ? assertResponsible(context.companyId, row.projectId, input.reviewerMemberId, "engineering_document.review", "reviewerMemberId") : undefined,
  ]);
  // The number a submitted revision was issued under does not quietly change (§64, §69).
  if (input.documentNumber !== row.documentNumber && row._count.revisions > 0 && row.status !== "DRAFT") throw fail("ENGINEERING_DOCUMENT_NUMBER_LOCKED", "The number is fixed once a revision has been submitted.", "CONFLICT", { field: "documentNumber" });
  try {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.engineeringDocument.updateMany({
        where: { id: row.id, version: input.expectedVersion, status: { notIn: ["VOID", "SUPERSEDED"] } },
        data: { documentNumber: input.documentNumber, title: input.title, documentType: input.documentType as EngineeringDocumentType, discipline: input.discipline, contractorId: scope.contractorId, workPackageId: scope.workPackageId, authorText: input.authorText, responsibleMemberId: input.responsibleMemberId, reviewerMemberId: input.reviewerMemberId, reviewDueAt: at(input.reviewDueAt), version: { increment: 1 } },
      });
      if (!moved.count) throw fail("ENGINEERING_DOCUMENT_STALE", "This document changed since you opened it. Reload to see the latest.", "CONFLICT");
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.ENGINEERING_DOCUMENT_UPDATED,
          entity: { type: DOCUMENT_RECORD, id: row.id, label: input.documentNumber },
          projectId: row.projectId,
          before: { documentNumber: row.documentNumber, title: row.title, documentType: row.documentType, discipline: row.discipline, contractorId: row.contractorId, workPackageId: row.workPackageId, responsibleMemberId: row.responsibleMemberId, reviewerMemberId: row.reviewerMemberId, reviewDueAt: dateOf(row.reviewDueAt) },
          after: { documentNumber: input.documentNumber, title: input.title, documentType: input.documentType, discipline: input.discipline, contractorId: scope.contractorId, workPackageId: scope.workPackageId, responsibleMemberId: input.responsibleMemberId, reviewerMemberId: input.reviewerMemberId, reviewDueAt: input.reviewDueAt },
        },
        { tx },
      );
    });
  } catch (error) {
    if (isUniqueViolation(error, "documentNumber")) throw fail(NUMBER_TAKEN.code, NUMBER_TAKEN.message, "CONFLICT", { field: "documentNumber" });
    throw error;
  }
  return { id: row.id, version: input.expectedVersion + 1 };
}

/** Void a mistaken entry, or mark the whole document superseded by another number (§63, §81). */
export async function retireEngineeringDocument(context: UserContext, id: string, input: { reason: string; status: "VOID" | "SUPERSEDED" }): Promise<{ id: string }> {
  const row = await findWritableDocument(context, id);
  assertPermission(context, "engineering_document.approve");
  const open = await prisma.engineeringDocumentRevision.count({ where: { engineeringDocumentId: row.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } });
  if (open && input.status === "SUPERSEDED") throw fail("ENGINEERING_DOCUMENT_IN_REVIEW", "Finish the review in progress first.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    const moved = await tx.engineeringDocument.updateMany({ where: { id: row.id, status: { notIn: ["VOID", "SUPERSEDED"] } }, data: { status: input.status, voidedAt: new Date(), voidReason: input.reason, version: { increment: 1 } } });
    if (!moved.count) throw fail("ENGINEERING_DOCUMENT_STALE", "This document changed since you opened it. Reload to see the latest.", "CONFLICT");
    // A draft left behind has nothing to become.
    await tx.engineeringDocumentRevision.updateMany({ where: { engineeringDocumentId: row.id, status: "DRAFT" }, data: { status: "VOID", voidedAt: new Date() } });
    await recordActivity(tx, context, { module: MODULE, entityType: DOCUMENT_ACTIVITY, entityId: row.id, action: "ENGINEERING_DOCUMENT_VOIDED", message: input.status === "VOID" ? `voided ${row.documentNumber}` : `marked ${row.documentNumber} superseded` });
    await recordUserAction(context, { actionKey: AuditAction.ENGINEERING_DOCUMENT_VOIDED, entity: { type: DOCUMENT_RECORD, id: row.id, label: row.documentNumber }, projectId: row.projectId, before: { status: row.status }, after: { status: input.status }, reason: input.reason }, { tx });
  });
  await resolveAttentionForRecord(prisma, context.companyId, DOCUMENT_RECORD, row.id, ["ENGINEERING_REVIEW_OVERDUE"]);
  return { id: row.id };
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

export type ProjectEngineeringOptions = { contractors: Option[]; workPackages: Array<Option & { contractorId: string | null }>; members: Option[]; reviewers: Option[] };

/** Contractors assigned here and not terminated, open work packages, and the people who could take the work (§224). */
export async function projectEngineeringOptions(context: UserContext, projectId: string, reviewPermission: "engineering_document.review" | "submittal.review" | "rfi.respond"): Promise<ProjectEngineeringOptions> {
  const project = await loadEngineeringProject(context, projectId);
  const [assignments, packages, members, reviewers] = await Promise.all([
    prisma.projectContractorAssignment.findMany({ where: { companyId: context.companyId, projectId: project.id, status: { not: "TERMINATED" }, contractor: { status: { notIn: ["ARCHIVED", "OFFBOARDED"] } } }, orderBy: { contractor: { legalName: "asc" } }, select: { contractor: { select: { id: true, legalName: true } } } }),
    prisma.workPackage.findMany({ where: { companyId: context.companyId, projectId: project.id, archivedAt: null, status: { not: "CANCELLED" } }, orderBy: { code: "asc" }, take: 300, select: { id: true, code: true, name: true, contractorId: true } }),
    memberOptions(context.companyId, project.id, "rfi.view"),
    memberOptions(context.companyId, project.id, reviewPermission),
  ]);
  return {
    contractors: assignments.map((row) => ({ id: row.contractor.id, label: row.contractor.legalName })),
    workPackages: packages.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}`, contractorId: row.contractorId })),
    members,
    reviewers,
  };
}

/** Files on this record that could become the next revision: uploaded here, not already carried by one (§125). */
export async function revisionFileOptions(context: UserContext, recordType: "engineering_document" | "technical_submittal", recordId: string): Promise<Option[]> {
  await loadRevisionParent(context, recordType === "engineering_document" ? "document" : "submittal", recordId);
  if (!filesOpen(context)) return [];
  const [documents, usedByDocuments, usedBySubmittals] = await Promise.all([
    prisma.document.findMany({ where: { companyId: context.companyId, entityType: recordType, entityId: recordId, status: "ACTIVE", storageStatus: { notIn: ["REJECTED", "FAILED", "ARCHIVED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true } }),
    prisma.engineeringDocumentRevision.findMany({ where: { companyId: context.companyId, status: { not: "VOID" }, engineeringDocumentId: recordId }, select: { documentId: true } }),
    prisma.technicalSubmittalRevision.findMany({ where: { companyId: context.companyId, status: { not: "VOID" }, submittalId: recordId }, select: { documentId: true } }),
  ]);
  const used = new Set([...usedByDocuments, ...usedBySubmittals].map((row) => row.documentId));
  return documents.filter((row) => !used.has(row.id)).map((row) => ({ id: row.id, label: row.name }));
}
