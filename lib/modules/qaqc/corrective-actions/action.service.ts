import { Prisma, type CorrectiveActionStatus } from "@prisma/client";
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
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import {
  dateString,
  isOverdue,
  loadMemberRef,
  loadMembers,
  toProjectRef,
} from "../qaqc.dto";
import { nextQualityNumber } from "../qaqc.numbering";
import {
  buildCorrectiveActionScopeWhere,
  buildQaqcMemberWhere,
  buildQaqcProjectWhere,
} from "../qaqc.scope";
import type {
  CorrectiveActionInput,
  CorrectiveActionListQuery,
} from "../qaqc.schema";
import {
  isActionCancellable,
  isActionCompletable,
  isActionEditable,
  isActionReopenable,
  isActionVerifiable,
} from "../qaqc.status";
import type {
  CorrectiveActionDetailDTO,
  CorrectiveActionSummaryDTO,
} from "../qaqc.types";

/**
 * Corrective actions (PRD #21 §140–§153).
 *
 * What somebody actually does about a non-conformance — and the reason an NCR
 * can close at all. Two rules shape this file:
 *
 *   1. **Every action hangs off something** (PRD #21 §221). An action with no
 *      NCR, defect or inspection behind it is a task, and Tasks already exists
 *      (§153).
 *   2. **Whoever did the work does not verify it** (PRD #21 §147). Completing
 *      and verifying are separate acts with separate grants, and the service
 *      refuses the same person doing both.
 */

const MODULE = "qaqc" as const;
const ENTITY = "CorrectiveAction";

const LIST_SELECT = {
  id: true,
  actionNumber: true,
  title: true,
  status: true,
  assignedToMemberId: true,
  dueDate: true,
  updatedAt: true,
  ncrId: true,
  defectId: true,
  inspectionId: true,
  project: { select: { id: true, code: true, name: true } },
  ncr: { select: { id: true, ncrNumber: true } },
  defect: { select: { id: true, defectNumber: true } },
  inspection: { select: { id: true, inspectionNumber: true } },
} satisfies Prisma.CorrectiveActionSelect;

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
} satisfies Prisma.CorrectiveActionSelect;

type ListRow = Prisma.CorrectiveActionGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.CorrectiveActionGetPayload<{ select: typeof DETAIL_SELECT }>;

const OPEN_STATUSES: CorrectiveActionStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "REJECTED",
  "REOPENED",
];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listActions(
  context: UserContext,
  query: CorrectiveActionListQuery,
) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.view");

  const filters: Prisma.CorrectiveActionWhereInput[] = [
    buildCorrectiveActionScopeWhere(context),
  ];

  if (query.view === "open") filters.push({ status: { in: OPEN_STATUSES } });
  if (query.view === "mine") filters.push({ assignedToMemberId: context.membershipId });
  if (query.view === "awaiting-verification") filters.push({ status: "PENDING_VERIFICATION" });
  if (query.view === "overdue") {
    filters.push({ status: { in: OPEN_STATUSES }, dueDate: { lt: startOfToday() } });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assignedToMemberId) filters.push({ assignedToMemberId: query.assignedToMemberId });
  if (query.ncrId) filters.push({ ncrId: query.ncrId });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { actionNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.CorrectiveActionWhereInput = { AND: filters };

  const orderBy: Prisma.CorrectiveActionOrderByWithRelationInput[] =
    query.sort === "due-asc"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }]
      : query.sort === "number-asc"
        ? [{ actionNumber: "asc" }]
        : [{ createdAt: "desc" }];

  const [rows, total] = await Promise.all([
    prisma.correctiveAction.findMany({
      where,
      orderBy,
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.correctiveAction.count({ where }),
  ]);

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getAction(
  context: UserContext,
  actionId: string,
): Promise<CorrectiveActionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.view");

  const row = assertFound(
    await prisma.correctiveAction.findFirst({
      where: { AND: [buildCorrectiveActionScopeWhere(context), { id: actionId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy] = await Promise.all([
    loadMembers([row.assignedToMemberId, row.completedByMemberId, row.verifiedByMemberId]),
    loadMemberRef(row.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(row, members),
    description: row.description,
    completionNote: row.completionNote,
    completedBy: row.completedByMemberId ? (members.get(row.completedByMemberId) ?? null) : null,
    completedAt: dateString(row.completedAt),
    verificationNote: row.verificationNote,
    verifiedBy: row.verifiedByMemberId ? (members.get(row.verifiedByMemberId) ?? null) : null,
    verifiedAt: dateString(row.verifiedAt),
    cancelledAt: dateString(row.cancelledAt),
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row),
  };
}

/** The actions raised against one parent record (PRD #21 §141). */
export async function listForParent(
  context: UserContext,
  parent: { ncrId?: string; defectId?: string; inspectionId?: string },
): Promise<CorrectiveActionSummaryDTO[]> {
  if (!can(context, "qaqc.corrective_action.view")) return [];

  const rows = await prisma.correctiveAction.findMany({
    where: {
      AND: [
        buildCorrectiveActionScopeWhere(context),
        parent.ncrId
          ? { ncrId: parent.ncrId }
          : parent.defectId
            ? { defectId: parent.defectId }
            : { inspectionId: parent.inspectionId },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function listForProject(
  context: UserContext,
  projectId: string,
  limit = 50,
): Promise<CorrectiveActionSummaryDTO[]> {
  if (!can(context, "qaqc.corrective_action.view")) return [];

  const rows = await prisma.correctiveAction.findMany({
    where: { AND: [buildCorrectiveActionScopeWhere(context), { projectId }] },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.assignedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

export async function actionFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members] = await Promise.all([
    prisma.project.findMany({
      where: buildQaqcProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildQaqcMemberWhere(context),
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
  input: CorrectiveActionInput,
): Promise<CorrectiveActionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.create");

  const assignee = await requireMember(context, input.assignedToMemberId);
  const parent = await requireParent(context, input);

  const id = await prisma.$transaction(async (tx) => {
    const actionNumber = await nextQualityNumber(tx, "correctiveAction", context.companyId);

    const action = await tx.correctiveAction.create({
      data: {
        companyId: context.companyId,
        actionNumber,
        title: input.title,
        description: input.description,
        ncrId: input.ncrId ?? null,
        defectId: input.defectId ?? null,
        inspectionId: input.inspectionId ?? null,
        // Inherited from the parent when the form did not say, so an action on
        // a project NCR is reachable by the people on that project.
        projectId: input.projectId ?? parent.projectId,
        assignedToMemberId: assignee.id,
        dueDate: input.dueDate ?? null,
        status: "OPEN",
        createdByMemberId: context.membershipId,
      },
      select: { id: true, actionNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: action.id,
      action: "QAQC_ACTION_CREATED",
      message: `raised corrective action ${action.actionNumber}`,
    });

    await enqueueNotificationEvent(tx, {
      companyId: context.companyId,
      eventType: NotificationEvent.QA_ACTION_ASSIGNED,
      moduleKey: MODULE,
      entityType: "corrective_action",
      entityId: action.id,
      actorMemberId: context.membershipId,
      projectId: input.projectId ?? parent.projectId,
      payload: { assigneeMemberId: assignee.id, actionNumber: action.actionNumber, title: input.title, assignmentVersion: new Date().toISOString() },
    });

    return action.id;
  });

  return getAction(context, id);
}

export async function updateAction(
  context: UserContext,
  actionId: string,
  input: CorrectiveActionInput,
): Promise<CorrectiveActionDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.update");

  const existing = await requireAction(context, actionId);

  if (!isActionEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A verified action cannot be edited.", {
      code: "ACTION_VERIFIED",
    });
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const assignee = await requireMember(context, input.assignedToMemberId);
  const parent = await requireParent(context, input);

  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
      where: { id: actionId },
      data: {
        title: input.title,
        description: input.description,
        ncrId: input.ncrId ?? null,
        defectId: input.defectId ?? null,
        inspectionId: input.inspectionId ?? null,
        projectId: input.projectId ?? parent.projectId,
        assignedToMemberId: assignee.id,
        dueDate: input.dueDate ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    if (assignee.id !== existing.assignedToMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.QA_ACTION_ASSIGNED,
        moduleKey: MODULE,
        entityType: "corrective_action",
        entityId: actionId,
        actorMemberId: context.membershipId,
        payload: { assigneeMemberId: assignee.id, actionNumber: existing.actionNumber, title: null, assignmentVersion: new Date().toISOString() },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "QAQC_ACTION_UPDATED",
      message: `updated corrective action ${existing.actionNumber}`,
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
  assertPermission(context, "qaqc.corrective_action.assign");

  const existing = await requireAction(context, actionId);

  if (!isActionEditable(existing.status)) {
    throw new AccessError("CONFLICT", "A verified action cannot be reassigned.", {
      code: "ACTION_VERIFIED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
      where: { id: actionId },
      data: {
        assignedToMemberId: member.id,
        status: existing.status === "OPEN" ? "IN_PROGRESS" : existing.status,
        updatedByMemberId: context.membershipId,
      },
    });

    if (member.id !== existing.assignedToMemberId) {
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.QA_ACTION_ASSIGNED,
        moduleKey: MODULE,
        entityType: "corrective_action",
        entityId: actionId,
        actorMemberId: context.membershipId,
        payload: { assigneeMemberId: member.id, actionNumber: existing.actionNumber, title: null, assignmentVersion: new Date().toISOString() },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "QAQC_ACTION_ASSIGNED",
      message: `assigned corrective action ${existing.actionNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

/** Whoever did the work says what they did (PRD #21 §146). */
export async function completeAction(
  context: UserContext,
  actionId: string,
  completionNote: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.complete");

  const existing = await requireAction(context, actionId);

  if (!isActionCompletable(existing.status)) {
    throw new AccessError("CONFLICT", "This action is not open.", { code: "NOT_OPEN" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
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
      action: "QAQC_ACTION_COMPLETED",
      message: `completed corrective action ${existing.actionNumber}`,
    });
  });
}

/**
 * Somebody else confirms the fix holds (PRD #21 §147).
 *
 * The person who completed it may not verify it. Without that rule a corrective
 * action is somebody marking their own homework, and an NCR closed on the back
 * of it would mean nothing.
 */
export async function verifyAction(
  context: UserContext,
  actionId: string,
  verificationNote: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.verify");

  const existing = assertFound(
    await prisma.correctiveAction.findFirst({
      where: { AND: [buildCorrectiveActionScopeWhere(context), { id: actionId }] },
      select: { id: true, actionNumber: true, status: true, completedByMemberId: true, ncrId: true },
    }),
  );

  if (!isActionVerifiable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An action is verified once somebody has recorded that it is done.",
      { code: "NOT_COMPLETED" },
    );
  }

  if (
    existing.completedByMemberId === context.membershipId &&
    !can(context, "qaqc.approval.self")
  ) {
    throw new AccessError(
      "FORBIDDEN",
      "You completed this action, so somebody else has to verify it.",
      { code: "SELF_VERIFY" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
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
      action: "QAQC_ACTION_VERIFIED",
      message: `verified corrective action ${existing.actionNumber}`,
    });
  });
}

/** Rejecting a completion sends it back to whoever owns it (PRD #21 §148). */
export async function rejectAction(
  context: UserContext,
  actionId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.verify");

  const existing = await requireAction(context, actionId);

  if (!isActionVerifiable(existing.status)) {
    throw new AccessError("CONFLICT", "This action is not waiting for verification.", {
      code: "NOT_COMPLETED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
      where: { id: actionId },
      data: { status: "REJECTED", updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "QAQC_ACTION_REJECTED",
      message: `rejected the completion of ${existing.actionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

export async function reopenAction(
  context: UserContext,
  actionId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.reopen");

  const existing = await requireAction(context, actionId);

  if (!isActionReopenable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a verified action can be reopened.", {
      code: "NOT_VERIFIED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
      where: { id: actionId },
      data: { status: "REOPENED", updatedByMemberId: context.membershipId },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "QAQC_ACTION_REOPENED",
      message: `reopened corrective action ${existing.actionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelAction(
  context: UserContext,
  actionId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.corrective_action.cancel");

  const existing = await requireAction(context, actionId);

  if (!isActionCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "A verified action cannot be cancelled.", {
      code: "ACTION_VERIFIED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.correctiveAction.update({
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
      action: "QAQC_ACTION_CANCELLED",
      message: `cancelled corrective action ${existing.actionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * A task on a corrective action (PRD #21 §151, §152, §153).
 *
 * The canonical Task, not a quality-specific one. The two are not the same
 * thing and neither replaces the other: the corrective action is the formal
 * record of what fixes the non-conformance and must be verified before the NCR
 * closes; the task is somebody's to-do list entry for a piece of that work
 * (§153).
 */
export async function createActionTask(
  context: UserContext,
  actionId: string,
  input: { title: string; description?: string; assigneeMemberId?: string; dueDate?: Date },
): Promise<{ id: string }> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.task.create");

  const action = assertFound(
    await prisma.correctiveAction.findFirst({
      where: { AND: [buildCorrectiveActionScopeWhere(context), { id: actionId }] },
      select: { id: true, actionNumber: true, projectId: true },
    }),
  );

  const tasks = await import("@/lib/modules/tasks/task.service");

  const task = await tasks.createTask(
    context,
    {
      title: input.title,
      description: input.description,
      projectId: action.projectId ?? undefined,
      assigneeMemberId: input.assigneeMemberId,
      startDate: undefined,
      dueDate: input.dueDate,
      status: "TODO",
      priority: "MEDIUM",
    },
    { moduleKey: MODULE, entityType: "corrective_action", entityId: actionId },
  );

  await prisma.$transaction(async (tx) => {
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: actionId,
      action: "QAQC_ACTION_TASK_CREATED",
      message: `raised a task on ${action.actionNumber}`,
      metadata: { taskId: task.id } as Prisma.InputJsonValue,
    });

    // The task is the canonical Task, owned by the Tasks module; this records
    // which corrective action it came from, so completing the task never looks
    // like the action verifying itself (PRD #23 §21, §94).
    await linkIntegration(tx, context, {
      integrationType: IntegrationType.QA_ACTION_TASK,
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

async function requireAction(context: UserContext, actionId: string) {
  return assertFound(
    await prisma.correctiveAction.findFirst({
      where: { AND: [buildCorrectiveActionScopeWhere(context), { id: actionId }] },
      select: { id: true, actionNumber: true, status: true, assignedToMemberId: true, updatedAt: true, ncrId: true },
    }),
  );
}

/**
 * The record this action is being raised against (PRD #21 §221).
 *
 * Resolved through the reader's own scope for that record type, so an action
 * cannot be used to confirm that an NCR on somebody else's project exists.
 */
async function requireParent(
  context: UserContext,
  input: { ncrId?: string; defectId?: string; inspectionId?: string },
): Promise<{ projectId: string | null }> {
  if (input.ncrId) {
    const { buildNcrScopeWhere } = await import("../qaqc.scope");
    const ncr = await prisma.nonConformanceReport.findFirst({
      where: { AND: [buildNcrScopeWhere(context), { id: input.ncrId }] },
      select: { projectId: true },
    });
    if (!ncr) throw invalidParent();
    return { projectId: ncr.projectId };
  }

  if (input.defectId) {
    const { buildDefectScopeWhere } = await import("../qaqc.scope");
    const defect = await prisma.qualityDefect.findFirst({
      where: { AND: [buildDefectScopeWhere(context), { id: input.defectId }] },
      select: { projectId: true },
    });
    if (!defect) throw invalidParent();
    return { projectId: defect.projectId };
  }

  if (input.inspectionId) {
    const { buildInspectionScopeWhere } = await import("../qaqc.scope");
    const inspection = await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: input.inspectionId }] },
      select: { projectId: true },
    });
    if (!inspection) throw invalidParent();
    return { projectId: inspection.projectId };
  }

  throw new AccessError(
    "VALIDATION_ERROR",
    "A corrective action has to hang off an NCR, a defect or an inspection.",
    { code: "PARENT_REQUIRED" },
  );
}

function invalidParent(): AccessError {
  return new AccessError("VALIDATION_ERROR", "That record does not exist.", {
    code: "INVALID_PARENT",
  });
}

async function requireMember(context: UserContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildQaqcMemberWhere(context), { id: memberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That person is not an active member.", {
      code: "INVALID_MEMBER",
    });
  }

  return member;
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

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): CorrectiveActionSummaryDTO {
  const open = OPEN_STATUSES.includes(row.status);

  const parent = row.ncr
    ? { kind: "NCR" as const, id: row.ncr.id, label: row.ncr.ncrNumber }
    : row.defect
      ? { kind: "DEFECT" as const, id: row.defect.id, label: row.defect.defectNumber }
      : row.inspection
        ? {
            kind: "INSPECTION" as const,
            id: row.inspection.id,
            label: row.inspection.inspectionNumber,
          }
        : null;

  return {
    id: row.id,
    actionNumber: row.actionNumber,
    title: row.title,
    status: row.status,
    project: toProjectRef(row.project),
    assignedTo: members.get(row.assignedToMemberId) ?? null,
    dueDate: dateString(row.dueDate),
    overdue: isOverdue(row.dueDate, open),
    parent,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: DetailRow) {
  return {
    canEdit: isActionEditable(row.status) && can(context, "qaqc.corrective_action.update"),
    canAssign: isActionEditable(row.status) && can(context, "qaqc.corrective_action.assign"),
    canComplete:
      isActionCompletable(row.status) && can(context, "qaqc.corrective_action.complete"),
    canVerify:
      isActionVerifiable(row.status) &&
      can(context, "qaqc.corrective_action.verify") &&
      (row.completedByMemberId !== context.membershipId ||
        can(context, "qaqc.approval.self")),
    canReopen: isActionReopenable(row.status) && can(context, "qaqc.corrective_action.reopen"),
    canCancel: isActionCancellable(row.status) && can(context, "qaqc.corrective_action.cancel"),
    canViewDocuments: can(context, "qaqc.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "qaqc.activity.view"),
    canCreateTask:
      isActionEditable(row.status) &&
      can(context, "qaqc.task.create") &&
      can(context, "task.create"),
  };
}
