import { PLANNING_SEED, seedPlanningRecords } from "../../prisma/seed/planning";
import { seedMembers } from "../../prisma/seed/members";
import { db, removeRecordTrail } from "./db";

/**
 * Planning fixtures for E2E (PRD #44 §299-§301).
 *
 * The desktop spec builds a plan on Central Office Tower, which the seed leaves
 * empty; the phone spec updates Riverside's seeded plan. Afterwards the new
 * plan goes with everything it raised, and Riverside's plan is written back
 * exactly as the seed leaves it.
 */

export { PLANNING_SEED };

export async function removePlanning(projectIds: string[]): Promise<void> {
  const milestones = await db.projectMilestone.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
  const ids = milestones.map((row) => row.id);
  const tasks = await db.task.findMany({ where: { entityType: "project_milestone", entityId: { in: ids } }, select: { id: true } });
  const taskIds = tasks.map((row) => row.id);
  await removeRecordTrail("project_milestone", ids);
  await removeRecordTrail("task", taskIds);
  await db.integrationLink.deleteMany({ where: { integrationType: "MILESTONE_RECORD", sourceEntityId: { in: ids } } });
  await db.projectMilestoneBlocker.deleteMany({ where: { milestoneId: { in: ids } } });
  await db.projectMilestoneTaskLink.deleteMany({ where: { milestoneId: { in: ids } } });
  await db.projectMilestoneDependency.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.activity.deleteMany({ where: { entityId: { in: [...ids, ...taskIds] } } });
  await db.projectMilestone.deleteMany({ where: { id: { in: ids } } });
  await db.projectPhase.deleteMany({ where: { projectId: { in: projectIds } } });
  await db.task.deleteMany({ where: { id: { in: taskIds } } });
  await db.project.updateMany({ where: { id: { in: projectIds } }, data: { planningBaselineLocked: false, planningTemplateKey: null } });
}

/** Riverside's plan, exactly as the seed leaves it. */
export async function restoreSeededPlanning(): Promise<void> {
  const seeded = await db.projectMilestone.findMany({ where: { projectId: "project_a" }, select: { id: true } });
  const tasks = await db.task.findMany({ where: { entityType: "project_milestone", entityId: { in: seeded.map((row) => row.id) } }, select: { id: true } });
  await removeRecordTrail("project_milestone", seeded.map((row) => row.id));
  await removeRecordTrail("task", tasks.map((row) => row.id));
  await db.activity.deleteMany({ where: { entityId: { in: tasks.map((row) => row.id) } } });
  await db.projectMilestoneTaskLink.deleteMany({ where: { taskId: { in: tasks.map((row) => row.id) } } });
  await db.task.deleteMany({ where: { id: { in: tasks.map((row) => row.id) } } });
  await seedPlanningRecords(db, seedMembers());
}

export async function milestoneDate(id: string): Promise<string> {
  const row = await db.projectMilestone.findUniqueOrThrow({ where: { id }, select: { forecastDate: true, plannedDate: true } });
  return (row.forecastDate ?? row.plannedDate)!.toISOString().slice(0, 10);
}
