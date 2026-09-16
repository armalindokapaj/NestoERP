import type { Prisma } from "@prisma/client";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { engineeringOpen, readableRfiWhere, readableSubmittalWhere } from "@/lib/modules/engineering/engineering.permissions";
import { assertProjectWritable, assertResponsible, at, dateOf, fail, loadProjectThrough, memberOptions, people, personOf, projectArchived, type ProjectRef } from "@/lib/modules/engineering/engineering.shared";
import type { Option } from "@/lib/modules/engineering/engineering.types";
import { RFI_OPEN_STATUSES } from "@/lib/modules/engineering/engineering.types";
import { recordActivity } from "@/lib/modules/shared/activity";
import { assertLinkableContract, linkableContractOptions, visibleContracts } from "./contractor.commercial";
import { ACTIVITY_ENTITY, contractorDirectoryWhere, contractorProjectDoor, contractorsOpen, MODULE, RECORD, readableAssignmentWhere, readableComplianceWhere, readableWorkPackageWhere } from "./contractor.permissions";
import type { CreateAssignmentInput, UpdateAssignmentInput } from "./contractor.schema";
import { findReadableContractor } from "./contractor.service";
import { COMPLIANCE_ALERT_STATUSES, INACTIVE_CONTRACTOR_STATUSES, OPEN_WORK_PACKAGE_STATUSES, type AssignmentDTO, type AssignmentStatus } from "./contractor.types";

/**
 * Contractors on projects (PRD #46 §25-§31, §214, §285).
 *
 * Each assignment stands alone: the same contractor on three projects is three
 * assignments with their own status, contract, manager and dates. A contract
 * is Legal's record, linked only by someone who can open it (§28). Terminating
 * keeps every record and stops new work: no new work packages, RFIs,
 * submittals or documents name that contractor on that project again (§31).
 */

const ASSIGNMENT_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  contractorId: true,
  status: true,
  scopeSummary: true,
  contractId: true,
  internalManagerMemberId: true,
  primaryContractorContactId: true,
  startDate: true,
  endDate: true,
  terminatedAt: true,
  terminationReason: true,
  version: true,
  project: { select: { id: true, name: true, code: true, archivedAt: true, status: true, projectManagerMemberId: true } },
  contractor: { select: { id: true, legalName: true, status: true } },
  primaryContact: { select: { id: true, name: true } },
} satisfies Prisma.ProjectContractorAssignmentSelect;

type AssignmentRow = Prisma.ProjectContractorAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;

const SUBMITTAL_OPEN = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REVISION_REQUIRED"] as const;

/**
 * The people who work for a contractor are shown only to readers holding
 * `contractor_contact.view` (PRD #46 §20, §179, PRD #47 §62) — managing an
 * assignment does not include reading the contractor's address book.
 */
const contactsVisible = (context: UserContext) => contractorsOpen(context, "contractor_contact.view");

async function toDTOs(context: UserContext, rows: AssignmentRow[]): Promise<AssignmentDTO[]> {
  if (!rows.length) return [];
  const pairs = rows.map((row) => ({ projectId: row.projectId, contractorId: row.contractorId }));
  const byPair = (projectId: string, contractorId: string | null) => `${projectId}:${contractorId}`;
  const [names, contracts, packages, rfis, submittals, compliance] = await Promise.all([
    people(context.companyId, rows.map((row) => row.internalManagerMemberId)),
    visibleContracts(context, rows.map((row) => row.contractId)),
    prisma.workPackage.groupBy({ by: ["projectId", "contractorId"], where: { AND: [readableWorkPackageWhere(context), { OR: pairs, archivedAt: null, status: { in: OPEN_WORK_PACKAGE_STATUSES } }] }, _count: { _all: true } }),
    engineeringOpen(context, "rfi.view") ? prisma.rfi.groupBy({ by: ["projectId", "contractorId"], where: { AND: [readableRfiWhere(context), { OR: pairs, status: { in: RFI_OPEN_STATUSES } }] }, _count: { _all: true } }) : [],
    engineeringOpen(context, "submittal.view") ? prisma.technicalSubmittal.groupBy({ by: ["projectId", "contractorId"], where: { AND: [readableSubmittalWhere(context), { OR: pairs, status: { in: [...SUBMITTAL_OPEN] } }] }, _count: { _all: true } }) : [],
    prisma.contractorComplianceItem.groupBy({ by: ["contractorId"], where: { AND: [readableComplianceWhere(context), { contractorId: { in: rows.map((row) => row.contractorId) }, archivedAt: null, status: { in: COMPLIANCE_ALERT_STATUSES } }] }, _count: { _all: true } }),
  ]);
  const count = (list: Array<{ projectId: string; contractorId: string | null; _count: { _all: number } }>) => new Map(list.map((row) => [byPair(row.projectId, row.contractorId), row._count._all]));
  const [packageCounts, rfiCounts, submittalCounts] = [count(packages), count(rfis), count(submittals)];
  const complianceCounts = new Map(compliance.map((row) => [row.contractorId, row._count._all]));
  const canManage = contractorProjectDoor(context, "project_contractor.manage") !== null;
  const contacts = contactsVisible(context);
  return rows.map((row) => ({
    id: row.id,
    project: { id: row.project.id, label: row.project.name, href: `/projects/${row.project.id}/contractors`, code: row.project.code, archived: projectArchived(row.project) },
    contractor: { id: row.contractor.id, label: row.contractor.legalName, href: `/contractors/${row.contractor.id}`, status: row.contractor.status },
    status: row.status,
    scopeSummary: row.scopeSummary,
    contract: row.contractId ? (contracts.get(row.contractId) ?? null) : null,
    internalManager: personOf(names, row.internalManagerMemberId),
    primaryContact: contacts ? row.primaryContact : null,
    startDate: dateOf(row.startDate),
    endDate: dateOf(row.endDate),
    terminatedAt: row.terminatedAt?.toISOString() ?? null,
    terminationReason: row.terminationReason,
    workPackages: packageCounts.get(byPair(row.projectId, row.contractorId)) ?? 0,
    openRfis: rfiCounts.get(byPair(row.projectId, row.contractorId)) ?? 0,
    openSubmittals: submittalCounts.get(byPair(row.projectId, row.contractorId)) ?? 0,
    complianceAlerts: complianceCounts.get(row.contractorId) ?? 0,
    version: row.version,
    canManage: canManage && row.status !== "TERMINATED" && !projectArchived(row.project),
  }));
}

export async function loadContractorProject(context: UserContext, projectId: string, permission: "project_contractor.view" | "project_contractor.manage" | "work_package.view" | "work_package.create" = "project_contractor.view"): Promise<ProjectRef> {
  assertModule(context, MODULE);
  return loadProjectThrough(contractorProjectDoor(context, permission), projectId, "You cannot open this project's contractors.");
}

export async function listProjectAssignments(context: UserContext, projectId: string): Promise<AssignmentDTO[]> {
  const project = await loadContractorProject(context, projectId);
  const rows = await prisma.projectContractorAssignment.findMany({ where: { AND: [readableAssignmentWhere(context), { projectId: project.id }] }, orderBy: [{ status: "asc" }, { contractor: { legalName: "asc" } }], select: ASSIGNMENT_SELECT });
  return toDTOs(context, rows);
}

export async function listContractorAssignments(context: UserContext, contractorId: string): Promise<AssignmentDTO[]> {
  const contractor = await findReadableContractor(context, contractorId);
  const rows = await prisma.projectContractorAssignment.findMany({ where: { AND: [readableAssignmentWhere(context), { contractorId: contractor.id }] }, orderBy: [{ project: { name: "asc" } }], take: 200, select: ASSIGNMENT_SELECT });
  return toDTOs(context, rows);
}

async function findManageableAssignment(context: UserContext, id: string): Promise<AssignmentRow> {
  assertModule(context, MODULE);
  assertPermission(context, "project_contractor.manage");
  const door = contractorProjectDoor(context, "project_contractor.manage");
  const row = door ? await prisma.projectContractorAssignment.findFirst({ where: { id, companyId: context.companyId, project: { is: door } }, select: ASSIGNMENT_SELECT }) : null;
  if (!row) throw fail("ASSIGNMENT_NOT_FOUND", "That assignment could not be found.", "NOT_FOUND");
  assertProjectWritable(row.project);
  if (row.status === "TERMINATED") throw fail("ASSIGNMENT_TERMINATED", "This assignment was terminated; its history is read-only.", "CONFLICT");
  return row;
}

async function assertContact(companyId: string, contractorId: string, contactId: string | null) {
  if (!contactId) return;
  const found = await prisma.contractorContact.count({ where: { id: contactId, companyId, contractorId, active: true } });
  if (!found) throw fail("ASSIGNMENT_CONTACT_INVALID", "That contact does not work for this contractor.", "VALIDATION_ERROR", { field: "primaryContractorContactId" });
}

export async function createAssignment(context: UserContext, projectId: string, input: CreateAssignmentInput): Promise<{ id: string }> {
  const project = await loadContractorProject(context, projectId, "project_contractor.manage");
  assertPermission(context, "project_contractor.manage");
  assertProjectWritable(project);
  const contractor = await prisma.contractorProfile.findFirst({ where: { AND: [contractorDirectoryWhere(context), { id: input.contractorId }] }, select: { id: true, legalName: true, status: true } });
  if (!contractor) throw fail("CONTRACTOR_NOT_FOUND", "That contractor could not be found.", "VALIDATION_ERROR", { field: "contractorId" });
  if (INACTIVE_CONTRACTOR_STATUSES.includes(contractor.status)) throw fail("CONTRACTOR_INACTIVE", "That contractor is not available for new projects.", "VALIDATION_ERROR", { field: "contractorId" });
  if (input.primaryContractorContactId && !contactsVisible(context)) throw fail("ASSIGNMENT_CONTACT_INVALID", "You cannot choose the contractor's contact.", "VALIDATION_ERROR", { field: "primaryContractorContactId" }, "SCOPE_DENIED");
  await Promise.all([
    assertLinkableContract(context, input.contractId, project.id),
    assertResponsible(context.companyId, project.id, input.internalManagerMemberId, "project_contractor.view", "internalManagerMemberId"),
    assertContact(context.companyId, contractor.id, input.primaryContractorContactId),
  ]);
  const existing = await prisma.projectContractorAssignment.count({ where: { projectId: project.id, contractorId: contractor.id } });
  if (existing) throw fail("CONTRACTOR_ALREADY_ASSIGNED", "That contractor is already on this project.", "CONFLICT", { field: "contractorId" });

  return prisma.$transaction(async (tx) => {
    const row = await tx.projectContractorAssignment.create({
      data: {
        companyId: context.companyId,
        projectId: project.id,
        contractorId: contractor.id,
        status: input.status as AssignmentStatus,
        scopeSummary: input.scopeSummary,
        contractId: input.contractId,
        internalManagerMemberId: input.internalManagerMemberId,
        primaryContractorContactId: input.primaryContractorContactId,
        startDate: at(input.startDate),
        endDate: at(input.endDate),
        createdByMemberId: context.membershipId,
      },
      select: { id: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: contractor.id, action: "CONTRACTOR_PROJECT_ASSIGNED", message: `assigned ${contractor.legalName} to ${project.name}` });
    await recordUserAction(
      context,
      { actionKey: AuditAction.CONTRACTOR_PROJECT_ASSIGNED, entity: { type: RECORD, id: contractor.id, label: contractor.legalName }, projectId: project.id, after: { contractorId: contractor.id, projectId: project.id, status: input.status, contractId: input.contractId, internalManagerMemberId: input.internalManagerMemberId, startDate: input.startDate, endDate: input.endDate } },
      { tx },
    );
    const memberIds = [...new Set([project.projectManagerMemberId, input.internalManagerMemberId].filter((id): id is string => Boolean(id)))];
    if (memberIds.length) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.CONTRACTOR_ASSIGNED_TO_PROJECT,
        moduleKey: MODULE,
        entityType: RECORD,
        entityId: contractor.id,
        actorMemberId: context.membershipId,
        projectId: project.id,
        payload: { memberIds, contractorName: contractor.legalName, projectName: project.name, scope: input.scopeSummary ? input.scopeSummary.slice(0, 140) : "" },
      });
    }
    return row;
  });
}

export async function updateAssignment(context: UserContext, id: string, input: UpdateAssignmentInput): Promise<{ id: string; version: number }> {
  const row = await findManageableAssignment(context, id);
  // A manager who cannot see contacts was never shown this one, so their edit keeps it as it is.
  if (!contactsVisible(context)) input = { ...input, primaryContractorContactId: row.primaryContractorContactId };
  await Promise.all([
    assertLinkableContract(context, input.contractId, row.projectId, row.contractId),
    input.internalManagerMemberId !== row.internalManagerMemberId ? assertResponsible(context.companyId, row.projectId, input.internalManagerMemberId, "project_contractor.view", "internalManagerMemberId") : undefined,
    input.primaryContractorContactId !== row.primaryContractorContactId ? assertContact(context.companyId, row.contractorId, input.primaryContractorContactId) : undefined,
  ]);
  await prisma.$transaction(async (tx) => {
    const moved = await tx.projectContractorAssignment.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: { not: "TERMINATED" } },
      data: {
        status: input.status as AssignmentStatus,
        scopeSummary: input.scopeSummary,
        contractId: input.contractId,
        internalManagerMemberId: input.internalManagerMemberId,
        primaryContractorContactId: input.primaryContractorContactId,
        startDate: at(input.startDate),
        endDate: at(input.endDate),
        version: { increment: 1 },
      },
    });
    if (!moved.count) throw fail("ASSIGNMENT_STALE", "This assignment changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.CONTRACTOR_PROJECT_UPDATED,
        entity: { type: RECORD, id: row.contractorId, label: row.contractor.legalName },
        projectId: row.projectId,
        before: { status: row.status, contractId: row.contractId, internalManagerMemberId: row.internalManagerMemberId, primaryContractorContactId: row.primaryContractorContactId, startDate: dateOf(row.startDate), endDate: dateOf(row.endDate) },
        after: { status: input.status, contractId: input.contractId, internalManagerMemberId: input.internalManagerMemberId, primaryContractorContactId: input.primaryContractorContactId, startDate: input.startDate, endDate: input.endDate },
      },
      { tx },
    );
    if (input.status !== row.status) {
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.contractorId, action: "CONTRACTOR_PROJECT_UPDATED", message: `changed ${row.contractor.legalName} on ${row.project.name} to ${input.status.toLowerCase().replace("_", " ")}` });
    }
  });
  return { id: row.id, version: input.expectedVersion + 1 };
}

/** Ends the assignment and keeps everything it produced (§31). */
export async function terminateAssignment(context: UserContext, id: string, input: { reason: string; endDate: string | null; expectedVersion: number }): Promise<{ id: string }> {
  const row = await findManageableAssignment(context, id);
  const endDate = input.endDate ?? dateOf(new Date());
  await prisma.$transaction(async (tx) => {
    const moved = await tx.projectContractorAssignment.updateMany({
      where: { id: row.id, version: input.expectedVersion, status: { not: "TERMINATED" } },
      data: { status: "TERMINATED", terminatedAt: new Date(), terminationReason: input.reason, terminatedByMemberId: context.membershipId, endDate: at(endDate), version: { increment: 1 } },
    });
    if (!moved.count) throw fail("ASSIGNMENT_STALE", "This assignment changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.contractorId, action: "CONTRACTOR_PROJECT_TERMINATED", message: `terminated ${row.contractor.legalName} on ${row.project.name}` });
    await recordUserAction(context, { actionKey: AuditAction.CONTRACTOR_PROJECT_TERMINATED, entity: { type: RECORD, id: row.contractorId, label: row.contractor.legalName }, projectId: row.projectId, before: { status: row.status, endDate: dateOf(row.endDate) }, after: { status: "TERMINATED", endDate }, reason: input.reason }, { tx });
  });
  return { id: row.id };
}

export type AssignmentOptions = {
  /** Every contractor that could be put on this project, and those already on it (for their contacts). */
  contractors: Array<Option & { status: string; assigned: boolean; contacts: Option[] }>;
  members: Option[];
  contracts: Option[];
};

/** Only what the server would accept from this writer on this project. */
export async function assignmentOptions(context: UserContext, projectId: string): Promise<AssignmentOptions> {
  const project = await loadContractorProject(context, projectId, "project_contractor.manage");
  if (projectArchived(project)) throw new AccessError("CONFLICT", "This project is archived.");
  const [contractors, assigned, members, contracts] = await Promise.all([
    prisma.contractorProfile.findMany({
      where: { AND: [contractorDirectoryWhere(context), { OR: [{ status: { notIn: INACTIVE_CONTRACTOR_STATUSES } }, { projectAssignments: { some: { projectId } } }] }] },
      orderBy: { legalName: "asc" },
      take: 500,
      select: { id: true, legalName: true, status: true, contacts: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, roleTitle: true } } },
    }),
    prisma.projectContractorAssignment.findMany({ where: { projectId: project.id }, select: { contractorId: true } }),
    memberOptions(context.companyId, project.id, "project_contractor.view"),
    linkableContractOptions(context, project.id),
  ]);
  const taken = new Set(assigned.map((row) => row.contractorId));
  const contacts = contactsVisible(context);
  return {
    contractors: contractors.map((row) => ({ id: row.id, label: row.legalName, status: row.status, assigned: taken.has(row.id), contacts: contacts ? row.contacts.map((contact) => ({ id: contact.id, label: contact.roleTitle ? `${contact.name} · ${contact.roleTitle}` : contact.name })) : [] })),
    members,
    contracts,
  };
}
