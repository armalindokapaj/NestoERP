import { Prisma } from "@prisma/client";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { businessInstant } from "./planning.dates";
import { MODULE, PHASE_ACTIVITY_ENTITY, planningOpen, readablePhaseWhere } from "./planning.permissions";
import type { CreatePhaseInput, UpdatePhaseInput } from "./planning.schema";
import { assertAssignable, assertWritable, fail, loadPlanningProject, PROJECT_SELECT } from "./planning.service";

/**
 * Phases: the plan's structure (PRD #44 §9-§11, §25-§28, §114, §187, §271, §283).
 *
 * A phase is ordered, dated, owned and progressed by hand — the completed share
 * of its milestones is offered beside its progress, never written into it. A
 * phase that still holds live milestones is not archived; nothing is deleted.
 */

const at = (date: string | null) => (date ? businessInstant(date) : null);

function phaseData(input: CreatePhaseInput) {
  return {
    name: input.name,
    description: input.description,
    status: input.status,
    progressPercent: input.progressPercent === null ? null : new Prisma.Decimal(input.progressPercent),
    ownerMemberId: input.ownerMemberId,
    plannedStartDate: at(input.plannedStartDate),
    plannedEndDate: at(input.plannedEndDate),
    forecastStartDate: at(input.forecastStartDate),
    forecastEndDate: at(input.forecastEndDate),
    actualStartDate: at(input.actualStartDate),
    actualEndDate: at(input.actualEndDate),
  };
}

export async function findReadablePhase(context: UserContext, phaseId: string) {
  assertModule(context, MODULE);
  if (!planningOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open project plans.");
  const phase = await prisma.projectPhase.findFirst({ where: { AND: [readablePhaseWhere(context), { id: phaseId }] }, include: { project: { select: PROJECT_SELECT } } });
  if (!phase) throw fail("PHASE_NOT_FOUND", "That phase could not be found.", "NOT_FOUND");
  return phase;
}

export async function createPhase(context: UserContext, projectId: string, input: CreatePhaseInput): Promise<{ id: string; version: number }> {
  const project = await loadPlanningProject(context, projectId);
  assertPermission(context, "project_planning.phase.create");
  assertWritable(project);
  await assertAssignable(context.companyId, project.id, input.ownerMemberId);
  const last = await prisma.projectPhase.aggregate({ where: { companyId: context.companyId, projectId: project.id, archivedAt: null }, _max: { sortOrder: true } });
  return prisma.$transaction(async (tx) => {
    const phase = await tx.projectPhase.create({
      data: { ...phaseData(input), companyId: context.companyId, projectId: project.id, sortOrder: (last._max.sortOrder ?? 0) + 1, createdByMemberId: context.membershipId },
      select: { id: true, version: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: PHASE_ACTIVITY_ENTITY, entityId: phase.id, action: "PHASE_CREATED", message: `added the ${input.name} phase` });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_PHASE_CREATED, entity: { type: "project", id: project.id, label: project.name }, projectId: project.id, after: { phaseId: phase.id, name: input.name, status: input.status } }, { tx });
    return phase;
  });
}

export async function updatePhase(context: UserContext, phaseId: string, input: UpdatePhaseInput): Promise<{ version: number }> {
  const phase = await findReadablePhase(context, phaseId);
  assertPermission(context, "project_planning.phase.edit");
  assertWritable(phase.project);
  if (phase.archivedAt) throw fail("PHASE_ARCHIVED", "That phase is archived.", "CONFLICT");
  if (input.ownerMemberId !== phase.ownerMemberId) await assertAssignable(context.companyId, phase.projectId, input.ownerMemberId);
  const { expectedVersion, ...rest } = input;
  return prisma.$transaction(async (tx) => {
    const moved = await tx.projectPhase.updateMany({ where: { id: phase.id, version: expectedVersion, archivedAt: null }, data: { ...phaseData(rest), version: { increment: 1 } } });
    if (!moved.count) throw fail("PLANNING_STALE", "This phase changed since you opened it. Reload to see the latest.", "CONFLICT");
    const progress = rest.progressPercent;
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_PHASE_UPDATED,
        entity: { type: "project", id: phase.projectId, label: phase.project.name },
        projectId: phase.projectId,
        before: { phaseId: phase.id, name: phase.name, status: phase.status, progressPercent: phase.progressPercent?.toString() ?? null },
        after: { phaseId: phase.id, name: rest.name, status: rest.status, progressPercent: progress === null ? null : String(progress) },
      },
      { tx },
    );
    return { version: expectedVersion + 1 };
  });
}

/** Archive, never delete: and only once its milestones have moved on (§187, §271, §272). */
export async function archivePhase(context: UserContext, phaseId: string): Promise<void> {
  const phase = await findReadablePhase(context, phaseId);
  assertPermission(context, "project_planning.phase.archive");
  assertWritable(phase.project);
  if (phase.archivedAt) return;
  const live = await prisma.projectMilestone.count({ where: { phaseId: phase.id, archivedAt: null } });
  if (live) throw fail("PHASE_HAS_MILESTONES", `Move or archive this phase's ${live} ${live === 1 ? "milestone" : "milestones"} first.`, "CONFLICT", { milestones: live });
  await prisma.$transaction(async (tx) => {
    await tx.projectPhase.update({ where: { id: phase.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
    await recordActivity(tx, context, { module: MODULE, entityType: PHASE_ACTIVITY_ENTITY, entityId: phase.id, action: "PHASE_ARCHIVED", message: `archived the ${phase.name} phase` });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_PHASE_ARCHIVED, entity: { type: "project", id: phase.projectId, label: phase.project.name }, projectId: phase.projectId, after: { phaseId: phase.id, name: phase.name } }, { tx });
  });
}

/** The whole order at once, so two reorders never interleave into nonsense (§26). */
export async function reorderPhases(context: UserContext, projectId: string, ids: string[]): Promise<void> {
  const project = await loadPlanningProject(context, projectId);
  assertPermission(context, "project_planning.phase.edit");
  assertWritable(project);
  const phases = await prisma.projectPhase.findMany({ where: { companyId: context.companyId, projectId: project.id, archivedAt: null }, select: { id: true } });
  const current = new Set(phases.map((phase) => phase.id));
  if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) throw fail("PLANNING_REORDER_MISMATCH", "The plan changed since you opened it. Reload and try again.", "CONFLICT");
  await prisma.$transaction(ids.map((id, index) => prisma.projectPhase.update({ where: { id }, data: { sortOrder: index + 1 } })));
}
