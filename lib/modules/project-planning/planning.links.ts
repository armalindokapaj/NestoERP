import type { z } from "zod";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertPermission } from "@/lib/access/guards";
import { buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { moduleAndPermissions, recordDefinition } from "@/lib/core/records/record.registry";
import { prisma } from "@/lib/database/prisma";
import { readableDailyLogWhere } from "@/lib/modules/daily-logs/daily-log.permissions";
import { readableMeetingWhere } from "@/lib/modules/meetings/meeting.permissions";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import { createTaskFromContext } from "@/lib/modules/tasks/task.service";
import { dateLabel, dateOf } from "./planning.dates";
import { wouldCreateCycle } from "./planning.graph";
import { RECORD, RECORD_LINK_TYPE } from "./planning.permissions";
import type { createTaskFromMilestoneSchema, linkTaskSchema } from "./planning.schema";
import { assertWritable, fail, findReadableMilestone, projectMemberOptions, type ReadableMilestone } from "./planning.service";
import { STATUS_LABELS, type Option } from "./planning.types";

/**
 * What a milestone points at (PRD #44 §49-§64, §183-§185, §193-§195, §287-§291).
 *
 * Tasks are linked, or created through the task service with the milestone as
 * their parent, and never completed from here; finishing every linked task
 * does not finish the milestone. Meetings and daily logs are referenced
 * through integration links, which change nothing on them. Each link is made
 * only to a record the writer can open, on the milestone's own project — and
 * each reader afterwards sees as much of it as their own access allows.
 */

type LinkableType = "meeting" | "daily_log";

function assertEditable(context: UserContext, milestone: ReadableMilestone) {
  assertPermission(context, "project_planning.milestone.edit");
  assertWritable(milestone.project);
  if (milestone.archivedAt) throw fail("MILESTONE_ARCHIVED", "That milestone is archived.", "CONFLICT");
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

export async function linkTask(context: UserContext, milestoneId: string, input: z.infer<typeof linkTaskSchema>): Promise<void> {
  const milestone = await findReadableMilestone(context, milestoneId);
  assertEditable(context, milestone);
  if (!canAccessModule(context, "tasks") || !can(context, "task.view")) throw new AccessError("FORBIDDEN", "You cannot link tasks.", { code: "MILESTONE_TASK_FORBIDDEN" });
  const task = await prisma.task.findFirst({ where: { AND: [buildTaskScopeWhere(context), { id: input.taskId, companyId: context.companyId }] }, select: { id: true, projectId: true, archivedAt: true } });
  if (!task) throw fail("MILESTONE_TASK_INVALID", "That task could not be found.", "VALIDATION_ERROR", { field: "taskId" });
  if (task.projectId !== milestone.projectId) throw fail("MILESTONE_TASK_PROJECT_MISMATCH", "That task belongs to another project.", "VALIDATION_ERROR", { field: "taskId" });
  await prisma.$transaction(async (tx) => {
    await tx.projectMilestoneTaskLink.upsert({
      where: { milestoneId_taskId: { milestoneId: milestone.id, taskId: task.id } },
      create: { companyId: context.companyId, milestoneId: milestone.id, taskId: task.id, linkType: input.linkType, createdByMemberId: context.membershipId },
      update: { linkType: input.linkType },
    });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_UPDATED, entity: { type: RECORD, id: milestone.id, label: milestone.name }, projectId: milestone.projectId, after: { taskId: task.id, linkType: input.linkType } }, { tx });
  });
}

export async function unlinkTask(context: UserContext, milestoneId: string, taskId: string): Promise<void> {
  const milestone = await findReadableMilestone(context, milestoneId);
  assertEditable(context, milestone);
  const removed = await prisma.projectMilestoneTaskLink.deleteMany({ where: { milestoneId: milestone.id, taskId, companyId: context.companyId } });
  if (!removed.count) throw fail("MILESTONE_LINK_NOT_FOUND", "That task is not linked to this milestone.", "NOT_FOUND");
}

/** `+ Create Task` (§55): the task service creates it with the milestone as parent, then it is linked. */
export async function createTaskFromMilestone(context: UserContext, milestoneId: string, input: z.infer<typeof createTaskFromMilestoneSchema>): Promise<{ taskId: string; href: string }> {
  const milestone = await findReadableMilestone(context, milestoneId);
  assertEditable(context, milestone);
  const task = await createTaskFromContext(context, {
    ...createTaskSchema.parse({ title: input.title, description: input.description ?? undefined, projectId: milestone.projectId, assigneeMemberId: input.assigneeMemberId ?? undefined, status: "TODO", priority: input.priority, dueDate: input.dueDate ?? undefined }),
    parentType: RECORD,
    parentId: milestone.id,
  });
  await prisma.projectMilestoneTaskLink.upsert({
    where: { milestoneId_taskId: { milestoneId: milestone.id, taskId: task.id } },
    create: { companyId: context.companyId, milestoneId: milestone.id, taskId: task.id, linkType: input.linkType, createdByMemberId: context.membershipId },
    update: { linkType: input.linkType },
  });
  return { taskId: task.id, href: `/tasks/${task.id}` };
}

/* -------------------------------------------------------------------------- */
/* Meetings and daily logs                                                     */
/* -------------------------------------------------------------------------- */

function linkDoor(context: UserContext, type: LinkableType): boolean {
  return type === "meeting"
    ? isModuleEnabled(context, "meetings") && canAccessModule(context, "meetings") && can(context, "meeting.view")
    : isModuleEnabled(context, "dailyLogs") && canAccessModule(context, "dailyLogs") && can(context, "daily_log.view");
}

export async function linkRecord(context: UserContext, milestoneId: string, type: LinkableType, recordId: string): Promise<{ linkId: string }> {
  const milestone = await findReadableMilestone(context, milestoneId);
  assertEditable(context, milestone);
  const definition = recordDefinition(type);
  // The writer must be able to open the record, and it must be on this milestone's project (§198, §199).
  const record = definition && linkDoor(context, type) && moduleAndPermissions(context, definition.moduleKey, definition.viewPermissions) ? await definition.find(context, recordId) : null;
  if (!record || record.companyId !== context.companyId) throw fail("MILESTONE_RECORD_INVALID", type === "meeting" ? "You cannot link that meeting." : "You cannot link that daily log.", "NOT_FOUND");
  if (record.projectId !== milestone.projectId) throw fail("MILESTONE_RECORD_PROJECT_MISMATCH", type === "meeting" ? "That meeting is on another project." : "That daily log is on another project.");

  return prisma.$transaction(async (tx) => {
    const key = `${milestone.id}:${type}:${recordId}`;
    const link = await tx.integrationLink.upsert({
      where: { companyId_integrationType_idempotencyKey: { companyId: context.companyId, integrationType: RECORD_LINK_TYPE, idempotencyKey: key } },
      create: {
        companyId: context.companyId, integrationType: RECORD_LINK_TYPE, mode: "REFERENCE",
        sourceModule: "projects", sourceEntityType: RECORD, sourceEntityId: milestone.id,
        targetModule: definition!.moduleKey, targetEntityType: type, targetEntityId: recordId,
        idempotencyKey: key, createdByMemberId: context.membershipId,
      },
      update: { status: "ACTIVE" },
      select: { id: true },
    });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_UPDATED, entity: { type: RECORD, id: milestone.id, label: milestone.name }, projectId: milestone.projectId, after: { linkedRecordType: type, linkedRecordId: recordId } }, { tx });
    return { linkId: link.id };
  });
}

export async function unlinkRecord(context: UserContext, milestoneId: string, linkId: string): Promise<void> {
  const milestone = await findReadableMilestone(context, milestoneId);
  assertEditable(context, milestone);
  const moved = await prisma.integrationLink.updateMany({ where: { id: linkId, companyId: context.companyId, integrationType: RECORD_LINK_TYPE, sourceEntityType: RECORD, sourceEntityId: milestone.id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
  if (!moved.count) throw fail("MILESTONE_LINK_NOT_FOUND", "That link could not be found.", "NOT_FOUND");
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

export type MilestoneOptions = {
  members: Option[];
  milestones: Array<Option & { status: string; blocked: boolean }>;
  tasks: Array<Option & { status: string; linked: boolean }>;
  meetings: Array<Option & { linked: boolean }>;
  dailyLogs: Array<Option & { linked: boolean }>;
};

/** Only what the server would accept from this writer (§159, §198, §199). */
export async function milestoneOptions(context: UserContext, milestoneId: string): Promise<MilestoneOptions> {
  const milestone = await findReadableMilestone(context, milestoneId);
  const projectId = milestone.projectId;
  const [members, milestones, edges, links, tasks, meetings, logs] = await Promise.all([
    projectMemberOptions(context.companyId, projectId),
    prisma.projectMilestone.findMany({ where: { companyId: context.companyId, projectId, archivedAt: null, id: { not: milestone.id } }, orderBy: [{ sortOrder: "asc" }], take: 1_000, select: { id: true, name: true, status: true } }),
    prisma.projectMilestoneDependency.findMany({ where: { companyId: context.companyId, projectId }, select: { predecessorMilestoneId: true, successorMilestoneId: true } }),
    prisma.integrationLink.findMany({ where: { companyId: context.companyId, integrationType: RECORD_LINK_TYPE, sourceEntityId: milestone.id, status: "ACTIVE" }, select: { targetEntityType: true, targetEntityId: true } }),
    canAccessModule(context, "tasks") && can(context, "task.view") ? prisma.task.findMany({ where: { AND: [buildTaskScopeWhere(context), { projectId, archivedAt: null }] }, orderBy: [{ status: "asc" }, { title: "asc" }], take: 200, select: { id: true, title: true, status: true } }) : [],
    linkDoor(context, "meeting") ? prisma.meeting.findMany({ where: { AND: [readableMeetingWhere(context), { projectId }] }, orderBy: { startsAt: "desc" }, take: 50, select: { id: true, title: true, startsAt: true } }) : [],
    linkDoor(context, "daily_log") ? prisma.dailyLog.findMany({ where: { AND: [readableDailyLogWhere(context), { projectId, status: { not: "VOID" } }] }, orderBy: { workDate: "desc" }, take: 60, select: { id: true, workDate: true, status: true } }) : [],
  ]);
  const linkedTasks = new Set((await prisma.projectMilestoneTaskLink.findMany({ where: { milestoneId: milestone.id }, select: { taskId: true } })).map((row) => row.taskId));
  const linked = new Set(links.map((link) => `${link.targetEntityType}:${link.targetEntityId}`));
  const existing = edges.filter((edge) => edge.successorMilestoneId === milestone.id).map((edge) => edge.predecessorMilestoneId);
  const graph = edges.map((edge) => ({ predecessorId: edge.predecessorMilestoneId, successorId: edge.successorMilestoneId }));
  return {
    members,
    // A milestone that already waits on this one cannot also come before it (§37).
    milestones: milestones.map((row) => ({ id: row.id, label: row.name, status: STATUS_LABELS[row.status], blocked: existing.includes(row.id) || wouldCreateCycle(graph, row.id, milestone.id) })),
    tasks: tasks.map((row) => ({ id: row.id, label: row.title, status: row.status, linked: linkedTasks.has(row.id) })),
    meetings: meetings.map((row) => ({ id: row.id, label: `${row.title} · ${dateLabel(row.startsAt.toISOString().slice(0, 10))}`, linked: linked.has(`meeting:${row.id}`) })),
    dailyLogs: logs.map((row) => ({ id: row.id, label: `Daily log · ${dateLabel(dateOf(row.workDate))}`, linked: linked.has(`daily_log:${row.id}`) })),
  };
}
