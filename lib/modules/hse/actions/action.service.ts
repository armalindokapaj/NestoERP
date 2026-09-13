import { Prisma } from "@prisma/client";
import { IntegrationType } from "@/lib/core/integrations/integration.registry";
import { linkIntegration } from "@/lib/core/integrations/integration.service";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import {
  dateString,
  daysOverdue,
  isOverdue,
  loadMemberRef,
  loadMembers,
  toProjectRef,
} from "../hse.dto";
import { nextHseNumber } from "../hse.numbering";
import { buildActionScopeWhere, buildHseMemberWhere, buildHseProjectWhere } from "../hse.scope";
import type { ActionInput, ActionListQuery } from "../hse.schema";
import {
  isActionCancellable,
  isActionCompletable,
  isActionEditable,
  isActionReopenable,
  isActionVerifiable,
  OPEN_ACTION_STATUSES,
} from "../hse.status";
import type { ActionDetailDTO, ActionSourceDTO, ActionSummaryDTO } from "../hse.types";

/**
 * HSE actions (PRD #22 §114–§128).
 *
 * The corrective or preventive obligation that comes out of a hazard, an
 * incident, an inspection, a risk assessment, an observation, a stop-work or a
 * permit. Two rules shape this file.
 *
 * **An action is not a Task** (PRD #22 §128). The action is the safety
 * obligation and the record that it was discharged and checked; a Task is the
 * work item somebody uses to do it. Creating a Task from an action uses the
 * canonical Task, and the action keeps its own lifecycle.
 *
 * **Whoever did the work does not verify it** (PRD #22 §122). Completing moves
 * it to PENDING_VERIFICATION; somebody else says VERIFIED. One person doing both
 * makes the status meaningless, so verification is an APPROVE-level grant and
 * the service refuses self-verification independently of the page.
 */

const MODULE = "hse" as const;
const ENTITY = "HseAction";

const LIST_SELECT = {
  id: true,
  actionNumber: true,
  actionType: true,
  title: true,
  priority: true,
  status: true,
  assignedToMemberId: true,
  dueDate: true,
  updatedAt: true,
  hazardId: true,
  incidentId: true,
  inspectionId: true,
  riskAssessmentId: true,
  environmentalObservationId: true,
  stopWorkId: true,
  permitId: true,
  project: { select: { id: true, code: true, name: true } },
  hazard: { select: { id: true, hazardNumber: true } },
  incident: { select: { id: true, incidentNumber: true } },
  inspection: { select: { id: true, inspectionNumber: true } },
  riskAssessment: { select: { id: true, assessmentNumber: true } },
  environmentalObservation: { select: { id: true, observationNumber: true } },
  stopWork: { select: { id: true, stopWorkNumber: true } },
  permit: { select: { id: true, permitNumber: true } },
} satisfies Prisma.HseActionSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  completionNote: true,
  completedAt: true,
  completedByMemberId: true,
  verificationNote: true,
  verifiedAt: true,
  verifiedByMemberId: true,
  cancelledAt: true,
  createdByMemberId: true,
  createdAt: true,
} satisfies Prisma.HseActionSelect;

type ListRow = Prisma.HseActionGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.HseActionGetPayload<{ select: typeof DETAIL_SELECT }>;

/** Which parent an action hangs off, for the scoped lookups below. */
export type ActionParent = {
  hazardId?: string;
  incidentId?: string;
  inspectionId?: string;
  riskAssessmentId?: string;
  environmentalObservationId?: string;
  stopWorkId?: string;
  permitId?: string;
};

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listActions(context: UserContext, query: ActionListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.view");

  const filters: Prisma.HseActionWhereInput[] = [buildActionScopeWhere(context)];

  if (query.view === "open") filters.push({ status: { in: OPEN_ACTION_STATUSES } });
  if (query.view === "mine") filters.push({ assignedToMemberId: context.membershipId });
  if (query.view === "overdue") {
    filters.push({ status: { in: OPEN_ACTION_STATUSES }, dueDate: { lt: startOfToday() } });
  }
  if (query.view === "verification") filters.push({ status: "PENDING_VERIFICATION" });

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.actionType?.length) filters.push({ actionType: { in: query.actionType } });
  if (query.priority?.length) filters.push({ priority: { in: query.priority } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assignedToMemberId) filters.push({ assignedToMemberId: query.assignedToMemberId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { actionNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.HseActionWhereInput = { AND: filters };

  const orderBy: Prisma.HseActionOrderByWithRelationInput[] =
    query.sort === "due-asc"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }]
      : query.sort === "priority-desc"
        ? [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }]
        : query.sort === "number-asc"
          ? [{ actionNumber: "asc" }]
          : [{ updatedAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.hseAction.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.hseAction.count({ where }),
  ]);

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(context, row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getAction(
  context: UserContext,
  actionId: string,
): Promise<ActionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.view");

  const row = assertFound(
    await prisma.hseAction.findFirst({
      where: { AND: [buildActionScopeWhere(context), { id: actionId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, tasks] = await Promise.all([
    loadMembers([row.assignedToMemberId, row.completedByMemberId, row.verifiedByMemberId]),
    loadMemberRef(row.createdByMemberId),
    linkedTasks(context, actionId),
  ]);

  return {
    ...toSummaryDTO(context, row, members),
    description: row.description,
    completionNote: row.completionNote,
    completedBy: row.completedByMemberId
      ? (members.get(row.completedByMemberId) ?? null)
      : null,
    completedAt: dateString(row.completedAt),
    verificationNote: row.verificationNote,
    verifiedBy: row.verifiedByMemberId ? (members.get(row.verifiedByMemberId) ?? null) : null,
    verifiedAt: dateString(row.verifiedAt),
    cancelledAt: dateString(row.cancelledAt),
    tasks,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row),
  };
}

/** Every action hanging off one parent record (PRD #22 §92, §115). */
export async function listForParent(
  context: UserContext,
  parent: ActionParent,
): Promise<ActionSummaryDTO[]> {
  if (!can(context, "hse.action.view")) return [];

  const rows = await prisma.hseAction.findMany({
    where: { AND: [buildActionScopeWhere(context), parent] },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(context, row, members));
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<ActionSummaryDTO[]> {
  if (!can(context, "hse.action.view")) return [];

  const rows = await prisma.hseAction.findMany({
    where: { AND: [buildActionScopeWhere(context), { projectId }] },
    orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(context, row, members));
}

export async function actionFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.view");

  const scope = buildActionScopeWhere(context);

  const [projects, assignees] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [buildHseProjectWhere(context), { hseActions: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedHseActions: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, assignees };
}

export async function actionFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: buildHseProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildHseMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, members };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createAction(
  context: UserContext,
  input: ActionInput,
): Promise<ActionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.create");

  if (input.projectId) await requireProject(context, input.projectId);
  await requireMember(context, input.assignedToMemberId);

  const parent = await resolveParent(context, input);

  const id = await prisma.$transaction(async (tx) => {
    const actionNumber = await nextHseNumber(tx, "hseAction", context.companyId);

    const action = await tx.hseAction.create({
      data: {
        companyId: context.companyId,
        actionNumber,
        actionType: input.actionType,
        title: input.title,
        description: input.description,
        projectId: input.projectId ?? parent.projectId ?? null,
        hazardId: input.hazardId ?? null,
        incidentId: input.incidentId ?? null,
        inspectionId: input.inspectionId ?? null,
        riskAssessmentId: input.riskAssessmentId ?? null,
        environmentalObservationId: input.environmentalObservationId ?? null,
        stopWorkId: input.stopWorkId ?? null,
        permitId: input.permitId ?? null,
        assignedToMemberId: input.assignedToMemberId,
        priority: input.priority,
        status: "OPEN",
        dueDate: input.dueDate ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, actionNumber: true },
    });

    /*
     * An incident with actions against it moves on by itself (PRD #22 §93):
     * "under investigation" stops being true the moment there is something to
     * do, and a status somebody has to remember to change is a status that goes
     * stale.
     */
    if (input.incidentId) {
      await tx.hseIncident.updateMany({
        where: { id: input.incidentId, status: { in: ["OPEN", "UNDER_INVESTIGATION"] } },
        data: { status: "ACTIONS_OPEN" },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: action.id,
      action: "HSE_ACTION_CREATED",
      message: `raised action ${action.actionNumber}`,
    });

    return action.id;
  });

  return getAction(context, id);
}

export async function updateAction(
  context: UserContext,
  actionId: string,
  input: ActionInput,
): Promise<ActionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.update");

  const existing = await requireAction(context, actionId);

  if (!isActionEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A verified action cannot be edited. Reopen it first.", {
      code: "ACTION_VERIFIED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  if (input.projectId) await requireProject(context, input.projectId);
  await requireMember(context, input.assignedToMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.hseAction.update({
      where: { id: actionId },
      data: {
        actionType: input.actionType,
        title: input.title,
        description: input.description,
        projectId: input.projectId ?? null,
        assignedToMemberId: input.assignedToMemberId,
        priority: input.priority,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "HSE_ACTION_CREATED",
      message: `updated action ${existing.actionNumber}`,
    });
  });

  return getAction(context, actionId);
}

export async function assignAction(
  context: UserContext,
  actionId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.assign");

  const existing = await requireAction(context, actionId);

  if (!isActionEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A verified action cannot be reassigned.", {
      code: "ACTION_VERIFIED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.hseAction.update({
      where: { id: actionId },
      data: {
        assignedToMemberId: member.id,
        status: existing.status === "OPEN" ? "IN_PROGRESS" : existing.status,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "HSE_ACTION_ASSIGNED",
      message: `assigned action ${existing.actionNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/** Whoever did the work says what they did (PRD #22 §121). */
export async function completeAction(
  context: UserContext,
  actionId: string,
  completionNote: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.complete");

  const existing = await requireAction(context, actionId);

  if (!isActionCompletable(existing.status)) {
    throw new AccessError("CONFLICT", "This action is not open.", { code: "NOT_OPEN" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseAction.update({
      where: { id: actionId },
      data: {
        status: "PENDING_VERIFICATION",
        completionNote,
        completedAt: new Date(),
        completedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "HSE_ACTION_COMPLETED",
      message: `completed action ${existing.actionNumber}`,
    });
  });
}

/**
 * Somebody else agrees the control is genuinely in (PRD #22 §122).
 *
 * The person who completed it may not verify it: that is the whole point of
 * having two states. `hse.action.verify` is an APPROVE-level grant, and this
 * check makes it mean something even for somebody who holds both.
 */
export async function verifyAction(
  context: UserContext,
  actionId: string,
  verificationNote: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.verify");

  const existing = assertFound(
    await prisma.hseAction.findFirst({
      where: { AND: [buildActionScopeWhere(context), { id: actionId }] },
      select: { id: true, actionNumber: true, status: true, completedByMemberId: true },
    }),
  );

  if (!isActionVerifiable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An action is verified once somebody has recorded what they did.",
      { code: "NOT_COMPLETED" },
    );
  }

  assertNotSelfVerification(context, existing.completedByMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.hseAction.update({
      where: { id: actionId },
      data: {
        status: "VERIFIED",
        verificationNote,
        verifiedAt: new Date(),
        verifiedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "HSE_ACTION_VERIFIED",
      message: `verified action ${existing.actionNumber}`,
    });
  });
}

/** The correction was not good enough, and the assignee is told why (§123). */
export async function rejectAction(
  context: UserContext,
  actionId: string,
  verificationNote: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.verify");

  const existing = assertFound(
    await prisma.hseAction.findFirst({
      where: { AND: [buildActionScopeWhere(context), { id: actionId }] },
      select: { id: true, actionNumber: true, status: true, completedByMemberId: true },
    }),
  );

  if (!isActionVerifiable(existing.status)) {
    throw new AccessError("CONFLICT", "This action is not waiting on verification.", {
      code: "NOT_COMPLETED",
    });
  }

  assertNotSelfVerification(context, existing.completedByMemberId);

  await prisma.$transaction(async (tx) => {
    await tx.hseAction.update({
      where: { id: actionId },
      data: {
        status: "REJECTED",
        verificationNote,
        verifiedAt: new Date(),
        verifiedByMemberId: context.membershipId,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "HSE_ACTION_REJECTED",
      message: `sent action ${existing.actionNumber} back`,
    });
  });
}

export async function reopenAction(
  context: UserContext,
  actionId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.reopen");

  const existing = await requireAction(context, actionId);

  if (!isActionReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "This action is not verified.", { code: "NOT_VERIFIED" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseAction.update({
      where: { id: actionId },
      data: {
        status: "REOPENED",
        verifiedAt: null,
        verifiedByMemberId: null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "HSE_ACTION_REOPENED",
      message: `reopened action ${existing.actionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelAction(
  context: UserContext,
  actionId: string,
  reason: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.action.cancel");

  const existing = await requireAction(context, actionId);

  if (!isActionCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This action is already finished.", {
      code: "NOT_CANCELLABLE",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.hseAction.update({
      where: { id: actionId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "HSE_ACTION_CANCELLED",
      message: `cancelled action ${existing.actionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Raises a canonical Task to discharge this action (PRD #22 §126, §127).
 *
 * The Task is the work item somebody does; the action keeps its own obligation
 * and verification lifecycle, and creating a Task advances neither
 * (PRD #22 §128). The task inherits the action's project so it turns up on the
 * right site's board.
 */
export async function createTaskForAction(
  context: UserContext,
  actionId: string,
  input: {
    title: string;
    description?: string | null;
    assigneeMemberId?: string | null;
    dueDate?: Date;
  },
): Promise<{ id: string }> {
  assertModule(context, MODULE);
  assertPermission(context, "hse.task.create");

  const action = assertFound(
    await prisma.hseAction.findFirst({
      where: { AND: [buildActionScopeWhere(context), { id: actionId }] },
      select: { id: true, projectId: true, priority: true },
    }),
  );

  const tasks = await import("@/lib/modules/tasks/task.service");

  const task = await tasks.createTask(
    context,
    {
      title: input.title,
      description: input.description ?? undefined,
      projectId: action.projectId ?? undefined,
      assigneeMemberId: input.assigneeMemberId ?? undefined,
      startDate: undefined,
      dueDate: input.dueDate,
      status: "TODO",
      // Carried across, so a critical safety action does not land on somebody's
      // board as ordinary work.
      priority: action.priority,
    },
    { moduleKey: MODULE, entityType: "hse_action", entityId: actionId },
  );

  await prisma.$transaction(async (tx) => {
    await linkIntegration(tx, context, {
      integrationType: IntegrationType.HSE_ACTION_TASK,
      source: { id: actionId },
      target: { id: task.id },
    });
  });

  return { id: task.id };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Nobody verifies their own work (PRD #22 §122).
 *
 * `hse.approval.self` is the documented exception, held by nobody by default,
 * so a one-person company can still operate.
 */
function assertNotSelfVerification(
  context: UserContext,
  completedByMemberId: string | null,
): void {
  if (completedByMemberId !== context.membershipId) return;
  if (can(context, "hse.approval.self")) return;
  throw new AccessError(
    "FORBIDDEN",
    "You completed this action, so somebody else has to verify it.",
    { code: "SELF_APPROVAL" },
  );
}

async function requireAction(context: UserContext, actionId: string) {
  return assertFound(
    await prisma.hseAction.findFirst({
      where: { AND: [buildActionScopeWhere(context), { id: actionId }] },
      select: { id: true, actionNumber: true, status: true, updatedAt: true },
    }),
  );
}

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildHseProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project;
}

async function requireMember(context: UserContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildHseMemberWhere(context), { id: memberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That person is not an active member.", {
      code: "INVALID_MEMBER",
    });
  }

  return member;
}

/**
 * Checks the parent is real and in reach, and borrows its project.
 *
 * An action raised from a hazard on Riverside belongs to Riverside whether or
 * not the form said so — otherwise it drops out of that site's action list and
 * nobody there ever sees it (PRD #22 §239).
 */
async function resolveParent(
  context: UserContext,
  input: ActionInput,
): Promise<{ projectId: string | null }> {
  const { buildHazardScopeWhere, buildIncidentScopeWhere, buildInspectionScopeWhere,
    buildObservationScopeWhere, buildPermitScopeWhere, buildRiskAssessmentScopeWhere,
    buildStopWorkScopeWhere } = await import("../hse.scope");

  if (input.hazardId) {
    const row = await prisma.hseHazard.findFirst({
      where: { AND: [buildHazardScopeWhere(context), { id: input.hazardId }] },
      select: { projectId: true },
    });
    if (!row) throw invalidParent();
    return { projectId: row.projectId };
  }

  if (input.incidentId) {
    const row = await prisma.hseIncident.findFirst({
      where: { AND: [buildIncidentScopeWhere(context), { id: input.incidentId }] },
      select: { projectId: true },
    });
    if (!row) throw invalidParent();
    return { projectId: row.projectId };
  }

  if (input.inspectionId) {
    const row = await prisma.hseInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: input.inspectionId }] },
      select: { projectId: true },
    });
    if (!row) throw invalidParent();
    return { projectId: row.projectId };
  }

  if (input.riskAssessmentId) {
    const row = await prisma.hseRiskAssessment.findFirst({
      where: { AND: [buildRiskAssessmentScopeWhere(context), { id: input.riskAssessmentId }] },
      select: { projectId: true },
    });
    if (!row) throw invalidParent();
    return { projectId: row.projectId };
  }

  if (input.environmentalObservationId) {
    const row = await prisma.environmentalObservation.findFirst({
      where: {
        AND: [buildObservationScopeWhere(context), { id: input.environmentalObservationId }],
      },
      select: { projectId: true },
    });
    if (!row) throw invalidParent();
    return { projectId: row.projectId };
  }

  if (input.stopWorkId) {
    const row = await prisma.stopWorkRecord.findFirst({
      where: { AND: [buildStopWorkScopeWhere(context), { id: input.stopWorkId }] },
      select: { projectId: true },
    });
    if (!row) throw invalidParent();
    return { projectId: row.projectId };
  }

  if (input.permitId) {
    const row = await prisma.hseWorkPermit.findFirst({
      where: { AND: [buildPermitScopeWhere(context), { id: input.permitId }] },
      select: { projectId: true },
    });
    if (!row) throw invalidParent();
    return { projectId: row.projectId };
  }

  // A standalone action is allowed (PRD #22 §239) — HSE raises preventive work
  // that no single incident prompted.
  return { projectId: null };
}

function invalidParent() {
  return new AccessError("VALIDATION_ERROR", "That record does not exist.", {
    code: "INVALID_PARENT",
  });
}

/** The canonical Tasks raised to discharge this action (PRD #22 §127). */
async function linkedTasks(context: UserContext, actionId: string) {
  if (!can(context, "hse.task.view") || !can(context, "task.view")) return [];

  const rows = await prisma.task.findMany({
    where: {
      companyId: context.companyId,
      module: MODULE,
      entityType: "hse_action",
      entityId: actionId,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true },
  });

  return rows;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this action while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

/**
 * Where the action came from, linked only where the reader may follow it.
 *
 * Action access is not hazard access. The reference is shown so the action makes
 * sense at all; the link appears only if that record is within reach
 * (PRD #22 §187).
 */
function toSourceDTO(context: UserContext, row: ListRow): ActionSourceDTO {
  if (row.hazard) {
    return {
      kind: "HAZARD",
      id: row.hazard.id,
      label: row.hazard.hazardNumber,
      href: can(context, "hse.hazard.view") ? `/hse/hazards/${row.hazard.id}` : null,
    };
  }
  if (row.incident) {
    return {
      kind: "INCIDENT",
      id: row.incident.id,
      label: row.incident.incidentNumber,
      href: can(context, "hse.incident.view") ? `/hse/incidents/${row.incident.id}` : null,
    };
  }
  if (row.inspection) {
    return {
      kind: "INSPECTION",
      id: row.inspection.id,
      label: row.inspection.inspectionNumber,
      href: can(context, "hse.inspection.view")
        ? `/hse/inspections/${row.inspection.id}`
        : null,
    };
  }
  if (row.riskAssessment) {
    return {
      kind: "RISK_ASSESSMENT",
      id: row.riskAssessment.id,
      label: row.riskAssessment.assessmentNumber,
      href: can(context, "hse.risk.view")
        ? `/hse/risk-assessments/${row.riskAssessment.id}`
        : null,
    };
  }
  if (row.environmentalObservation) {
    return {
      kind: "ENVIRONMENTAL",
      id: row.environmentalObservation.id,
      label: row.environmentalObservation.observationNumber,
      href: can(context, "hse.environment.view") ? `/hse/environment` : null,
    };
  }
  if (row.stopWork) {
    return {
      kind: "STOP_WORK",
      id: row.stopWork.id,
      label: row.stopWork.stopWorkNumber,
      href: can(context, "hse.stop_work.view") ? `/hse/stop-work` : null,
    };
  }
  if (row.permit) {
    return {
      kind: "PERMIT",
      id: row.permit.id,
      label: row.permit.permitNumber,
      href: can(context, "hse.permit.view") ? `/hse/permits/${row.permit.id}` : null,
    };
  }
  return null;
}

function toSummaryDTO(
  context: UserContext,
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): ActionSummaryDTO {
  const open = OPEN_ACTION_STATUSES.includes(row.status);

  return {
    id: row.id,
    actionNumber: row.actionNumber,
    actionType: row.actionType,
    title: row.title,
    priority: row.priority,
    status: row.status,
    project: toProjectRef(row.project),
    assignedTo: members.get(row.assignedToMemberId) ?? null,
    source: toSourceDTO(context, row),
    dueDate: dateString(row.dueDate),
    overdue: isOverdue(row.dueDate, open),
    daysOverdue: daysOverdue(row.dueDate, open),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: DetailRow) {
  // Withheld from whoever completed it, so nobody is offered a button that is
  // certain to fail (PRD #22 §122).
  const notSelf =
    row.completedByMemberId !== context.membershipId || can(context, "hse.approval.self");

  return {
    canEdit: isActionEditable(row.status) && can(context, "hse.action.update"),
    canAssign: isActionEditable(row.status) && can(context, "hse.action.assign"),
    canComplete: isActionCompletable(row.status) && can(context, "hse.action.complete"),
    canVerify: isActionVerifiable(row.status) && can(context, "hse.action.verify") && notSelf,
    canReject: isActionVerifiable(row.status) && can(context, "hse.action.verify") && notSelf,
    canReopen: isActionReopenable(row.status) && can(context, "hse.action.reopen"),
    canCancel: isActionCancellable(row.status) && can(context, "hse.action.cancel"),
    canCreateTask:
      isActionEditable(row.status) &&
      can(context, "hse.task.create") &&
      can(context, "task.create"),
    canViewDocuments: can(context, "hse.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "hse.activity.view"),
  };
}
