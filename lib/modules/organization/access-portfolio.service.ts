import type { DepartmentPositionLevel, ParentGroupStatus } from "@prisma/client";

import { isMembershipRoleKey, positionLabels, roleLabel, type PositionLevel } from "@/config/roles";
import { USABLE_GROUP_STATUSES } from "@/lib/auth/session-store";
import { loadOrganizationAccessFor } from "@/lib/context/organization-access";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * Everything a person is authorised to work in, across their group (E-06 §16, §95).
 *
 * The session still works in one company at a time; this is the map around it —
 * the companies they belong to and the role they hold in each, the group
 * departments they head, the company branches they manage or work in, the
 * projects they are on and what was delegated to them. It powers the company
 * switcher and the group views. It names places and positions, never the
 * permission lists behind them (§95).
 */

export type AccessPortfolioDTO = {
  parentGroup: { id: string; name: string; status: ParentGroupStatus };
  companies: Array<{ id: string; name: string; role: { key: string; label: string }; isCurrent: boolean }>;
  groupDepartments: Array<{ id: string; key: string; name: string; position: { key: DepartmentPositionLevel; label: string } }>;
  companyDepartments: Array<{ id: string; name: string; company: { id: string; name: string }; position: { key: DepartmentPositionLevel; label: string } }>;
  projects: Array<{ id: string; code: string; name: string; company: { id: string; name: string }; projectRole: string | null }>;
  grants: Array<{ id: string; moduleKey: string; scope: string; accessLevel: string }>;
};

function position(level: DepartmentPositionLevel) {
  return { key: level, label: positionLabels[level as PositionLevel] };
}

export async function getAccessPortfolio(session: UserContext): Promise<AccessPortfolioDTO> {
  const [memberships, organization] = await Promise.all([
    prisma.companyMember.findMany({
      where: {
        userId: session.userId,
        status: "ACTIVE",
        company: { parentGroupId: session.parentGroupId, status: "ACTIVE", parentGroup: { status: { in: USABLE_GROUP_STATUSES } } },
      },
      select: { id: true, companyId: true, role: { select: { key: true, name: true } }, company: { select: { name: true } } },
      orderBy: { company: { name: "asc" } },
    }),
    loadOrganizationAccessFor(session.parentGroupId, session.userId),
  ]);
  const usable = memberships.filter((membership) => isMembershipRoleKey(membership.role.key));
  const companyName = new Map(usable.map((membership) => [membership.companyId, membership.company.name]));

  const branchIds = organization.assignments.map((assignment) => assignment.companyDepartmentId).filter((id): id is string => Boolean(id));
  const [branches, projectMembers] = await Promise.all([
    branchIds.length ? prisma.department.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }) : [],
    prisma.projectMember.findMany({
      where: { companyMemberId: { in: usable.map((membership) => membership.id) }, status: "ACTIVE", project: { archivedAt: null } },
      select: { projectRole: true, project: { select: { id: true, code: true, name: true, companyId: true } } },
      orderBy: { project: { name: "asc" } },
    }),
  ]);
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));

  return {
    parentGroup: { id: session.parentGroup.id, name: session.parentGroup.name, status: session.parentGroup.status },
    companies: usable.map((membership) => ({
      id: membership.companyId,
      name: membership.company.name,
      role: { key: membership.role.key, label: isMembershipRoleKey(membership.role.key) ? roleLabel(membership.role.key) : membership.role.name },
      isCurrent: membership.id === session.membershipId,
    })),
    groupDepartments: organization.assignments
      .filter((assignment) => assignment.companyId === null)
      .map((assignment) => ({ id: assignment.groupDepartmentId, key: assignment.groupDepartmentKey, name: assignment.groupDepartmentName, position: position(assignment.positionLevel) })),
    // Positions only: a member place widens nothing, and the person's profile lists those (E-13 §87).
    companyDepartments: organization.assignments
      .filter((assignment) => assignment.positionLevel !== "MEMBER" && assignment.companyId !== null && assignment.companyDepartmentId !== null && companyName.has(assignment.companyId))
      .map((assignment) => ({
        id: assignment.companyDepartmentId!,
        name: branchName.get(assignment.companyDepartmentId!) ?? assignment.groupDepartmentName,
        company: { id: assignment.companyId!, name: companyName.get(assignment.companyId!)! },
        position: position(assignment.positionLevel),
      })),
    projects: projectMembers
      .flatMap((row) => {
        const companyId = row.project.companyId;
        return companyId !== null && companyName.has(companyId) ? [{ id: row.project.id, code: row.project.code, name: row.project.name, company: { id: companyId, name: companyName.get(companyId)! }, projectRole: row.projectRole }] : [];
      }),
    grants: organization.grants.map((grant) => ({ id: grant.id, moduleKey: grant.moduleKey, scope: grant.scopeType, accessLevel: grant.accessLevel })),
  };
}
