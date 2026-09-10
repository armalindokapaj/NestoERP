import type { Prisma } from "@prisma/client";

import type { DataScope } from "@/config/access";
import type { ModuleKey } from "@/config/modules";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { getModuleScope } from "./can";

/**
 * Data-scope query builders (PRD #8 §76–§82, PRD #10 §98).
 *
 * Scope is applied in the database, never in the browser (PRD #5 §33). Every
 * builder here starts from `companyId` — tenant isolation is not optional and
 * applies to the Owner too (PRD #8 §89).
 *
 * The conceptual order for every list query is:
 *   company → archive state → permission scope → filters → sort → pagination
 */

/** Projects the member manages or actively belongs to (PRD #10 §98). */
function memberProjectClause(context: UserContext): Prisma.ProjectWhereInput {
  return {
    OR: [
      { projectManagerMemberId: context.membershipId },
      {
        members: {
          some: { companyMemberId: context.membershipId, status: "ACTIVE" },
        },
      },
    ],
  };
}

/**
 * The `where` fragment that limits Projects to what this user may see.
 *
 * COMPANY and SYSTEM see everything inside the company; PROJECT and ASSIGNED
 * see only projects they belong to; SELF and DEPARTMENT fall back to project
 * membership, because a project has no personal or departmental owner.
 */
export function buildProjectScopeWhere(context: UserContext): Prisma.ProjectWhereInput {
  const scope = getModuleScope(context, "projects");
  const base: Prisma.ProjectWhereInput = { companyId: context.companyId };

  if (scope === "COMPANY" || scope === "SYSTEM" || scope === "DEPARTMENT") {
    return base;
  }

  return { ...base, ...memberProjectClause(context) };
}

/** Project ids inside scope. Used where a nested query needs a plain list. */
export async function accessibleProjectIds(context: UserContext): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: buildProjectScopeWhere(context),
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function canAccessProject(
  context: UserContext,
  projectId: string,
): Promise<boolean> {
  const found = await prisma.project.findFirst({
    where: { ...buildProjectScopeWhere(context), id: projectId },
    select: { id: true },
  });
  return Boolean(found);
}

/**
 * Tasks.
 *
 * SELF and ASSIGNED mean "assigned to me, or created by me"; PROJECT widens
 * that to every task on a project the user belongs to.
 *
 * On top of the task scope sits a project gate: a task that belongs to a
 * project is only ever reachable when that project is. Being the assignee — or
 * the person who created it — does not hand somebody the project context they
 * have otherwise lost (PRD #11 §176, §177). The gate can only narrow the
 * result, never widen it.
 */
export function buildTaskScopeWhere(context: UserContext): Prisma.TaskWhereInput {
  const scope = getModuleScope(context, "tasks");
  const base: Prisma.TaskWhereInput = { companyId: context.companyId };

  const projectGate: Prisma.TaskWhereInput = {
    OR: [{ projectId: null }, { project: buildProjectScopeWhere(context) }],
  };

  if (scope === "COMPANY" || scope === "SYSTEM" || scope === "DEPARTMENT") {
    return { AND: [base, projectGate] };
  }

  const mine: Prisma.TaskWhereInput[] = [
    { assigneeMemberId: context.membershipId },
    { createdByMemberId: context.membershipId },
  ];

  if (scope === "SELF") {
    return { AND: [base, projectGate, { OR: mine }] };
  }

  // ASSIGNED and PROJECT both reach project work; ASSIGNED additionally keeps
  // personal tasks that have no project at all.
  return {
    AND: [base, projectGate, { OR: [...mine, { project: memberProjectClause(context) }] }],
  };
}

/**
 * Clients.
 *
 * A scoped user reaches a client through the projects they work on
 * (PRD #5 §36), so a client with no accessible project stays invisible.
 */
export function buildClientScopeWhere(context: UserContext): Prisma.ClientWhereInput {
  const scope = getModuleScope(context, "clients");
  const base: Prisma.ClientWhereInput = { companyId: context.companyId };

  if (scope === "COMPANY" || scope === "SYSTEM" || scope === "DEPARTMENT") {
    return base;
  }

  return {
    ...base,
    projects: { some: memberProjectClause(context) },
  };
}

/**
 * Records that hang off a project — invoices, purchase requests, quality and
 * HSE records. They inherit the project scope of their own module.
 */
export function buildProjectLinkedScopeWhere(
  context: UserContext,
  moduleKey: ModuleKey,
): { companyId: string; project?: Prisma.ProjectWhereInput } {
  const scope = getModuleScope(context, moduleKey);

  if (scope === "COMPANY" || scope === "SYSTEM" || scope === "DEPARTMENT") {
    return { companyId: context.companyId };
  }

  return { companyId: context.companyId, project: memberProjectClause(context) };
}

/** Human-readable scope, for the development access debugger (PRD #7 §123). */
export function describeScope(scope: DataScope): string {
  switch (scope) {
    case "SELF":
      return "Only your own records";
    case "ASSIGNED":
      return "Records assigned to you";
    case "PROJECT":
      return "Projects you belong to";
    case "DEPARTMENT":
      return "Your department";
    case "COMPANY":
      return "The whole company";
    case "SYSTEM":
      return "System configuration";
  }
}
