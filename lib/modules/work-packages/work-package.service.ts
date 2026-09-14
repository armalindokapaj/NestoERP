import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import { buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { assertLinkableContract, linkableContractOptions, visibleContracts } from "@/lib/modules/contractors/contractor.commercial";
import {
  commercialOpen,
  contractorProjectDoor,
  contractorsOpen,
  MODULE,
  readableWorkPackageWhere,
  WORK_PACKAGE_ACTIVITY,
  WORK_PACKAGE_RECORD,
} from "@/lib/modules/contractors/contractor.permissions";
import type { CreateWorkPackageInput, UpdateWorkPackageInput, WorkPackageListQuery } from "@/lib/modules/contractors/contractor.schema";
import { OPEN_WORK_PACKAGE_STATUSES, type WorkPackageDetailDTO, type WorkPackageRowDTO, type WorkPackageStatus } from "@/lib/modules/contractors/contractor.types";
import { engineeringOpen, filesOpen, filesWritable, LINK_TYPE, readableRfiWhere, readableSubmittalWhere } from "@/lib/modules/engineering/engineering.permissions";
import { companyToday } from "@/lib/modules/engineering/engineering.settings";
import {
  assertProjectWritable,
  assertResponsible,
  at,
  dateOf,
  fail,
  loadProjectThrough,
  memberOptions,
  people,
  personOf,
  projectArchived,
  projectNumber,
  withNumber,
  type ProjectRef,
} from "@/lib/modules/engineering/engineering.shared";
import type { Discipline, Option } from "@/lib/modules/engineering/engineering.types";
import { RFI_OPEN_STATUSES } from "@/lib/modules/engineering/engineering.types";
import { recordActivity } from "@/lib/modules/shared/activity";

/**
 * Work packages (PRD #46 §32-§40, §215, §286).
 *
 * The unit of scope on a project: which contractor, under which contract, who
 * answers for it, and when. Its value is context only — Finance and the
 * contract stay authoritative, and only readers with Legal or Finance access
 * see it (§36, §157). Everything linked to it lives on the same project (§38).
 * Completing a work package closes nothing else: not the contract, not the
 * project, not the final account (§40).
 */

const QUALITY_TYPES = ["quality_inspection", "quality_defect", "non_conformance_report"];
const SAFETY_TYPES = ["incident", "hazard", "risk_assessment", "work_permit", "toolbox_talk"];

const WP_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  contractorId: true,
  projectContractorAssignmentId: true,
  code: true,
  name: true,
  description: true,
  discipline: true,
  status: true,
  contractId: true,
  responsibleMemberId: true,
  plannedStartDate: true,
  plannedFinishDate: true,
  forecastStartDate: true,
  forecastFinishDate: true,
  actualStartDate: true,
  actualFinishDate: true,
  value: true,
  currency: true,
  completedAt: true,
  completedByMemberId: true,
  archivedAt: true,
  createdByMemberId: true,
  version: true,
  project: { select: { id: true, name: true, code: true, status: true, archivedAt: true, projectManagerMemberId: true } },
  contractor: { select: { id: true, legalName: true } },
} satisfies Prisma.WorkPackageSelect;

type WorkPackageRow = Prisma.WorkPackageGetPayload<{ select: typeof WP_SELECT }>;

async function rowCounts(context: UserContext, rows: WorkPackageRow[]): Promise<Map<string, WorkPackageRowDTO["counts"]>> {
  const ids = rows.map((row) => row.id);
  const result = new Map(ids.map((id) => [id, { openTasks: 0, openRfis: 0, submittals: 0 }]));
  if (!ids.length) return result;
  const [tasks, rfis, submittals] = await Promise.all([
    can(context, "task.view") ? prisma.task.groupBy({ by: ["entityId"], where: { AND: [buildTaskScopeWhere(context), { entityType: WORK_PACKAGE_RECORD, entityId: { in: ids }, status: { notIn: ["COMPLETED", "ARCHIVED"] } }] }, _count: { _all: true } }) : [],
    engineeringOpen(context, "rfi.view") ? prisma.rfi.groupBy({ by: ["workPackageId"], where: { AND: [readableRfiWhere(context), { workPackageId: { in: ids }, status: { in: RFI_OPEN_STATUSES } }] }, _count: { _all: true } }) : [],
    engineeringOpen(context, "submittal.view") ? prisma.technicalSubmittal.groupBy({ by: ["workPackageId"], where: { AND: [readableSubmittalWhere(context), { workPackageId: { in: ids }, status: { notIn: ["VOID"] } }] }, _count: { _all: true } }) : [],
  ]);
  for (const row of tasks) if (row.entityId && result.has(row.entityId)) result.get(row.entityId)!.openTasks = row._count._all;
  for (const row of rfis) if (row.workPackageId && result.has(row.workPackageId)) result.get(row.workPackageId)!.openRfis = row._count._all;
  for (const row of submittals) if (row.workPackageId && result.has(row.workPackageId)) result.get(row.workPackageId)!.submittals = row._count._all;
  return result;
}

async function toRows(context: UserContext, rows: WorkPackageRow[]): Promise<WorkPackageRowDTO[]> {
  const [names, counts] = await Promise.all([people(context.companyId, rows.map((row) => row.responsibleMemberId)), rowCounts(context, rows)]);
  return rows.map((row) => ({
    id: row.id,
    project: { id: row.project.id, label: row.project.name, href: `/projects/${row.project.id}/work-packages` },
    code: row.code,
    name: row.name,
    discipline: row.discipline as Discipline | null,
    status: row.status,
    contractor: row.contractor ? { id: row.contractor.id, label: row.contractor.legalName, href: `/contractors/${row.contractor.id}` } : null,
    responsible: personOf(names, row.responsibleMemberId),
    plannedStartDate: dateOf(row.plannedStartDate),
    plannedFinishDate: dateOf(row.plannedFinishDate),
    forecastFinishDate: dateOf(row.forecastFinishDate),
    actualFinishDate: dateOf(row.actualFinishDate),
    counts: counts.get(row.id)!,
    href: `/projects/${row.projectId}/work-packages/${row.id}`,
  }));
}

function listFilters(query: WorkPackageListQuery): Prisma.WorkPackageWhereInput[] {
  const filters: Prisma.WorkPackageWhereInput[] = [];
  if (!query.includeArchived) filters.push({ archivedAt: null });
  if (query.status) filters.push({ status: query.status });
  if (query.contractorId) filters.push({ contractorId: query.contractorId });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.discipline) filters.push({ discipline: query.discipline });
  if (query.q) filters.push({ OR: [{ code: { contains: query.q, mode: "insensitive" } }, { name: { contains: query.q, mode: "insensitive" } }] });
  return filters;
}

export async function listWorkPackages(context: UserContext, query: WorkPackageListQuery): Promise<{ items: WorkPackageRowDTO[]; total: number; page: number; pageSize: number }> {
  assertModule(context, MODULE);
  if (!contractorsOpen(context, "work_package.view")) throw new AccessError("FORBIDDEN", "You cannot see work packages.");
  const pageSize = 50;
  const where = { AND: [readableWorkPackageWhere(context), ...listFilters(query)] };
  const [rows, total] = await Promise.all([
    prisma.workPackage.findMany({ where, orderBy: [{ project: { name: "asc" } }, { code: "asc" }], skip: (query.page - 1) * pageSize, take: pageSize, select: WP_SELECT }),
    prisma.workPackage.count({ where }),
  ]);
  return { items: await toRows(context, rows), total, page: query.page, pageSize };
}

export async function loadWorkPackageProject(context: UserContext, projectId: string, permission: "work_package.view" | "work_package.create" = "work_package.view"): Promise<ProjectRef> {
  assertModule(context, MODULE);
  return loadProjectThrough(contractorProjectDoor(context, permission), projectId, "You cannot open this project's work packages.");
}

export async function listProjectWorkPackages(context: UserContext, projectId: string, query: WorkPackageListQuery): Promise<WorkPackageRowDTO[]> {
  const project = await loadWorkPackageProject(context, projectId);
  const rows = await prisma.workPackage.findMany({ where: { AND: [readableWorkPackageWhere(context), { projectId: project.id }, ...listFilters({ ...query, projectId: null })] }, orderBy: [{ code: "asc" }], take: 500, select: WP_SELECT });
  return toRows(context, rows);
}

export async function findReadableWorkPackage(context: UserContext, id: string): Promise<WorkPackageRow> {
  assertModule(context, MODULE);
  const row = await prisma.workPackage.findFirst({ where: { AND: [readableWorkPackageWhere(context), { id }] }, select: WP_SELECT });
  if (!row) throw fail("WORK_PACKAGE_NOT_FOUND", "That work package could not be found.", "NOT_FOUND");
  return row;
}

function capabilities(context: UserContext, row: WorkPackageRow): WorkPackageDetailDTO["capabilities"] {
  const live = !row.archivedAt && !projectArchived(row.project);
  const open = live && row.status !== "COMPLETED" && row.status !== "CANCELLED";
  const has = (permission: Parameters<typeof can>[1]) => contractorsOpen(context, permission);
  return {
    canEdit: open && has("work_package.edit"),
    canComplete: open && has("work_package.complete"),
    canArchive: live && has("work_package.edit") && !open,
    canLink: live && has("work_package.edit"),
    canCreateTask: live && has("work_package.edit") && can(context, "task.create"),
    canViewFiles: filesOpen(context),
    canUploadFiles: live && filesWritable(context) && has("work_package.edit"),
  };
}

export async function getWorkPackage(context: UserContext, id: string): Promise<WorkPackageDetailDTO> {
  const row = await findReadableWorkPackage(context, id);
  const [base] = await toRows(context, [row]);
  const [names, contracts, documents, engineeringDocuments, transmittals, links] = await Promise.all([
    people(context.companyId, [row.completedByMemberId]),
    visibleContracts(context, [row.contractId]),
    prisma.document.count({ where: { companyId: context.companyId, entityType: WORK_PACKAGE_RECORD, entityId: row.id, status: "ACTIVE" } }),
    engineeringOpen(context, "engineering_document.view") ? prisma.engineeringDocument.count({ where: { companyId: context.companyId, workPackageId: row.id, status: { not: "VOID" } } }) : 0,
    engineeringOpen(context, "transmittal.view") ? prisma.documentTransmittal.count({ where: { companyId: context.companyId, workPackageId: row.id, status: { not: "VOID" } } }) : 0,
    prisma.integrationLink.groupBy({ by: ["targetEntityType"], where: { companyId: context.companyId, integrationType: LINK_TYPE, sourceEntityType: WORK_PACKAGE_RECORD, sourceEntityId: row.id, status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  const linked = (types: string[]) => links.filter((link) => types.includes(link.targetEntityType)).reduce((sum, link) => sum + link._count._all, 0);
  return {
    ...base,
    description: row.description,
    assignmentId: row.projectContractorAssignmentId,
    contract: row.contractId ? (contracts.get(row.contractId) ?? null) : null,
    forecastStartDate: dateOf(row.forecastStartDate),
    actualStartDate: dateOf(row.actualStartDate),
    value: row.value !== null && commercialOpen(context) ? { amount: row.value.toFixed(2), currency: row.currency } : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: personOf(names, row.completedByMemberId),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    counts: { ...base.counts, documents: filesOpen(context) ? documents : 0, engineeringDocuments, transmittals, qaqc: linked(QUALITY_TYPES), hse: linked(SAFETY_TYPES) },
    version: row.version,
    capabilities: capabilities(context, row),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** A contractor on a work package is one assigned to its project and not terminated there (§27, §31). */
async function resolveAssignment(companyId: string, projectId: string, contractorId: string | null, current: string | null) {
  if (!contractorId) return null;
  const assignment = await prisma.projectContractorAssignment.findFirst({ where: { companyId, projectId, contractorId }, select: { id: true, status: true } });
  if (!assignment) throw fail("ENGINEERING_CONTRACTOR_NOT_ASSIGNED", "That contractor is not assigned to this project.", "VALIDATION_ERROR", { field: "contractorId" });
  if (assignment.status === "TERMINATED" && contractorId !== current) throw fail("ENGINEERING_ASSIGNMENT_TERMINATED", "That contractor's assignment on this project has been terminated.", "VALIDATION_ERROR", { field: "contractorId" });
  return assignment.id;
}

function commercialInput(context: UserContext, input: { value: string | null; currency: string | null }, current?: { value: Prisma.Decimal | null; currency: string | null }) {
  const unchanged = current && (current.value?.toFixed(2) ?? null) === (input.value === null ? null : Number(input.value).toFixed(2)) && current.currency === input.currency;
  if (unchanged) return {};
  if ((input.value !== null || current?.value) && !commercialOpen(context)) throw fail("WORK_PACKAGE_VALUE_FORBIDDEN", "Only Finance or Legal record a work package's value.", "FORBIDDEN", { field: "value" });
  return { value: input.value === null ? null : new Prisma.Decimal(input.value), currency: input.value === null ? null : input.currency };
}

function dates(input: CreateWorkPackageInput | UpdateWorkPackageInput) {
  return {
    plannedStartDate: at(input.plannedStartDate),
    plannedFinishDate: at(input.plannedFinishDate),
    forecastStartDate: at(input.forecastStartDate),
    forecastFinishDate: at(input.forecastFinishDate),
    actualStartDate: at(input.actualStartDate),
    actualFinishDate: at(input.actualFinishDate),
  };
}

function auditOf(input: { code: string | null; name: string; status: string; contractorId: string | null; contractId: string | null; responsibleMemberId: string | null; discipline: string | null; plannedStartDate: string | null; plannedFinishDate: string | null; forecastStartDate?: string | null; forecastFinishDate?: string | null; actualStartDate?: string | null; actualFinishDate?: string | null }) {
  return { ...input };
}

export async function createWorkPackage(context: UserContext, projectId: string, input: CreateWorkPackageInput): Promise<{ id: string; code: string }> {
  const project = await loadWorkPackageProject(context, projectId, "work_package.create");
  assertPermission(context, "work_package.create");
  assertProjectWritable(project);
  const [assignmentId] = await Promise.all([
    resolveAssignment(context.companyId, project.id, input.contractorId, null),
    assertLinkableContract(context, input.contractId, project.id),
    assertResponsible(context.companyId, project.id, input.responsibleMemberId, "work_package.view", "responsibleMemberId"),
  ]);
  const commercial = commercialInput(context, input);
  const created = await withNumber("code", input.code, { code: "WORK_PACKAGE_CODE_TAKEN", message: "That code is already used on this project." }, () =>
    prisma.$transaction(async (tx) => {
      const code = await projectNumber(tx, {
        companyId: context.companyId,
        moduleKey: MODULE,
        entityType: WORK_PACKAGE_RECORD,
        prefix: "WP",
        manual: input.code,
        count: () => tx.workPackage.count({ where: { companyId: context.companyId, projectId: project.id } }),
        taken: async (candidate) => (await tx.workPackage.count({ where: { companyId: context.companyId, projectId: project.id, code: candidate } })) > 0,
      });
      const row = await tx.workPackage.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          contractorId: input.contractorId,
          projectContractorAssignmentId: assignmentId,
          code,
          name: input.name,
          description: input.description,
          discipline: input.discipline,
          status: input.status as WorkPackageStatus,
          contractId: input.contractId,
          responsibleMemberId: input.responsibleMemberId,
          ...dates(input),
          ...commercial,
          createdByMemberId: context.membershipId,
        },
        select: { id: true, code: true },
      });
      await recordActivity(tx, context, { module: MODULE, entityType: WORK_PACKAGE_ACTIVITY, entityId: row.id, action: "WORK_PACKAGE_CREATED", message: `created the work package ${code} ${input.name}` });
      await recordUserAction(context, { actionKey: AuditAction.WORK_PACKAGE_CREATED, entity: { type: WORK_PACKAGE_RECORD, id: row.id, label: `${code} · ${input.name}` }, projectId: project.id, after: auditOf({ ...input, code }) }, { tx });
      return row;
    }),
  );
  await subscribeStakeholders({ companyId: context.companyId, parentType: WORK_PACKAGE_RECORD, parentId: created.id, memberIds: [context.membershipId, ...(input.responsibleMemberId ? [input.responsibleMemberId] : [])] });
  incrementCounter(Metric.WORK_PACKAGE_CREATE_SUCCESS);
  return created;
}

async function findWritableWorkPackage(context: UserContext, id: string, permission: "work_package.edit" | "work_package.complete") {
  const row = await findReadableWorkPackage(context, id);
  assertPermission(context, permission);
  assertProjectWritable(row.project);
  if (row.archivedAt) throw fail("WORK_PACKAGE_ARCHIVED", "That work package is archived.", "CONFLICT");
  return row;
}

export async function updateWorkPackage(context: UserContext, id: string, input: UpdateWorkPackageInput): Promise<{ id: string; version: number }> {
  const row = await findWritableWorkPackage(context, id, "work_package.edit");
  if (row.status === "COMPLETED" || row.status === "CANCELLED") throw fail("WORK_PACKAGE_CLOSED", "This work package is closed; its record is read-only.", "CONFLICT");
  const [assignmentId] = await Promise.all([
    resolveAssignment(context.companyId, row.projectId, input.contractorId, row.contractorId),
    assertLinkableContract(context, input.contractId, row.projectId, row.contractId),
    input.responsibleMemberId !== row.responsibleMemberId ? assertResponsible(context.companyId, row.projectId, input.responsibleMemberId, "work_package.view", "responsibleMemberId") : undefined,
  ]);
  const commercial = commercialInput(context, input, row);
  const code = input.code ?? row.code;
  await withNumber("code", code, { code: "WORK_PACKAGE_CODE_TAKEN", message: "That code is already used on this project." }, () =>
    prisma.$transaction(async (tx) => {
      const moved = await tx.workPackage.updateMany({
        where: { id: row.id, version: input.expectedVersion, archivedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        data: { code, name: input.name, description: input.description, discipline: input.discipline, status: input.status as WorkPackageStatus, contractorId: input.contractorId, projectContractorAssignmentId: assignmentId, contractId: input.contractId, responsibleMemberId: input.responsibleMemberId, ...dates(input), ...commercial, version: { increment: 1 } },
      });
      if (!moved.count) throw fail("WORK_PACKAGE_STALE", "This work package changed since you opened it. Reload to see the latest.", "CONFLICT");
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.WORK_PACKAGE_UPDATED,
          entity: { type: WORK_PACKAGE_RECORD, id: row.id, label: `${code} · ${input.name}` },
          projectId: row.projectId,
          before: auditOf({ code: row.code, name: row.name, status: row.status, contractorId: row.contractorId, contractId: row.contractId, responsibleMemberId: row.responsibleMemberId, discipline: row.discipline, plannedStartDate: dateOf(row.plannedStartDate), plannedFinishDate: dateOf(row.plannedFinishDate), forecastStartDate: dateOf(row.forecastStartDate), forecastFinishDate: dateOf(row.forecastFinishDate), actualStartDate: dateOf(row.actualStartDate), actualFinishDate: dateOf(row.actualFinishDate) }),
          after: auditOf({ ...input, code }),
        },
        { tx },
      );
      if (input.status !== row.status) await recordActivity(tx, context, { module: MODULE, entityType: WORK_PACKAGE_ACTIVITY, entityId: row.id, action: "WORK_PACKAGE_STATUS_CHANGED", message: `marked ${code} ${input.status.toLowerCase().replace("_", " ")}` });
    }),
  );
  return { id: row.id, version: input.expectedVersion + 1 };
}

/** Completion is the work package's own fact and nobody else's (§40). */
export async function completeWorkPackage(context: UserContext, id: string, input: { actualFinishDate: string | null; expectedVersion: number }): Promise<{ id: string }> {
  const row = await findWritableWorkPackage(context, id, "work_package.complete");
  if (row.status === "COMPLETED" || row.status === "CANCELLED") throw fail("WORK_PACKAGE_CLOSED", "This work package is already closed.", "CONFLICT");
  const finish = input.actualFinishDate ?? (await companyToday(context.companyId)).today;
  if (row.actualStartDate && finish < dateOf(row.actualStartDate)!) throw fail("WORK_PACKAGE_DATES_INVALID", "It cannot finish before it started.", "VALIDATION_ERROR", { field: "actualFinishDate" });
  await prisma.$transaction(async (tx) => {
    const moved = await tx.workPackage.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      data: { status: "COMPLETED", actualFinishDate: at(finish), completedAt: new Date(), completedByMemberId: context.membershipId, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("WORK_PACKAGE_STALE", "This work package changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordActivity(tx, context, { module: MODULE, entityType: WORK_PACKAGE_ACTIVITY, entityId: row.id, action: "WORK_PACKAGE_COMPLETED", message: `completed the work package ${row.code} ${row.name}` });
    await recordUserAction(context, { actionKey: AuditAction.WORK_PACKAGE_COMPLETED, entity: { type: WORK_PACKAGE_RECORD, id: row.id, label: `${row.code} · ${row.name}` }, projectId: row.projectId, before: { status: row.status, actualFinishDate: dateOf(row.actualFinishDate) }, after: { status: "COMPLETED", actualFinishDate: finish } }, { tx });
  });
  return { id: row.id };
}

export async function archiveWorkPackage(context: UserContext, id: string, input: { expectedVersion: number }): Promise<{ id: string }> {
  const row = await findWritableWorkPackage(context, id, "work_package.edit");
  if (OPEN_WORK_PACKAGE_STATUSES.includes(row.status)) throw fail("WORK_PACKAGE_OPEN", "Complete or cancel this work package before archiving it.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    const moved = await tx.workPackage.updateMany({ where: { id: row.id, version: input.expectedVersion, archivedAt: null }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    if (!moved.count) throw fail("WORK_PACKAGE_STALE", "This work package changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(context, { actionKey: AuditAction.WORK_PACKAGE_ARCHIVED, entity: { type: WORK_PACKAGE_RECORD, id: row.id, label: `${row.code} · ${row.name}` }, projectId: row.projectId, after: { archived: true } }, { tx });
  });
  return { id: row.id };
}

export type WorkPackageOptions = { contractors: Option[]; contracts: Option[]; members: Option[]; canSetValue: boolean };

export async function workPackageOptions(context: UserContext, projectId: string): Promise<WorkPackageOptions> {
  const project = await loadWorkPackageProject(context, projectId);
  const [assignments, contracts, members] = await Promise.all([
    prisma.projectContractorAssignment.findMany({ where: { companyId: context.companyId, projectId: project.id, status: { not: "TERMINATED" } }, orderBy: { contractor: { legalName: "asc" } }, select: { contractor: { select: { id: true, legalName: true } } } }),
    linkableContractOptions(context, project.id),
    memberOptions(context.companyId, project.id, "work_package.view"),
  ]);
  return { contractors: assignments.map((row) => ({ id: row.contractor.id, label: row.contractor.legalName })), contracts, members, canSetValue: commercialOpen(context) };
}
