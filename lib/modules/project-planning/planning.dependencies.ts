import { Prisma } from "@prisma/client";
import type { z } from "zod";

import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { settleMilestoneAttention } from "./planning.attention";
import { wouldCreateCycle } from "./planning.graph";
import { readableMilestoneWhere, RECORD } from "./planning.permissions";
import type { dependencySchema } from "./planning.schema";
import { assertWritable, fail, findReadableMilestone } from "./planning.service";

/**
 * Finish-to-start dependencies between milestones of one project (PRD #44
 * §32-§39, §158-§163, §191, §226, §285).
 *
 * The milestone being edited is the successor; it names what it waits on.
 * Same company, same project, never itself, never twice, never in a loop — all
 * checked on the server, inside the transaction that writes the edge, so two
 * people adding opposite edges at once cannot close a cycle between them.
 * Nothing is rescheduled: a dependency adds warnings and context, not dates.
 */

export async function addDependency(context: UserContext, successorId: string, input: z.infer<typeof dependencySchema>): Promise<{ id: string }> {
  const successor = await findReadableMilestone(context, successorId);
  assertPermission(context, "project_planning.dependencies.manage");
  assertWritable(successor.project);
  if (successor.archivedAt) throw fail("MILESTONE_ARCHIVED", "That milestone is archived.", "CONFLICT");
  if (input.predecessorMilestoneId === successor.id) throw fail("DEPENDENCY_SELF", "A milestone cannot depend on itself.", "VALIDATION_ERROR", { field: "predecessorMilestoneId" });

  /*
   * Read through the writer's own plan door (§36, §226, §227, PRD #47 §50,
   * §51): a milestone from another company, or on a project they cannot open,
   * is simply not a candidate and answers like an id that does not exist. Only
   * a milestone they can already see is refused for being on another project.
   */
  const predecessor = await prisma.projectMilestone.findFirst({ where: { AND: [readableMilestoneWhere(context), { id: input.predecessorMilestoneId, archivedAt: null }] }, select: { id: true, name: true, projectId: true } });
  if (!predecessor) throw fail("DEPENDENCY_MILESTONE_INVALID", "Choose a milestone you have access to.", "VALIDATION_ERROR", { field: "predecessorMilestoneId" }, "SCOPE_DENIED");
  if (predecessor.projectId !== successor.projectId) throw fail("DEPENDENCY_CROSS_PROJECT", "Dependencies stay within one project.", "VALIDATION_ERROR", { field: "predecessorMilestoneId" }, "CROSS_PROJECT_REFERENCE");

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const edges = await tx.projectMilestoneDependency.findMany({ where: { companyId: context.companyId, projectId: successor.projectId }, select: { predecessorMilestoneId: true, successorMilestoneId: true } });
        if (edges.some((edge) => edge.predecessorMilestoneId === predecessor.id && edge.successorMilestoneId === successor.id)) throw fail("DEPENDENCY_DUPLICATE", "That dependency already exists.", "CONFLICT");
        if (wouldCreateCycle(edges.map((edge) => ({ predecessorId: edge.predecessorMilestoneId, successorId: edge.successorMilestoneId })), predecessor.id, successor.id)) {
          incrementCounter(Metric.DEPENDENCY_CYCLE_REJECTION);
          throw fail("DEPENDENCY_CYCLE", `${predecessor.name} already depends on ${successor.name}, so this would make a loop.`, "CONFLICT");
        }
        const dependency = await tx.projectMilestoneDependency.create({
          data: { companyId: context.companyId, projectId: successor.projectId, predecessorMilestoneId: predecessor.id, successorMilestoneId: successor.id, lagDays: input.lagDays, createdByMemberId: context.membershipId },
          select: { id: true },
        });
        await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_DEPENDENCY_ADDED, entity: { type: RECORD, id: successor.id, label: successor.name }, projectId: successor.projectId, after: { dependencyId: dependency.id, predecessorMilestoneId: predecessor.id, successorMilestoneId: successor.id, lagDays: input.lagDays } }, { tx });
        return dependency;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await settleMilestoneAttention(context.companyId, successor.id);
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw fail("DEPENDENCY_DUPLICATE", "That dependency already exists.", "CONFLICT");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") throw fail("PLANNING_STALE", "Someone changed this plan at the same moment. Try again.", "CONFLICT");
    throw error;
  }
}

export async function removeDependency(context: UserContext, milestoneId: string, dependencyId: string): Promise<void> {
  const milestone = await findReadableMilestone(context, milestoneId);
  assertPermission(context, "project_planning.dependencies.manage");
  assertWritable(milestone.project);
  const dependency = await prisma.projectMilestoneDependency.findFirst({
    where: { id: dependencyId, companyId: context.companyId, projectId: milestone.projectId, OR: [{ successorMilestoneId: milestone.id }, { predecessorMilestoneId: milestone.id }] },
    select: { id: true, predecessorMilestoneId: true, successorMilestoneId: true, lagDays: true },
  });
  if (!dependency) throw fail("DEPENDENCY_NOT_FOUND", "That dependency could not be found.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.projectMilestoneDependency.delete({ where: { id: dependency.id } });
    await recordUserAction(context, { actionKey: AuditAction.PROJECT_MILESTONE_DEPENDENCY_REMOVED, entity: { type: RECORD, id: milestone.id, label: milestone.name }, projectId: milestone.projectId, before: { dependencyId: dependency.id, predecessorMilestoneId: dependency.predecessorMilestoneId, successorMilestoneId: dependency.successorMilestoneId, lagDays: dependency.lagDays } }, { tx });
  });
}
