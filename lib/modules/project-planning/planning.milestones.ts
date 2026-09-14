import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { subscribeStakeholders } from "@/lib/core/collaboration/collaboration.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { executiveMemberIds, notifyMilestone, PLANNING_CONDITIONS, settleMilestoneAttention, type MilestoneRef } from "./planning.attention";
import { businessInstant, dateLabel, dateOf } from "./planning.dates";
import { ACTIVITY_ENTITY, baselineMovable, MODULE, RECORD } from "./planning.permissions";
import type { CreateMilestoneInput, QuickUpdateInput, UpdateMilestoneInput } from "./planning.schema";
import { resolvePlanningSettings } from "./planning.settings";
import { assertAssignable, assertWritable, fail, findReadableMilestone, loadPlanningProject, planningToday, type ReadableMilestone } from "./planning.service";
import { STATUS_LABELS, type MilestoneStatus } from "./planning.types";

/**
 * Milestones: creating, editing, completing, reopening and re-baselining
 * (PRD #44 §12-§31, §43, §47, §141-§146, §188-§190, §196, §200-§209, §247, §248).
 *
 * Baseline, forecast and actual are kept apart: an edit moves the plan and the
 * forecast, completion sets the actual date, and only the baseline command —
 * with its own grant, a reason and an audit entry — moves the baseline. Every
 * write names the version it was based on. Completing a milestone never
 * touches its tasks.
 */

type Tx = Prisma.TransactionClient;

const at = (date: string | null) => (date ? businessInstant(date) : null);
const progressOf = (value: number | null) => (value === null ? null : new Prisma.Decimal(value));

function refOf(row: Pick<ReadableMilestone, "id" | "companyId" | "projectId" | "name" | "ownerMemberId" | "critical" | "externallyCommitted">): MilestoneRef {
  return { id: row.id, companyId: row.companyId, projectId: row.projectId, name: row.name, ownerMemberId: row.ownerMemberId, critical: row.critical, externallyCommitted: row.externallyCommitted };
}

async function bump(tx: Tx, id: string, expectedVersion: number, data: Prisma.ProjectMilestoneUpdateManyMutationInput & { phaseId?: string | null }) {
  const moved = await tx.projectMilestone.updateMany({ where: { id, version: expectedVersion, archivedAt: null }, data: { ...data, version: { increment: 1 } } });
  if (!moved.count) throw fail("PLANNING_STALE", "This milestone changed since you opened it. Reload to see the latest.", "CONFLICT");
  return expectedVersion + 1;
}

async function assertPhase(companyId: string, projectId: string, phaseId: string | null) {
  if (!phaseId) return;
  const found = await prisma.projectPhase.count({ where: { id: phaseId, companyId, projectId, archivedAt: null } });
  if (!found) throw fail("PLANNING_PHASE_INVALID", "That phase is not part of this project's plan.", "VALIDATION_ERROR", { field: "phaseId" });
}

function assertLive(row: ReadableMilestone) {
  assertWritable(row.project);
  if (row.archivedAt) throw fail("MILESTONE_ARCHIVED", "That milestone is archived.", "CONFLICT");
}

async function nextSortOrder(companyId: string, projectId: string, phaseId: string | null) {
  const last = await prisma.projectMilestone.aggregate({ where: { companyId, projectId, phaseId, archivedAt: null }, _max: { sortOrder: true } });
  return (last._max.sortOrder ?? 0) + 1;
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export async function createMilestone(context: UserContext, projectId: string, input: CreateMilestoneInput): Promise<{ id: string; version: number }> {
  const project = await loadPlanningProject(context, projectId);
  assertPermission(context, "project_planning.milestone.create");
  assertWritable(project);
  // A baseline typed in at creation is still a baseline: it needs the grant (§22).
  if (input.baselineDate && !can(context, "project_planning.baseline.manage")) throw new AccessError("FORBIDDEN", "You cannot set a milestone's baseline.", { code: "MILESTONE_BASELINE_FORBIDDEN" });
  await Promise.all([assertPhase(context.companyId, project.id, input.phaseId), assertAssignable(context.companyId, project.id, input.ownerMemberId)]);

  const plannedDate = input.plannedDate;
  const forecastDate = input.forecastDate ?? plannedDate; // §142
  const baselineDate = input.baselineDate ?? plannedDate; // §143
  const sortOrder = await nextSortOrder(context.companyId, project.id, input.phaseId);

  const created = await prisma.$transaction(async (tx) => {
    const milestone = await tx.projectMilestone.create({
      data: {
        companyId: context.companyId,
        projectId: project.id,
        phaseId: input.phaseId,
        name: input.name,
        description: input.description,
        milestoneType: input.milestoneType,
        ownerMemberId: input.ownerMemberId,
        baselineDate: at(baselineDate),
        plannedDate: at(plannedDate),
        forecastDate: at(forecastDate),
        progressPercent: progressOf(input.progressPercent),
        critical: input.critical,
        externallyCommitted: input.externallyCommitted,
        sortOrder,
        statusChangedAt: new Date(),
        createdByMemberId: context.membershipId,
      },
      select: { id: true, version: true, companyId: true, projectId: true, name: true, ownerMemberId: true, critical: true, externallyCommitted: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: milestone.id, action: "MILESTONE_CREATED", message: `added the milestone ${input.name}` });
    await recordUserAction(
      context,
      { actionKey: AuditAction.PROJECT_MILESTONE_CREATED, entity: { type: RECORD, id: milestone.id, label: input.name }, projectId: project.id, after: { name: input.name, phaseId: input.phaseId, milestoneType: input.milestoneType, ownerMemberId: input.ownerMemberId, baselineDate, plannedDate, forecastDate, critical: input.critical, externallyCommitted: input.externallyCommitted } },
      { tx },
    );
    if (input.ownerMemberId && input.ownerMemberId !== context.membershipId) {
      await notifyMilestone(tx, { eventType: NotificationEvent.MILESTONE_ASSIGNED, milestone, projectName: project.name, actorMemberId: context.membershipId, memberIds: [input.ownerMemberId], payload: { actorName: context.fullName, assignment: `${milestone.id}:${input.ownerMemberId}:1` } });
    }
    return milestone;
  });
  await subscribeStakeholders({ companyId: context.companyId, parentType: RECORD, parentId: created.id, memberIds: [context.membershipId, ...(input.ownerMemberId ? [input.ownerMemberId] : []), ...(project.projectManagerMemberId ? [project.projectManagerMemberId] : [])] });
  incrementCounter(Metric.MILESTONE_CREATE_SUCCESS);
  return { id: created.id, version: created.version };
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */

const NOTABLE_STATUSES: readonly MilestoneStatus[] = ["AT_RISK", "DELAYED", "ON_HOLD", "CANCELLED"];

export async function updateMilestone(context: UserContext, milestoneId: string, input: UpdateMilestoneInput): Promise<{ version: number }> {
  const row = await findReadableMilestone(context, milestoneId);
  assertPermission(context, "project_planning.milestone.edit");
  assertLive(row);
  if (input.status === "COMPLETED" && row.status !== "COMPLETED") throw fail("MILESTONE_COMPLETE_REQUIRED", "Use Mark complete to complete a milestone.", "VALIDATION_ERROR", { field: "status" });
  if (row.status === "COMPLETED" && input.status !== "COMPLETED") throw fail("MILESTONE_REOPEN_REQUIRED", "Reopen the milestone, with a reason, before changing its status.", "VALIDATION_ERROR", { field: "status" });

  const before = { name: row.name, status: row.status, phaseId: row.phaseId, ownerMemberId: row.ownerMemberId, plannedDate: dateOf(row.plannedDate), forecastDate: dateOf(row.forecastDate), actualDate: dateOf(row.actualDate), progressPercent: row.progressPercent?.toString() ?? null, critical: row.critical, externallyCommitted: row.externallyCommitted };
  // The actual date is what happened: only a completed milestone has one, corrected by someone who may complete (§200).
  let actualDate = before.actualDate;
  if (input.actualDate !== before.actualDate && input.actualDate !== null) {
    if (row.status !== "COMPLETED") throw fail("MILESTONE_ACTUAL_NOT_ALLOWED", "Only a completed milestone has an actual date.", "VALIDATION_ERROR", { field: "actualDate" });
    assertPermission(context, "project_planning.milestone.complete");
    actualDate = input.actualDate;
  }
  if (input.phaseId !== row.phaseId) await assertPhase(context.companyId, row.projectId, input.phaseId);
  if (input.ownerMemberId !== row.ownerMemberId) await assertAssignable(context.companyId, row.projectId, input.ownerMemberId);

  const after = { name: input.name, status: input.status, phaseId: input.phaseId, ownerMemberId: input.ownerMemberId, plannedDate: input.plannedDate, forecastDate: input.forecastDate, actualDate, progressPercent: input.progressPercent === null ? null : String(input.progressPercent), critical: input.critical, externallyCommitted: input.externallyCommitted };
  const statusChanged = before.status !== after.status;
  const forecastChanged = before.forecastDate !== after.forecastDate;
  const ownerChanged = before.ownerMemberId !== after.ownerMemberId;
  const sortOrder = input.phaseId !== row.phaseId ? await nextSortOrder(context.companyId, row.projectId, input.phaseId) : undefined;

  const version = await prisma.$transaction(async (tx) => {
    const next = await bump(tx, row.id, input.expectedVersion, {
      name: input.name,
      description: input.description,
      phaseId: input.phaseId,
      milestoneType: input.milestoneType,
      status: input.status,
      ownerMemberId: input.ownerMemberId,
      plannedDate: at(input.plannedDate),
      forecastDate: at(input.forecastDate),
      actualDate: at(actualDate),
      progressPercent: progressOf(input.progressPercent),
      critical: input.critical,
      externallyCommitted: input.externallyCommitted,
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      ...(statusChanged ? { statusChangedAt: new Date() } : {}),
    });
    // Activity is for what people need to know later, not every nudge of the progress bar (§210).
    if (statusChanged && (input.status === "DELAYED" || input.status === "AT_RISK" || input.status === "CANCELLED")) {
      const action = input.status === "DELAYED" ? "MILESTONE_DELAYED" : input.status === "AT_RISK" ? "MILESTONE_AT_RISK" : "MILESTONE_CANCELLED";
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action, message: `marked ${input.name} ${STATUS_LABELS[input.status].toLowerCase()}` });
    }
    if (forecastChanged) {
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "MILESTONE_FORECAST_CHANGED", message: `moved the forecast of ${input.name} to ${dateLabel(input.forecastDate)}`, metadata: { note: input.forecastReason ?? `${dateLabel(before.forecastDate)} → ${dateLabel(input.forecastDate)}` } });
    }
    if (ownerChanged) {
      await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "MILESTONE_OWNER_CHANGED", message: `changed the owner of ${input.name}` });
    }
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_UPDATED, entity: { type: RECORD, id: row.id, label: input.name }, projectId: row.projectId, before, after, reason: input.forecastReason }, { tx });

    const ref = refOf({ ...row, name: input.name, ownerMemberId: input.ownerMemberId, critical: input.critical, externallyCommitted: input.externallyCommitted });
    if (ownerChanged && input.ownerMemberId) {
      await notifyMilestone(tx, { eventType: NotificationEvent.MILESTONE_ASSIGNED, milestone: ref, projectName: row.project.name, actorMemberId: context.membershipId, memberIds: [input.ownerMemberId], payload: { actorName: context.fullName, assignment: `${row.id}:${input.ownerMemberId}:${next}` } });
    }
    if (forecastChanged || (statusChanged && NOTABLE_STATUSES.includes(input.status))) {
      await notifyMilestone(tx, {
        eventType: NotificationEvent.MILESTONE_UPDATED,
        milestone: ref,
        projectName: row.project.name,
        actorMemberId: context.membershipId,
        memberIds: [input.ownerMemberId, row.project.projectManagerMemberId],
        payload: { actorName: context.fullName, change: forecastChanged ? `Forecast ${dateLabel(before.forecastDate)} → ${dateLabel(input.forecastDate)}` : `Now ${STATUS_LABELS[input.status]}` },
      });
    }
    return next;
  });
  await settleMilestoneAttention(context.companyId, row.id);
  if (ownerChanged && input.ownerMemberId) await subscribeStakeholders({ companyId: context.companyId, parentType: RECORD, parentId: row.id, memberIds: [input.ownerMemberId] });
  incrementCounter(Metric.MILESTONE_UPDATE_SUCCESS);
  return { version };
}

/** Status, forecast and progress from a phone, on top of everything else the milestone already says (§119, §247). */
export async function quickUpdateMilestone(context: UserContext, milestoneId: string, input: QuickUpdateInput): Promise<{ version: number }> {
  const row = await findReadableMilestone(context, milestoneId);
  return updateMilestone(context, milestoneId, {
    expectedVersion: input.expectedVersion,
    name: row.name,
    description: row.description,
    phaseId: row.phaseId,
    milestoneType: row.milestoneType,
    status: input.status ?? row.status,
    ownerMemberId: row.ownerMemberId,
    plannedDate: dateOf(row.plannedDate),
    forecastDate: input.forecastDate === undefined ? dateOf(row.forecastDate) : input.forecastDate,
    progressPercent: input.progressPercent === undefined ? (row.progressPercent === null ? null : Number(row.progressPercent)) : input.progressPercent,
    critical: row.critical,
    externallyCommitted: row.externallyCommitted,
    actualDate: dateOf(row.actualDate),
    forecastReason: input.forecastReason,
  });
}

/* -------------------------------------------------------------------------- */
/* Complete and reopen                                                         */
/* -------------------------------------------------------------------------- */

export async function completeMilestone(context: UserContext, milestoneId: string, input: { expectedVersion: number; actualDate: string | null; completionNote: string | null }): Promise<{ version: number; actualDate: string }> {
  const row = await findReadableMilestone(context, milestoneId);
  assertPermission(context, "project_planning.milestone.complete");
  assertLive(row);
  if (row.status === "COMPLETED") throw fail("MILESTONE_ALREADY_COMPLETED", "This milestone is already complete.", "CONFLICT");
  if (row.status === "CANCELLED") throw fail("MILESTONE_CANCELLED", "A cancelled milestone is not completed.", "CONFLICT");
  const { today } = await planningToday(context.companyId);
  const actualDate = input.actualDate ?? today; // §30
  if (actualDate > today) throw fail("MILESTONE_ACTUAL_FUTURE", "The actual date is when it happened, so it cannot be in the future.", "VALIDATION_ERROR", { field: "actualDate" });

  const version = await prisma.$transaction(async (tx) => {
    const next = await bump(tx, row.id, input.expectedVersion, { status: "COMPLETED", actualDate: businessInstant(actualDate), progressPercent: new Prisma.Decimal(100), completionNote: input.completionNote, completedByMemberId: context.membershipId, statusChangedAt: new Date() });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "MILESTONE_COMPLETED", message: `completed ${row.name}`, metadata: input.completionNote ? { note: input.completionNote } : undefined });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_COMPLETED, entity: { type: RECORD, id: row.id, label: row.name }, projectId: row.projectId, before: { status: row.status, actualDate: null }, after: { status: "COMPLETED", actualDate } }, { tx });
    await notifyMilestone(tx, { eventType: NotificationEvent.MILESTONE_COMPLETED, milestone: refOf(row), projectName: row.project.name, actorMemberId: context.membershipId, memberIds: [row.ownerMemberId, row.project.projectManagerMemberId], payload: { actorName: context.fullName, dateLabel: dateLabel(actualDate) } });
    return next;
  });
  await resolveAttentionForRecord(prisma, context.companyId, RECORD, row.id, [...PLANNING_CONDITIONS]);
  incrementCounter(Metric.MILESTONE_COMPLETE_SUCCESS);
  return { version, actualDate };
}

export async function reopenMilestone(context: UserContext, milestoneId: string, input: { expectedVersion: number; reason: string }): Promise<{ version: number }> {
  const row = await findReadableMilestone(context, milestoneId);
  assertPermission(context, "project_planning.milestone.reopen");
  assertLive(row);
  if (row.status !== "COMPLETED") throw fail("MILESTONE_NOT_COMPLETED", "Only a completed milestone is reopened.", "CONFLICT");
  const version = await prisma.$transaction(async (tx) => {
    const next = await bump(tx, row.id, input.expectedVersion, { status: "IN_PROGRESS", actualDate: null, completedByMemberId: null, reopenedAt: new Date(), statusChangedAt: new Date() });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "MILESTONE_REOPENED", message: `reopened ${row.name}`, metadata: { note: input.reason } });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_REOPENED, entity: { type: RECORD, id: row.id, label: row.name }, projectId: row.projectId, before: { status: "COMPLETED", actualDate: dateOf(row.actualDate) }, after: { status: "IN_PROGRESS", actualDate: null }, reason: input.reason }, { tx });
    await notifyMilestone(tx, { eventType: NotificationEvent.MILESTONE_UPDATED, milestone: refOf(row), projectName: row.project.name, actorMemberId: context.membershipId, memberIds: [row.ownerMemberId, row.project.projectManagerMemberId], payload: { actorName: context.fullName, change: `Reopened: ${input.reason.slice(0, 200)}` } });
    return next;
  });
  await settleMilestoneAttention(context.companyId, row.id);
  return { version };
}

/* -------------------------------------------------------------------------- */
/* Baseline                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Moves the approved reference date (§16, §21-§23, §76, §196, §202, §209).
 * The first baseline is set with the grant alone; every later change also
 * needs a reason when the company requires one, and a locked baseline moves
 * only with the planning authority.
 */
export async function changeBaseline(context: UserContext, milestoneId: string, input: { expectedVersion: number; newBaselineDate: string; reason: string | null }): Promise<{ version: number }> {
  const row = await findReadableMilestone(context, milestoneId);
  assertPermission(context, "project_planning.baseline.manage");
  assertLive(row);
  if (!baselineMovable(context, { baselineLocked: row.project.planningBaselineLocked })) throw new AccessError("FORBIDDEN", "This project's baseline is locked.", { code: "MILESTONE_BASELINE_LOCKED" });
  const settings = await resolvePlanningSettings(context.companyId);
  const previous = dateOf(row.baselineDate);
  if (previous === input.newBaselineDate) return { version: row.version };
  if (previous && settings.baselineChangeReasonRequired && !input.reason) throw fail("MILESTONE_BASELINE_REASON_REQUIRED", "Say why the baseline is changing.", "VALIDATION_ERROR", { field: "reason" });

  const executives = settings.notifyExecutivesOnCriticalChanges && row.critical && row.externallyCommitted ? await executiveMemberIds(prisma, context.companyId) : [];
  const version = await prisma.$transaction(async (tx) => {
    const next = await bump(tx, row.id, input.expectedVersion, { baselineDate: businessInstant(input.newBaselineDate) });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "MILESTONE_BASELINE_CHANGED", message: previous ? `changed the baseline of ${row.name} from ${dateLabel(previous)} to ${dateLabel(input.newBaselineDate)}` : `set the baseline of ${row.name} to ${dateLabel(input.newBaselineDate)}`, metadata: input.reason ? { note: input.reason } : undefined });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_BASELINE_CHANGED, entity: { type: RECORD, id: row.id, label: row.name }, projectId: row.projectId, before: { baselineDate: previous }, after: { baselineDate: input.newBaselineDate }, reason: input.reason }, { tx });
    await notifyMilestone(tx, {
      eventType: NotificationEvent.BASELINE_CHANGED,
      milestone: refOf(row),
      projectName: row.project.name,
      actorMemberId: context.membershipId,
      memberIds: [row.project.projectManagerMemberId, row.ownerMemberId, ...executives],
      payload: { actorName: context.fullName, change: `${dateLabel(previous)} → ${dateLabel(input.newBaselineDate)}`, reason: input.reason ?? "" },
    });
    return next;
  });
  return { version };
}

/** Freezing a project's baseline is the baseline holder's call; thawing it is the planning authority's (§76, §310). */
export async function setBaselineLock(context: UserContext, projectId: string, locked: boolean): Promise<{ baselineLocked: boolean }> {
  const project = await loadPlanningProject(context, projectId);
  assertWritable(project);
  assertPermission(context, locked ? "project_planning.baseline.manage" : "project_planning.settings.manage");
  if (project.planningBaselineLocked === locked) return { baselineLocked: locked };
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: project.id }, data: { planningBaselineLocked: locked } });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_PLANNING_BASELINE_LOCK_CHANGED, entity: { type: "project", id: project.id, label: project.name }, projectId: project.id, before: { baselineLocked: !locked }, after: { baselineLocked: locked } }, { tx });
  });
  return { baselineLocked: locked };
}

/* -------------------------------------------------------------------------- */
/* Archive and order                                                           */
/* -------------------------------------------------------------------------- */

/** Archive, never delete (§188, §269, §270, §272): and not while live milestones still wait on it. */
export async function archiveMilestone(context: UserContext, milestoneId: string): Promise<void> {
  const row = await findReadableMilestone(context, milestoneId);
  assertPermission(context, "project_planning.manage");
  assertWritable(row.project);
  if (row.archivedAt) return;
  const dependents = await prisma.projectMilestoneDependency.count({ where: { predecessorMilestoneId: row.id, successor: { is: { archivedAt: null } } } });
  if (dependents) throw fail("MILESTONE_HAS_DEPENDENTS", `${dependents} ${dependents === 1 ? "milestone depends" : "milestones depend"} on this one. Remove those dependencies first.`, "CONFLICT", { dependents });
  await prisma.$transaction(async (tx) => {
    await tx.projectMilestone.update({ where: { id: row.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    await recordActivity(tx, context, { module: MODULE, entityType: ACTIVITY_ENTITY, entityId: row.id, action: "MILESTONE_ARCHIVED", message: `archived ${row.name}` });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_ARCHIVED, entity: { type: RECORD, id: row.id, label: row.name }, projectId: row.projectId, before: { status: row.status } }, { tx });
  });
  await resolveAttentionForRecord(prisma, context.companyId, RECORD, row.id, [...PLANNING_CONDITIONS]);
}

export async function reorderMilestones(context: UserContext, projectId: string, input: { phaseId: string | null; ids: string[] }): Promise<void> {
  const project = await loadPlanningProject(context, projectId);
  assertPermission(context, "project_planning.milestone.edit");
  assertWritable(project);
  const rows = await prisma.projectMilestone.findMany({ where: { companyId: context.companyId, projectId: project.id, phaseId: input.phaseId, archivedAt: null }, select: { id: true } });
  const current = new Set(rows.map((row) => row.id));
  if (input.ids.length !== current.size || new Set(input.ids).size !== input.ids.length || input.ids.some((id) => !current.has(id))) throw fail("PLANNING_REORDER_MISMATCH", "The plan changed since you opened it. Reload and try again.", "CONFLICT");
  await prisma.$transaction(input.ids.map((id, index) => prisma.projectMilestone.update({ where: { id }, data: { sortOrder: index + 1 } })));
}
