import { can, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { startHereFor, type StartHere } from "./dashboard.start-here";

/** Reads the two facts for this reader, each only where they may read it. */
export async function loadStartHere(context: UserContext): Promise<StartHere> {
  if (context.workspace.scopeType !== "COMPANY") return { kind: "none" };
  const readsProjects = isModuleEnabled(context, "projects") && can(context, "project.view");
  const readsTasks = isModuleEnabled(context, "tasks") && can(context, "task.view");
  const [project, task] = await Promise.all([
    readsProjects ? prisma.project.findFirst({ where: buildProjectScopeWhere(context), select: { id: true } }) : null,
    readsTasks ? prisma.task.findFirst({ where: buildTaskScopeWhere(context), select: { id: true } }) : null,
  ]);
  return startHereFor(
    {
      scope: "COMPANY",
      holds: (permission) => can(context, permission),
      enabled: (module) => isModuleEnabled(context, module),
    },
    { hasProjects: readsProjects ? project !== null : null, hasTasks: readsTasks ? task !== null : null },
  );
}
