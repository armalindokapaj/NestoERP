import type { Prisma } from "@prisma/client";

import { getModuleScope } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";

/**
 * Team scope (PRD #14 §21–§26, §145).
 *
 * Who a person may see in the directory:
 *
 *   COMPANY   the whole company
 *   DEPARTMENT their own department, plus themselves
 *   PROJECT    colleagues who share a project they can reach
 *   ASSIGNED   the same, narrowed to the projects they are assigned to
 *   SELF       themselves only
 *
 * Project and assigned scope reuse the Projects resolver rather than
 * re-deriving membership here — one interpretation of "a project I can reach",
 * not two (PRD #14 §24, §145).
 */

/** Members who share at least one project with this reader (PRD #14 §24). */
function sharedProjectClause(context: UserContext): Prisma.CompanyMemberWhereInput {
  const accessible = buildProjectScopeWhere(context);
  return {
    OR: [
      { id: context.membershipId },
      { projectMemberships: { some: { status: "ACTIVE", project: accessible } } },
      { managedProjects: { some: accessible } },
    ],
  };
}

export function buildTeamScopeWhere(context: UserContext): Prisma.CompanyMemberWhereInput {
  const scope = getModuleScope(context, "team");
  const base: Prisma.CompanyMemberWhereInput = { companyId: context.companyId };

  if (scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM") return base;

  if (scope === "DEPARTMENT") {
    return {
      ...base,
      OR: [
        { id: context.membershipId },
        context.department
          ? { departmentId: context.department.id }
          : // Without a department of their own, there is no department to see.
            { id: context.membershipId },
      ],
    };
  }

  if (scope === "SELF") return { ...base, id: context.membershipId };

  return { AND: [base, sharedProjectClause(context)] };
}

export async function canAccessMember(
  context: UserContext,
  memberId: string,
): Promise<boolean> {
  const found = await prisma.companyMember.findFirst({
    where: { AND: [buildTeamScopeWhere(context), { id: memberId }] },
    select: { id: true },
  });
  return Boolean(found);
}
