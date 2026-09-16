import { Prisma, type ProjectStatus } from "@prisma/client";

import { projectTypeLabel } from "@/config/project-types";
import { roleLabel, isRoleKey } from "@/config/roles";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
  invalidRecordLink,
  stateDenied,
} from "@/lib/access/guards";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildClientScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { changeMetadata, recordActivity } from "@/lib/modules/shared/activity";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { applyTransition, assertTransitionAllowed } from "@/lib/core/state/transition";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import { isThumbnailableMimeType } from "@/lib/modules/documents/storage/thumbnail.service";
import { paginationMeta } from "@/lib/modules/shared/list-query";
import { projectMachine, statusActionFor } from "./project.machine";
import { contextForCompany } from "./project.portfolio";
import * as repository from "./project.repository";
import type {
  AddProjectMemberInput,
  ChangeProjectStatusInput,
  CreateProjectInput,
  ProjectListQuery,
  UpdateProjectInput,
  UpdateProjectMemberInput,
} from "./project.schema";
import { isProjectArchived, projectStatusLabels } from "./project.status";
import type {
  ProjectActivityDTO,
  ProjectDetailDTO,
  ProjectMemberDTO,
  ProjectSummaryDTO,
} from "./project.types";

/**
 * Projects service (PRD #10 §96, §157).
 *
 * Every entry point runs the same sequence: permission → scope → validate
 * related records belong to this company → mutate in a transaction → record
 * activity. Nothing here trusts a field from the browser: companyId, createdBy
 * and updatedBy come from the resolved context (PRD #10 §158).
 */

const MODULE = "projects" as const;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listProjects(context: UserContext, query: ProjectListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "project.view");

  const { rows, total } = await repository.listProjects(context, query);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getProject(
  context: UserContext,
  projectId: string,
): Promise<ProjectDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project.view");

  // Outside scope answers "not found", so the response cannot confirm that a
  // project the user may not see exists (PRD #10 §113).
  const project = assertFound(await repository.findProjectInScope(context, projectId));
  const counts = await repository.projectCounts(context, projectId);

  return toDetailDTO(project, counts);
}

/** The cover document a project points at, read inside the caller's project scope (E-05A §8). */
export async function projectCoverDocumentId(context: UserContext, projectId: string): Promise<string | null> {
  assertModule(context, MODULE);
  assertPermission(context, "project.view");
  const project = assertFound(await repository.findProjectInScope(context, projectId));
  return project.coverImageDocumentId;
}

export async function getProjectTaskSummary(context: UserContext, projectId: string) {
  assertPermission(context, "task.view");
  await assertProjectInScope(context, projectId);
  return repository.projectTaskSummary(context, projectId);
}

export async function listMembers(
  context: UserContext,
  projectId: string,
): Promise<ProjectMemberDTO[]> {
  assertPermission(context, "project.member.view");
  await assertProjectInScope(context, projectId);

  const rows = await repository.listProjectMembers(projectId);

  return rows.map((row) => ({
    id: row.id,
    companyMemberId: row.companyMemberId,
    fullName: `${row.member.user.firstName} ${row.member.user.lastName}`,
    email: row.member.user.email,
    avatarUrl: row.member.user.avatarUrl,
    roleLabel: isRoleKey(row.member.role.key) ? roleLabel(row.member.role.key) : row.member.role.name,
    department: row.member.department?.name ?? null,
    jobTitle: row.member.jobTitle,
    projectRole: row.projectRole,
    isPrimary: row.isPrimary,
    status: row.status,
    membershipActive: row.member.status === "ACTIVE",
  }));
}

/**
 * Project activity, filtered to the modules this user may see.
 *
 * Finance activity on a shared project must not reach an Architect simply
 * because they can open the project (PRD #10 §90).
 */
export async function listActivity(
  context: UserContext,
  projectId: string,
  options: { page: number; limit: number },
) {
  assertPermission(context, "project.activity.view");
  await assertProjectInScope(context, projectId);

  const visibleModules = Object.values(context.moduleAccess)
    .filter((access) => access.enabled && access.accessLevel !== "NONE")
    .map((access) => access.module);

  const { rows, total } = await repository.listProjectActivity(context, projectId, {
    ...options,
    modules: visibleModules,
  });

  const data: ProjectActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: paginationMeta(total, options.page, options.limit) };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createProject(
  session: UserContext,
  input: CreateProjectInput,
): Promise<ProjectDetailDTO> {
  // The project is created in the company the person chose, with their
  // membership there — never the session's company by default when another
  // was named, and never a company where they lack the permission (E-05A §30,
  // §39, §54).
  const context =
    input.companyId && input.companyId !== session.companyId
      ? await contextForCompany(session, input.companyId, "project.create")
      : session;

  assertModule(context, MODULE);
  assertPermission(context, "project.create");

  const clientId = await validateClient(context, input.clientId, null);
  const managerMemberId = await validateManager(context, input.projectManagerMemberId);

  // Naming somebody else as manager is the manager grant's decision on create
  // exactly as on update — taking the project yourself, or leaving it
  // unmanaged, is not (PRD #10 §118, PRD #47 §57).
  if (managerMemberId && managerMemberId !== context.membershipId) {
    assertPermission(context, "project.manager.assign");
  }

  const project = await prisma
    .$transaction((tx) =>
      createProjectRecord(tx, context, { ...input, clientId, projectManagerMemberId: managerMemberId }),
    )
    .catch(translateWriteError);

  return getProject(context, project.id);
}

/**
 * Creating the canonical project, inside somebody else's transaction
 * (PRD #10 §39, PRD #17 §90, §160, §260).
 *
 * A won opportunity may create the project that delivers it, and the two have
 * to land together. Rather than a second project-creation path living in Sales,
 * the conversion calls this — the same insert, the same manager membership, the
 * same activity entry — with its own transaction handle.
 *
 * The client and manager arrive already validated, because the caller may have
 * created the client in the very transaction being written: a fresh lookup
 * through the global client would not see it yet.
 */
export async function createProjectRecord(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: Omit<CreateProjectInput, "clientId" | "projectManagerMemberId" | "companyId" | "projectType"> & {
    clientId: string | null;
    projectManagerMemberId: string | null;
    projectType?: string;
  },
): Promise<{ id: string; code: string; name: string }> {
  assertPermission(context, "project.create");

  // Pending is where a new project starts. Starting it anywhere else is the
  // status decision, and needs the status permission (E-05A §31, §71).
  if (input.status !== "PENDING") assertPermission(context, "project.status.manage");

  const created = await tx.project.create({
    data: {
      companyId: context.companyId,
      code: input.code.trim(),
      name: input.name,
      description: input.description ?? null,
      clientId: input.clientId,
      projectManagerMemberId: input.projectManagerMemberId,
      status: input.status as ProjectStatus,
      priority: input.priority ?? null,
      projectType: input.projectType ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      createdBy: context.userId,
    },
    select: { id: true, code: true, name: true },
  });

  // The manager must also be a project member, or they fall outside their own
  // project's scope (PRD #10 §39, §172).
  if (input.projectManagerMemberId) {
    await ensureProjectMember(
      tx,
      context,
      created.id,
      input.projectManagerMemberId,
      "Project Manager",
      true,
    );
  }

  await recordActivity(tx, context, {
    module: MODULE,
    entityType: "Project",
    entityId: created.id,
    action: "PROJECT_CREATED",
    message: "created the project",
    metadata: { projectId: created.id } as Prisma.InputJsonValue,
  });

  await recordUserAction(
    context,
    {
      actionKey: AuditAction.PROJECT_CREATED,
      entity: { type: "Project", id: created.id, label: created.name },
      projectId: created.id,
      after: { code: created.code, name: created.name, status: input.status, projectType: input.projectType ?? null },
    },
    { tx },
  );

  return created;
}

export async function updateProject(
  context: UserContext,
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project.update");

  const existing = assertFound(await repository.findProjectInScope(context, projectId));

  // An archived project is read-only: it must be restored first (PRD #10 §58).
  if (isProjectArchived(existing)) {
    throw new AccessError("CONFLICT", "Restore this project before editing it.");
  }

  if (
    input.versionUpdatedAt &&
    existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()
  ) {
    throw new AccessError(
      "CONFLICT",
      "This project was updated by another user. Refresh and review the latest changes.",
    );
  }

  // A different status is a move on the project machine, under the status
  // permission rather than the edit one (E-05A §11, §12).
  const nextStatus = input.status ?? existing.status;
  const statusAction = nextStatus === existing.status ? null : requireStatusAction(existing.status, nextStatus);
  if (statusAction) {
    assertTransitionAllowed(projectMachine, { currentState: existing.status, action: statusAction, context });
  }

  const clientId = await validateClient(context, input.clientId, existing.clientId);
  const managerMemberId = await validateManager(context, input.projectManagerMemberId);
  const coverImageDocumentId =
    input.coverImageDocumentId === undefined
      ? existing.coverImageDocumentId
      : await validateCover(context, projectId, input.coverImageDocumentId, existing.coverImageDocumentId);

  const managerChanged = managerMemberId !== existing.projectManagerMemberId;
  if (managerChanged) {
    // Assigning a manager can be a separate grant from ordinary editing
    // (PRD #10 §118).
    assertPermission(context, "project.manager.assign");
  }

  const before = detailsOf(existing);
  const after = {
    code: input.code.trim(),
    name: input.name,
    description: input.description ?? null,
    clientId,
    priority: input.priority ?? null,
    projectType: input.projectType ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    coverImageDocumentId,
  };
  const changed = changedFields(before, after);

  await prisma
    .$transaction(async (tx) => {
      if (statusAction) {
        await applyTransition(tx, {
          machine: projectMachine,
          action: statusAction,
          id: projectId,
          context,
          from: existing.status,
          data: { updatedBy: context.userId },
        });
      }

      await tx.project.update({
        where: { id: projectId },
        // Spelled out rather than spread, so the state gate can read that the
        // status is not among them — it moves only through the machine above.
        data: {
          code: after.code,
          name: after.name,
          description: after.description,
          clientId: after.clientId,
          priority: input.priority ?? null,
          projectType: input.projectType ?? null,
          startDate: after.startDate,
          endDate: after.endDate,
          address: after.address,
          city: after.city,
          country: after.country,
          coverImageDocumentId: after.coverImageDocumentId,
          projectManagerMemberId: managerMemberId,
          updatedBy: context.userId,
        },
      });

      if (managerChanged && managerMemberId) {
        await ensureProjectMember(tx, context, projectId, managerMemberId, "Project Manager", true);
      }

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: "Project",
        entityId: projectId,
        action: "PROJECT_UPDATED",
        message: "updated the project",
        metadata: { projectId } as Prisma.InputJsonValue,
      });

      if (Object.keys(changed.before).length > 0) {
        await recordUserAction(
          context,
          {
            actionKey: AuditAction.PROJECT_UPDATED,
            entity: { type: "Project", id: projectId, label: existing.name },
            projectId,
            before: changed.before,
            after: changed.after,
          },
          { tx },
        );
      }

      if (statusAction) {
        await recordStatusChange(tx, context, { id: projectId, name: existing.name }, existing.status, nextStatus, null);
      }

      if (managerChanged) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: "Project",
          entityId: projectId,
          action: "PROJECT_MANAGER_CHANGED",
          message: "changed the project manager",
          metadata: { projectId } as Prisma.InputJsonValue,
        });

        await recordUserAction(
          context,
          {
            actionKey: AuditAction.PROJECT_MANAGER_CHANGED,
            entity: { type: "Project", id: projectId, label: existing.name },
            projectId,
            before: { projectManagerMemberId: existing.projectManagerMemberId },
            after: { projectManagerMemberId: input.projectManagerMemberId ?? null },
          },
          { tx },
        );
      }
    })
    .catch(translateWriteError);

  return getProject(context, projectId);
}

/**
 * Moves a project between Pending, Active and Finished (E-05A §11, §12, §40).
 *
 * Permission, then the project inside the caller's scope, then the move the
 * machine declares — with the state the caller read in the write, so two people
 * changing the status at once cannot both succeed. Setting the status a project
 * already has changes nothing and writes nothing.
 */
export async function changeProjectStatus(
  context: UserContext,
  projectId: string,
  input: ChangeProjectStatusInput,
): Promise<ProjectDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project.status.manage");

  const existing = assertFound(await repository.findProjectInScope(context, projectId));
  if (isProjectArchived(existing)) {
    throw stateDenied("Restore this project before changing its status.");
  }
  if (existing.status === input.status) return getProject(context, projectId);

  const action = requireStatusAction(existing.status, input.status);
  assertTransitionAllowed(projectMachine, { currentState: existing.status, action, context, reason: input.reason });

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: projectMachine,
      action,
      id: projectId,
      context,
      from: existing.status,
      reason: input.reason,
      data: { updatedBy: context.userId },
    });
    await recordStatusChange(tx, context, { id: projectId, name: existing.name }, existing.status, input.status, input.reason ?? null);
  });

  return getProject(context, projectId);
}

function requireStatusAction(from: ProjectStatus, to: ProjectStatus) {
  const action = statusActionFor(from, to);
  if (!action) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A project cannot move from ${projectStatusLabels[from]} to ${projectStatusLabels[to]}.`,
    );
  }
  return action;
}

/**
 * The record of a status move (E-05A §12): an activity entry for the project's
 * timeline and an audit event holding the previous and new state, the actor,
 * the company, the time and the reason where one was given.
 */
async function recordStatusChange(
  tx: Prisma.TransactionClient,
  context: UserContext,
  project: { id: string; name: string },
  from: ProjectStatus,
  to: ProjectStatus,
  reason: string | null,
) {
  await recordActivity(tx, context, {
    module: MODULE,
    entityType: "Project",
    entityId: project.id,
    action: "PROJECT_STATUS_CHANGED",
    message: `changed the status from ${projectStatusLabels[from]} to ${projectStatusLabels[to]}`,
    metadata: {
      projectId: project.id,
      ...(changeMetadata({ status: { from, to } }) as object),
      ...(reason ? { reason } : {}),
    } as Prisma.InputJsonValue,
  });

  await recordUserAction(
    context,
    {
      actionKey: AuditAction.PROJECT_STATUS_CHANGED,
      entity: { type: "Project", id: project.id, label: project.name },
      projectId: project.id,
      before: { status: from },
      after: { status: to },
      reason,
    },
    { tx },
  );
}

type ProjectDetails = {
  code: string;
  name: string;
  description: string | null;
  clientId: string | null;
  priority: string | null;
  projectType: string | null;
  startDate: Date | null;
  endDate: Date | null;
  address: string | null;
  city: string | null;
  country: string | null;
  coverImageDocumentId: string | null;
};

function detailsOf(row: repository.ProjectDetailRow): ProjectDetails {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    clientId: row.clientId,
    priority: row.priority,
    projectType: row.projectType,
    startDate: row.startDate,
    endDate: row.endDate,
    address: row.address,
    city: row.city,
    country: row.country,
    coverImageDocumentId: row.coverImageDocumentId,
  };
}

/** Only the fields an edit actually changed, so the audit event says what happened. */
function changedFields(before: ProjectDetails, after: ProjectDetails) {
  const result: { before: Record<string, unknown>; after: Record<string, unknown> } = { before: {}, after: {} };
  for (const key of Object.keys(after) as Array<keyof ProjectDetails>) {
    const a = before[key];
    const b = after[key];
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) {
      result.before[key] = a instanceof Date ? a.toISOString() : a;
      result.after[key] = b instanceof Date ? b.toISOString() : b;
    }
  }
  return result;
}

export async function archiveProject(context: UserContext, projectId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "project.archive");

  const existing = assertFound(await repository.findProjectInScope(context, projectId));
  if (isProjectArchived(existing)) return;

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: projectMachine,
      action: "archive",
      id: projectId,
      context,
      from: existing.status,
      data: {
        // Remembered so Restore returns the project where it was, rather than
        // always to Active (PRD #10 §68).
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedBy: context.userId,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "Project",
      entityId: projectId,
      action: "PROJECT_ARCHIVED",
      message: "archived the project",
      metadata: { projectId } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_ARCHIVED,
        entity: { type: "Project", id: projectId, label: existing.name },
        projectId,
        before: { status: existing.status, archivedAt: null },
        after: { status: "ARCHIVED" },
      },
      { tx },
    );
  });

  // Tasks, documents, members and activity are deliberately untouched
  // (PRD #10 §65).
}

export async function restoreProject(context: UserContext, projectId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "project.restore");

  const existing = assertFound(await repository.findProjectInScope(context, projectId));
  if (!isProjectArchived(existing)) return;

  const restoredStatus = existing.preArchiveStatus && existing.preArchiveStatus !== "ARCHIVED" ? existing.preArchiveStatus : "ACTIVE";

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: projectMachine,
      action: "restore",
      id: projectId,
      context,
      from: "ARCHIVED",
      to: restoredStatus,
      data: {
        preArchiveStatus: null,
        archivedAt: null,
        archivedBy: null,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "Project",
      entityId: projectId,
      action: "PROJECT_RESTORED",
      message: "restored the project",
      metadata: { projectId } as Prisma.InputJsonValue,
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_RESTORED,
        entity: { type: "Project", id: projectId, label: existing.name },
        projectId,
        before: { status: "ARCHIVED" },
        after: { status: restoredStatus, archivedAt: null },
      },
      { tx },
    );
  });
}

/* Members ------------------------------------------------------------------ */

export async function addMember(
  context: UserContext,
  projectId: string,
  input: AddProjectMemberInput,
): Promise<void> {
  assertPermission(context, "project.member.add");
  const project = await assertProjectInScope(context, projectId);

  if (isProjectArchived(project)) {
    throw new AccessError("CONFLICT", "Restore this project before changing its team.");
  }

  const member = await prisma.companyMember.findFirst({
    where: { id: input.companyMemberId, companyId: context.companyId, status: "ACTIVE" },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });

  if (!member) {
    // Covers "another company", "does not exist" and "membership inactive"
    // with one answer, so the response reveals nothing (PRD #10 §74).
    throw new AccessError("VALIDATION_ERROR", "That person cannot be added to this project.");
  }

  const existing = await prisma.projectMember.findUnique({
    where: { projectId_companyMemberId: { projectId, companyMemberId: member.id } },
    select: { id: true, status: true },
  });

  if (existing && existing.status === "ACTIVE") {
    throw new AccessError("CONFLICT", "This person is already part of the project.");
  }

  await prisma.$transaction(async (tx) => {
    await ensureProjectMember(tx, context, projectId, member.id, input.projectRole ?? null, false);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "Project",
      entityId: projectId,
      action: "PROJECT_MEMBER_ADDED",
      message: `added ${member.user.firstName} ${member.user.lastName} to the project`,
      metadata: { projectId } as Prisma.InputJsonValue,
    });
  });
}

export async function updateMember(
  context: UserContext,
  projectId: string,
  projectMemberId: string,
  input: UpdateProjectMemberInput,
): Promise<void> {
  assertPermission(context, "project.member.update");
  const project = await assertProjectInScope(context, projectId);

  // An archived project's team is part of its record, like everything else on
  // it: restore first, as `addMember` already requires (PRD #10 §58, PRD #47 §87).
  if (isProjectArchived(project)) {
    throw stateDenied("Restore this project before changing its team.");
  }

  const record = assertFound(
    await prisma.projectMember.findFirst({
      where: { id: projectMemberId, projectId, companyId: context.companyId },
      select: { id: true },
    }),
  );

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.update({
      where: { id: record.id },
      data: {
        projectRole: input.projectRole ?? null,
        ...(input.isPrimary === undefined ? {} : { isPrimary: input.isPrimary }),
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "Project",
      entityId: projectId,
      action: "PROJECT_MEMBER_UPDATED",
      message: "updated a project team member",
      metadata: { projectId } as Prisma.InputJsonValue,
    });
  });
}

export async function removeMember(
  context: UserContext,
  projectId: string,
  projectMemberId: string,
): Promise<void> {
  assertPermission(context, "project.member.remove");
  const project = await assertProjectInScope(context, projectId);

  if (isProjectArchived(project)) {
    throw stateDenied("Restore this project before changing its team.");
  }

  const record = assertFound(
    await prisma.projectMember.findFirst({
      where: { id: projectMemberId, projectId, companyId: context.companyId },
      select: {
        id: true,
        companyMemberId: true,
        member: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
  );

  // Removing the acting project manager would leave the project without one;
  // reassign first (PRD #10 §77).
  if (project.projectManagerMemberId === record.companyMemberId) {
    throw new AccessError(
      "CONFLICT",
      "Assign a different project manager before removing this person from the team.",
    );
  }

  await prisma.$transaction(async (tx) => {
    // Historical membership is kept, not deleted (PRD #10 §76).
    await tx.projectMember.update({
      where: { id: record.id },
      data: { status: "INACTIVE", leftAt: new Date() },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "Project",
      entityId: projectId,
      action: "PROJECT_MEMBER_REMOVED",
      message: `removed ${record.member.user.firstName} ${record.member.user.lastName} from the project`,
      metadata: { projectId } as Prisma.InputJsonValue,
    });
  });
}

/** Open tasks a departing member still holds, so the UI can warn (PRD #10 §175). */
export async function openTasksForMember(
  context: UserContext,
  projectId: string,
  companyMemberId: string,
): Promise<number> {
  return prisma.task.count({
    where: {
      companyId: context.companyId,
      projectId,
      assigneeMemberId: companyMemberId,
      archivedAt: null,
      status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
    },
  });
}

/**
 * Company members who could be added to the project (PRD #10 §73).
 *
 * The project is loaded in the caller's scope first, whoever calls this: the
 * list says who is *not* on a project, which for a project the caller cannot
 * open is still a statement about its team (PRD #47 §62).
 */
export async function assignableMembers(context: UserContext, projectId: string) {
  assertPermission(context, "project.member.view");
  await assertProjectInScope(context, projectId);

  return prisma.companyMember.findMany({
    where: {
      companyId: context.companyId,
      status: "ACTIVE",
      NOT: { projectMemberships: { some: { projectId, status: "ACTIVE" } } },
    },
    orderBy: [{ user: { firstName: "asc" } }],
    select: {
      id: true,
      jobTitle: true,
      role: { select: { key: true, name: true } },
      department: { select: { name: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Prisma foreign keys cannot guarantee that two records share a company, so
 * every related id is re-read inside the current company before use
 * (PRD #10 §94).
 *
 * A client is read through the caller's own client scope, not merely the
 * company (PRD #47 §50, §62). Linking matters beyond the form: a scoped user
 * reaches clients *through* their projects, so an engineer who could attach
 * any company client to their project would thereby widen their own client
 * scope to it. The client a project already has stays acceptable as it is —
 * editing the name of a project must not fail over a link somebody else made.
 */
async function validateClient(
  context: UserContext,
  clientId: string | undefined,
  currentClientId: string | null,
): Promise<string | null> {
  if (!clientId) return null;
  if (clientId === currentClientId) return clientId;

  const client = await prisma.client.findFirst({
    where: { AND: [buildClientScopeWhere(context), { id: clientId }] },
    select: { id: true },
  });

  if (!client) {
    // One answer either way; the reason only reaches the security log.
    const inCompany = await prisma.client.count({ where: { id: clientId, companyId: context.companyId } });
    throw invalidRecordLink(
      "clientId",
      inCompany > 0 ? "SCOPE_DENIED" : "CROSS_COMPANY_REFERENCE",
      "That client is not available.",
    );
  }
  return client.id;
}

async function validateManager(
  context: UserContext,
  memberId: string | undefined,
): Promise<string | null> {
  if (!memberId) return null;

  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: context.companyId, status: "ACTIVE" },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That project manager is not available.");
  }
  return member.id;
}

/**
 * Image documents on this project the editor can open — what a cover may be
 * chosen from (E-05A §8, §73).
 *
 * Restricting covers to the project's own images, readable by the person
 * choosing, is what keeps a cover from announcing a file somebody else could
 * not open: everybody who can see the project can normally read its images,
 * and anybody who cannot gets the placeholder, never the render.
 */
export async function coverCandidates(context: UserContext, projectId: string) {
  assertPermission(context, "project.update");
  await assertProjectInScope(context, projectId);
  if (!isModuleEnabled(context, "documents") || !can(context, "document.view") || !can(context, "document.download")) return [];

  const access = await buildDocumentAccessWhere(context);
  const rows = await prisma.document.findMany({
    where: {
      AND: [access, { companyId: context.companyId, projectId, status: "ACTIVE", storageStatus: "AVAILABLE" }],
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, name: true, mimeType: true, detectedMimeType: true },
  });
  return rows
    .filter((row) => isThumbnailableMimeType(row.detectedMimeType ?? row.mimeType))
    .map((row) => ({ id: row.id, name: row.name }));
}

async function validateCover(
  context: UserContext,
  projectId: string,
  documentId: string,
  currentId: string | null,
): Promise<string | null> {
  if (documentId === "") return null;
  if (documentId === currentId) return currentId;
  const candidates = await coverCandidates(context, projectId);
  if (!candidates.some((candidate) => candidate.id === documentId)) {
    // One answer for "not an image", "another project" and "not yours to open".
    throw new AccessError("VALIDATION_ERROR", "That image cannot be used as the project cover.", { field: "coverImageDocumentId" });
  }
  return documentId;
}

async function assertProjectInScope(context: UserContext, projectId: string) {
  assertModule(context, MODULE);
  return assertFound(await repository.findProjectInScope(context, projectId));
}

async function ensureProjectMember(
  tx: Prisma.TransactionClient,
  context: UserContext,
  projectId: string,
  companyMemberId: string,
  projectRole: string | null,
  isPrimary: boolean,
): Promise<void> {
  await tx.projectMember.upsert({
    where: { projectId_companyMemberId: { projectId, companyMemberId } },
    update: { status: "ACTIVE", leftAt: null, ...(isPrimary ? { isPrimary: true, projectRole } : {}) },
    create: {
      companyId: context.companyId,
      projectId,
      companyMemberId,
      projectRole,
      isPrimary,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });
}

/**
 * The database unique constraint is the final protection against two people
 * creating the same project code at once (PRD #10 §162).
 */
function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AccessError("CONFLICT", "A project with this code already exists.");
  }
  throw error;
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                     */
/* -------------------------------------------------------------------------- */

function toSummaryDTO(row: repository.ProjectSummaryRow): ProjectSummaryDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    priority: row.priority,
    client: row.client ? { id: row.client.id, name: row.client.name } : null,
    projectManager: row.projectManager
      ? {
          memberId: row.projectManager.id,
          fullName: `${row.projectManager.user.firstName} ${row.projectManager.user.lastName}`,
        }
      : null,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    teamSize: row._count.members,
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function toDetailDTO(
  row: repository.ProjectDetailRow,
  counts: { members: number; openTasks: number; documents: number },
): ProjectDetailDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    preArchiveStatus: row.preArchiveStatus,
    priority: row.priority,
    client: row.client ? { id: row.client.id, name: row.client.name } : null,
    projectManager: row.projectManager
      ? {
          memberId: row.projectManager.id,
          userId: row.projectManager.user.id,
          fullName: `${row.projectManager.user.firstName} ${row.projectManager.user.lastName}`,
          avatarUrl: row.projectManager.user.avatarUrl,
          membershipActive: row.projectManager.status === "ACTIVE",
        }
      : null,
    schedule: {
      startDate: row.startDate?.toISOString() ?? null,
      endDate: row.endDate?.toISOString() ?? null,
    },
    location: { address: row.address, city: row.city, country: row.country },
    company: { id: row.company.id, name: row.company.name },
    projectType: row.projectType ? { key: row.projectType, label: projectTypeLabel(row.projectType)! } : null,
    coverImageDocumentId: row.coverImageDocumentId,
    lastActivityAt: row.lastActivityAt.toISOString(),
    counts,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** Convenience for UI code that must decide whether to render an action. */
export function projectActions(context: UserContext) {
  return {
    canCreate: can(context, "project.create"),
    canUpdate: can(context, "project.update"),
    canManageStatus: can(context, "project.status.manage"),
    canArchive: can(context, "project.archive"),
    canRestore: can(context, "project.restore"),
    canManageMembers: can(context, "project.member.add"),
    canViewMembers: can(context, "project.member.view"),
    canViewTasks: can(context, "project.task.view") && can(context, "task.view"),
    // The project's schedule is read through the calendar, never a copy of it (PRD #39 §103, §159).
    canViewCalendar: canAccessModule(context, "calendar") && can(context, "calendar.view"),
    // The project's meetings, filtered from the meetings module (PRD #40 §7, §123).
    canViewMeetings: canAccessModule(context, "meetings") && can(context, "meeting.view"),
    // The project's daily site record (PRD #43 §5, §6).
    canViewDailyLogs: isModuleEnabled(context, "dailyLogs") && canAccessModule(context, "dailyLogs") && can(context, "daily_log.view"),
    // The project's plan: phases, milestones, timeline and dependencies (PRD #44 §6, §7).
    canViewPlanning: can(context, "project_planning.view"),
    // Contractors, work packages and their compliance on the project (PRD #46 §9).
    canViewContractors: isModuleEnabled(context, "contractors") && canAccessModule(context, "contractors") && can(context, "project_contractor.view"),
    // Drawings, documents, RFIs, submittals and transmittals (PRD #46 §10).
    canViewEngineering: isModuleEnabled(context, "engineering") && canAccessModule(context, "engineering") && (can(context, "rfi.view") || can(context, "engineering_document.view")),
    canViewDocuments: can(context, "project.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "project.activity.view"),
    /**
     * The Finance tab appears when the reader holds at least one finance
     * permission that has something to show on a project (PRD #15 §182).
     *
     * An Architect with only `finance.project_budget.view` sees a budget
     * summary; a Project Manager also sees commitments. Somebody with none of
     * them sees no tab rather than an empty one.
     */
    canViewFinance:
      can(context, "finance.view") &&
      (can(context, "finance.project_budget.view") ||
        can(context, "finance.project_cost_summary.view") ||
        can(context, "finance.invoice.view") ||
        can(context, "finance.expense.view") ||
        can(context, "finance.commitment.view")),
    /**
     * The Contracts tab needs project access *and* legal access to the
     * agreements behind the job (PRD #18 §11, §440). Being given a project does
     * not hand somebody the contracts on it — the contract scope narrows the
     * list again, and a company with the module switched off has no tab at all
     * (PRD #18 §518).
     */
    canViewContracts:
      isModuleEnabled(context, "contracts") &&
      can(context, "legal.view") &&
      can(context, "legal.contract.view"),
    /**
     * The Inventory tab needs project access *and* inventory access to the
     * material on the job (PRD #20 §10, §182).
     *
     * Being given a project does not hand somebody the stock behind it: the
     * inventory scope narrows every figure again, and a company with the module
     * switched off has no tab at all (PRD #20 §301).
     */
    canViewInventory:
      isModuleEnabled(context, "inventory") &&
      can(context, "inventory.view") &&
      (can(context, "inventory.issue.view") || can(context, "inventory.reservation.view")),
    /**
     * The QA/QC tab needs project access *and* quality access to the work on
     * the job (PRD #21 §11, §26).
     *
     * Being given a project does not hand somebody its quality record: the
     * quality scope narrows every list again, and a company with the module
     * switched off has no tab at all.
     */
    canViewQaqc:
      isModuleEnabled(context, "qaqc") &&
      can(context, "qaqc.view") &&
      (can(context, "qaqc.inspection.view") ||
        can(context, "qaqc.defect.view") ||
        can(context, "qaqc.ncr.view")),
    /**
     * The HSE tab needs project access *and* safety access to what happened on
     * the job (PRD #22 §12, §26, §373).
     *
     * Being given a project does not hand somebody its incident history: the
     * HSE scope narrows every list again, and a company with the module
     * switched off has no tab at all (PRD #22 §450).
     */
    canViewHse:
      isModuleEnabled(context, "hse") &&
      can(context, "hse.view") &&
      (can(context, "hse.hazard.view") ||
        can(context, "hse.incident.view") ||
        can(context, "hse.inspection.view") ||
        can(context, "hse.permit.view")),
  };
}
