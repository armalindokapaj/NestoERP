import type { z } from "zod";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { createTaskSchema } from "@/lib/modules/tasks/task.schema";
import { createTaskFromContext } from "@/lib/modules/tasks/task.service";
import { notifyMilestone, settleMilestoneAttention } from "./planning.attention";
import { businessInstant } from "./planning.dates";
import { ACTIVITY_ENTITY, MODULE, planningOpen, readableMilestoneWhere, RECORD } from "./planning.permissions";
import type { createBlockerSchema, resolveBlockerSchema, updateBlockerSchema } from "./planning.schema";
import { assertAssignable, assertWritable, fail, findReadableMilestone, MILESTONE_SELECT, PROJECT_SELECT } from "./planning.service";

/**
 * Blockers: known issues standing in a milestone's way (PRD #44 §40-§42,
 * §153-§157, §192, §286).
 *
 * A blocker has a severity, an owner and a due date, and is resolved rather
 * than deleted. A task raised for it is created by the task service with the
 * milestone as its trusted parent — the blocker only points at it. An open
 * critical blocker is an attention item until it is resolved.
 */

const TASK_PRIORITY = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "CRITICAL" } as const;

async function findReadableBlocker(context: UserContext, blockerId: string) {
  assertModule(context, MODULE);
  if (!planningOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open project plans.");
  const blocker = await prisma.projectMilestoneBlocker.findFirst({
    where: { id: blockerId, companyId: context.companyId, milestone: { is: readableMilestoneWhere(context) } },
    include: { milestone: { select: { ...MILESTONE_SELECT, project: { select: PROJECT_SELECT } } } },
  });
  if (!blocker) throw fail("BLOCKER_NOT_FOUND", "That blocker could not be found.", "NOT_FOUND");
  return blocker;
}

export async function createBlocker(context: UserContext, milestoneId: string, input: z.infer<typeof createBlockerSchema>): Promise<{ id: string; taskId: string | null }> {
  const milestone = await findReadableMilestone(context, milestoneId);
  assertPermission(context, "project_planning.blockers.manage");
  assertWritable(milestone.project);
  if (milestone.archivedAt) throw fail("MILESTONE_ARCHIVED", "That milestone is archived.", "CONFLICT");
  await assertAssignable(context.companyId, milestone.projectId, input.ownerMemberId);

  // The task service re-authorises everything about the task itself (§155, §233).
  const task = input.createTask
    ? await createTaskFromContext(context, {
        ...createTaskSchema.parse({ title: input.title, description: input.description ?? undefined, projectId: milestone.projectId, assigneeMemberId: input.ownerMemberId ?? undefined, status: "TODO", priority: TASK_PRIORITY[input.severity], dueDate: input.dueDate ?? undefined }),
        parentType: RECORD,
        parentId: milestone.id,
      })
    : null;

  const blocker = await prisma.$transaction(async (tx) => {
    const created = await tx.projectMilestoneBlocker.create({
      data: { companyId: context.companyId, milestoneId: milestone.id, title: input.title, description: input.description, severity: input.severity, ownerMemberId: input.ownerMemberId, dueDate: input.dueDate ? businessInstant(input.dueDate) : null, linkedTaskId: task?.id ?? null, createdByMemberId: context.membershipId },
      select: { id: true },
    });
    if (task) {
      await tx.projectMilestoneTaskLink.upsert({
        where: { milestoneId_taskId: { milestoneId: milestone.id, taskId: task.id } },
        create: { companyId: context.companyId, milestoneId: milestone.id, taskId: task.id, linkType: "BLOCKS", createdByMemberId: context.membershipId },
        update: {},
      });
    }
    if (input.severity === "CRITICAL") {
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: milestone.id, action: "MILESTONE_CRITICAL_BLOCKER", message: `added a critical blocker to ${milestone.name}`, metadata: { note: input.title } });
    }
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_BLOCKER_CREATED, entity: { type: RECORD, id: milestone.id, label: milestone.name }, projectId: milestone.projectId, after: { blockerId: created.id, severity: input.severity, ownerMemberId: input.ownerMemberId, dueDate: input.dueDate, taskId: task?.id ?? null } }, { tx });
    if (input.ownerMemberId) {
      await notifyMilestone(tx, { eventType: NotificationEvent.MILESTONE_BLOCKER_ASSIGNED, milestone, projectName: milestone.project.name, actorMemberId: context.membershipId, memberIds: [input.ownerMemberId], payload: { actorName: context.fullName, blockerTitle: input.title, severity: input.severity, blockerId: created.id } });
    }
    return created;
  });
  return { id: blocker.id, taskId: task?.id ?? null };
}

export async function updateBlocker(context: UserContext, blockerId: string, input: z.infer<typeof updateBlockerSchema>): Promise<void> {
  const blocker = await findReadableBlocker(context, blockerId);
  assertPermission(context, "project_planning.blockers.manage");
  assertWritable(blocker.milestone.project);
  if (blocker.resolvedAt) throw fail("BLOCKER_RESOLVED", "That blocker is already resolved.", "CONFLICT");
  if (input.ownerMemberId !== blocker.ownerMemberId) await assertAssignable(context.companyId, blocker.milestone.projectId, input.ownerMemberId);
  await prisma.$transaction(async (tx) => {
    await tx.projectMilestoneBlocker.update({ where: { id: blocker.id }, data: { title: input.title, description: input.description, severity: input.severity, ownerMemberId: input.ownerMemberId, dueDate: input.dueDate ? businessInstant(input.dueDate) : null } });
    if (input.severity === "CRITICAL" && blocker.severity !== "CRITICAL") {
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: blocker.milestoneId, action: "MILESTONE_CRITICAL_BLOCKER", message: `raised a blocker on ${blocker.milestone.name} to critical`, metadata: { note: input.title } });
    }
    if (input.ownerMemberId && input.ownerMemberId !== blocker.ownerMemberId) {
      await notifyMilestone(tx, { eventType: NotificationEvent.MILESTONE_BLOCKER_ASSIGNED, milestone: blocker.milestone, projectName: blocker.milestone.project.name, actorMemberId: context.membershipId, memberIds: [input.ownerMemberId], payload: { actorName: context.fullName, blockerTitle: input.title, severity: input.severity, blockerId: blocker.id } });
    }
  });
  await settleMilestoneAttention(context.companyId, blocker.milestoneId);
}

export async function resolveBlocker(context: UserContext, blockerId: string, input: z.infer<typeof resolveBlockerSchema>): Promise<void> {
  const blocker = await findReadableBlocker(context, blockerId);
  assertPermission(context, "project_planning.blockers.manage");
  assertWritable(blocker.milestone.project);
  if (blocker.resolvedAt) return;
  await prisma.$transaction(async (tx) => {
    const moved = await tx.projectMilestoneBlocker.updateMany({ where: { id: blocker.id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedByMemberId: context.membershipId, resolutionNote: input.resolutionNote } });
    if (!moved.count) return;
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: blocker.milestoneId, action: "MILESTONE_BLOCKER_RESOLVED", message: `resolved the blocker ${blocker.title}`, metadata: input.resolutionNote ? { note: input.resolutionNote } : undefined });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_BLOCKER_RESOLVED, entity: { type: RECORD, id: blocker.milestoneId, label: blocker.milestone.name }, projectId: blocker.milestone.projectId, before: { blockerId: blocker.id, severity: blocker.severity }, after: { blockerId: blocker.id, resolved: true } }, { tx });
    await notifyMilestone(tx, { eventType: NotificationEvent.MILESTONE_BLOCKER_RESOLVED, milestone: blocker.milestone, projectName: blocker.milestone.project.name, actorMemberId: context.membershipId, memberIds: [blocker.ownerMemberId, blocker.createdByMemberId, blocker.milestone.ownerMemberId], payload: { actorName: context.fullName, blockerTitle: blocker.title, blockerId: blocker.id } });
  });
  await settleMilestoneAttention(context.companyId, blocker.milestoneId);
}
