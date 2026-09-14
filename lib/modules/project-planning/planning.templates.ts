import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays, businessInstant, dateOf, daysBetween } from "./planning.dates";
import { planningProjectDoor } from "./planning.permissions";
import { PLANNING_TEMPLATES } from "./planning.template-catalog";
import { assertWritable, fail, loadPlanningProject } from "./planning.service";

/**
 * Starting a plan (PRD #44 §133-§140, §235, §241, §242).
 *
 * A template or another project's plan fills an empty plan: phases, milestone
 * names and types, the critical and committed flags, and the dependencies
 * between them. Never over an existing plan, never actual dates, statuses,
 * documents, meetings or logs. Planned dates follow the project's start when
 * both sides have one; the baseline is left for the project manager to set.
 */

async function assertEmpty(companyId: string, projectId: string) {
  const [phases, milestones] = await Promise.all([
    prisma.projectPhase.count({ where: { companyId, projectId, archivedAt: null } }),
    prisma.projectMilestone.count({ where: { companyId, projectId, archivedAt: null } }),
  ]);
  if (phases || milestones) throw fail("PLANNING_NOT_EMPTY", "This project already has a plan. Templates only start an empty one.", "CONFLICT");
}

export async function applyTemplate(context: UserContext, projectId: string, templateKey: string): Promise<{ phases: number; milestones: number }> {
  const project = await loadPlanningProject(context, projectId);
  assertPermission(context, "project_planning.phase.create");
  assertPermission(context, "project_planning.milestone.create");
  assertWritable(project);
  const template = PLANNING_TEMPLATES.find((entry) => entry.key === templateKey);
  if (!template) throw fail("PLANNING_TEMPLATE_UNKNOWN", "That template does not exist.");
  await assertEmpty(context.companyId, project.id);
  const start = dateOf(project.startDate);

  return prisma.$transaction(async (tx) => {
    // Checked again inside the transaction: two people applying at once get one plan (§137).
    await assertEmptyIn(tx, context.companyId, project.id);
    const ids = new Map<string, string>();
    let milestones = 0;
    for (const [phaseIndex, phase] of template.phases.entries()) {
      const created = await tx.projectPhase.create({ data: { companyId: context.companyId, projectId: project.id, name: phase.name, sortOrder: phaseIndex + 1, createdByMemberId: context.membershipId }, select: { id: true } });
      for (const [index, milestone] of phase.milestones.entries()) {
        const planned = start && milestone.offsetDays !== undefined ? addLocalDays(start, milestone.offsetDays) : null;
        const row = await tx.projectMilestone.create({
          data: {
            companyId: context.companyId, projectId: project.id, phaseId: created.id, name: milestone.name, milestoneType: milestone.type,
            critical: Boolean(milestone.critical), externallyCommitted: Boolean(milestone.committed), sortOrder: index + 1,
            plannedDate: planned ? businessInstant(planned) : null, forecastDate: planned ? businessInstant(planned) : null,
            statusChangedAt: new Date(), createdByMemberId: context.membershipId,
          },
          select: { id: true },
        });
        ids.set(milestone.key, row.id);
        milestones += 1;
      }
    }
    for (const phase of template.phases) {
      for (const milestone of phase.milestones) {
        for (const after of milestone.after ?? []) {
          const predecessor = ids.get(after);
          const successor = ids.get(milestone.key);
          if (predecessor && successor) await tx.projectMilestoneDependency.create({ data: { companyId: context.companyId, projectId: project.id, predecessorMilestoneId: predecessor, successorMilestoneId: successor, lagDays: 0, createdByMemberId: context.membershipId } });
        }
      }
    }
    await tx.project.update({ where: { id: project.id }, data: { planningTemplateKey: template.key } });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_PLANNING_TEMPLATE_APPLIED, entity: { type: "project", id: project.id, label: project.name }, projectId: project.id, after: { templateKey: template.key, phases: template.phases.length, milestones } }, { tx });
    return { phases: template.phases.length, milestones };
  }, { timeout: 30_000 });
}

async function assertEmptyIn(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], companyId: string, projectId: string) {
  const [phases, milestones] = await Promise.all([
    tx.projectPhase.count({ where: { companyId, projectId, archivedAt: null } }),
    tx.projectMilestone.count({ where: { companyId, projectId, archivedAt: null } }),
  ]);
  if (phases || milestones) throw fail("PLANNING_NOT_EMPTY", "This project already has a plan. Templates only start an empty one.", "CONFLICT");
}

/** Copies another project's structure — same company, a plan this person can open (§138, §139). */
export async function copyPlanning(context: UserContext, projectId: string, sourceProjectId: string): Promise<{ phases: number; milestones: number }> {
  const [project, source] = await Promise.all([loadPlanningProject(context, projectId), loadPlanningProject(context, sourceProjectId)]);
  assertPermission(context, "project_planning.phase.create");
  assertPermission(context, "project_planning.milestone.create");
  assertWritable(project);
  if (source.id === project.id) throw fail("PLANNING_COPY_SELF", "Choose another project to copy from.");
  await assertEmpty(context.companyId, project.id);
  const [phases, milestones, edges] = await Promise.all([
    prisma.projectPhase.findMany({ where: { companyId: context.companyId, projectId: source.id, archivedAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.projectMilestone.findMany({ where: { companyId: context.companyId, projectId: source.id, archivedAt: null, status: { not: "CANCELLED" } }, orderBy: { sortOrder: "asc" } }),
    prisma.projectMilestoneDependency.findMany({ where: { companyId: context.companyId, projectId: source.id } }),
  ]);
  if (!phases.length && !milestones.length) throw fail("PLANNING_COPY_EMPTY", "That project has no plan to copy.");
  const sourceStart = dateOf(source.startDate);
  const targetStart = dateOf(project.startDate);
  const shift = (date: Date | null) => {
    const value = dateOf(date);
    return value && sourceStart && targetStart ? businessInstant(addLocalDays(targetStart, daysBetween(sourceStart, value))) : null;
  };

  return prisma.$transaction(async (tx) => {
    await assertEmptyIn(tx, context.companyId, project.id);
    const phaseIds = new Map<string, string>();
    for (const phase of phases) {
      const created = await tx.projectPhase.create({ data: { companyId: context.companyId, projectId: project.id, name: phase.name, description: phase.description, sortOrder: phase.sortOrder, plannedStartDate: shift(phase.plannedStartDate), plannedEndDate: shift(phase.plannedEndDate), createdByMemberId: context.membershipId }, select: { id: true } });
      phaseIds.set(phase.id, created.id);
    }
    const milestoneIds = new Map<string, string>();
    for (const milestone of milestones) {
      const planned = shift(milestone.plannedDate ?? milestone.baselineDate);
      const created = await tx.projectMilestone.create({
        data: {
          companyId: context.companyId, projectId: project.id, phaseId: milestone.phaseId ? (phaseIds.get(milestone.phaseId) ?? null) : null,
          name: milestone.name, description: milestone.description, milestoneType: milestone.milestoneType, critical: milestone.critical, externallyCommitted: milestone.externallyCommitted,
          sortOrder: milestone.sortOrder, plannedDate: planned, forecastDate: planned, statusChangedAt: new Date(), createdByMemberId: context.membershipId,
        },
        select: { id: true },
      });
      milestoneIds.set(milestone.id, created.id);
    }
    for (const edge of edges) {
      const predecessor = milestoneIds.get(edge.predecessorMilestoneId);
      const successor = milestoneIds.get(edge.successorMilestoneId);
      if (predecessor && successor) await tx.projectMilestoneDependency.create({ data: { companyId: context.companyId, projectId: project.id, predecessorMilestoneId: predecessor, successorMilestoneId: successor, lagDays: edge.lagDays, createdByMemberId: context.membershipId } });
    }
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_PLANNING_COPIED, entity: { type: "project", id: project.id, label: project.name }, projectId: project.id, after: { sourceProjectId: source.id, phases: phases.length, milestones: milestones.length } }, { tx });
    return { phases: phases.length, milestones: milestones.length };
  }, { timeout: 60_000 });
}

/** Projects whose plan this person could copy into another: same company, readable, with a plan. */
export async function copyCandidates(context: UserContext, projectId: string) {
  const project = await loadPlanningProject(context, projectId);
  const door = planningProjectDoor(context);
  if (!door) return [];
  const rows = await prisma.project.findMany({
    where: { AND: [door, { id: { not: project.id }, milestones: { some: { archivedAt: null } } }] },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true, code: true },
  });
  return rows.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` }));
}
