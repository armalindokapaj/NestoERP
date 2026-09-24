import type { AccessLevel, AccessScopeType, DepartmentPositionLevel } from "@prisma/client";

import { rolesOfFunction } from "@/config/group-departments";
import { isModuleKey, type ModuleKey } from "@/config/modules";
import type { PositionLevel, RoleKey } from "@/config/roles";
import { Metric, recordDuration } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { scoped } from "@/lib/core/observability/request-scope";

/**
 * The organizational half of a person's access (E-06 §13, §18, §73).
 *
 * A membership says which role somebody holds in a company. Whether they hold it
 * as a member, as the company's department manager or as the group's department
 * head is a department assignment; whether anything was delegated to them on
 * top is an access grant. Both are read here, for the session resolver and for
 * other people's contexts alike, so a manager is a manager whether they are
 * signed in or being notified.
 */

export type ContextAssignment = {
  id: string;
  groupDepartmentId: string;
  groupDepartmentKey: string;
  groupDepartmentName: string;
  companyId: string | null;
  companyDepartmentId: string | null;
  functionalRoleKey: string;
  positionLevel: DepartmentPositionLevel;
};

export type ContextGrant = {
  id: string;
  moduleKey: ModuleKey;
  scopeType: AccessScopeType;
  scopeId: string | null;
  accessLevel: AccessLevel;
};

export type OrganizationAccess = {
  assignments: ContextAssignment[];
  grants: ContextGrant[];
};

const EMPTY: OrganizationAccess = { assignments: [], grants: [] };

/**
 * Live assignments and grants for these users inside one parent group. "Live"
 * is decided in the query: an ended, future or suspended position grants
 * nothing, nor does one in an inactive group department or an inactive branch
 * (E-13 §89, §90), and neither does a revoked or expired grant.
 */
export async function loadOrganizationAccess(
  parentGroupId: string,
  userIds: readonly string[],
): Promise<Map<string, OrganizationAccess>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const result = new Map<string, OrganizationAccess>();
  if (unique.length === 0) return result;

  const now = new Date();
  const [assignments, grants] = await Promise.all([
    prisma.departmentAssignment.findMany({
      where: {
        parentGroupId,
        userId: { in: unique },
        status: "ACTIVE",
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          { OR: [{ companyDepartmentId: null }, { companyDepartment: { status: "ACTIVE" } }] },
        ],
        groupDepartment: { status: "ACTIVE" },
      },
      select: {
        id: true,
        userId: true,
        groupDepartmentId: true,
        companyId: true,
        companyDepartmentId: true,
        functionalRoleKey: true,
        positionLevel: true,
        groupDepartment: { select: { key: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.accessGrant.findMany({
      where: {
        parentGroupId,
        userId: { in: unique },
        revokedAt: null,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { id: true, userId: true, functionKey: true, scopeType: true, scopeId: true, accessLevel: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  for (const userId of unique) result.set(userId, { assignments: [], grants: [] });

  for (const row of assignments) {
    result.get(row.userId)!.assignments.push({
      id: row.id,
      groupDepartmentId: row.groupDepartmentId,
      groupDepartmentKey: row.groupDepartment.key,
      groupDepartmentName: row.groupDepartment.name,
      companyId: row.companyId,
      companyDepartmentId: row.companyDepartmentId,
      functionalRoleKey: row.functionalRoleKey,
      positionLevel: row.positionLevel,
    });
  }

  for (const row of grants) {
    // A grant about something that is not a module grants nothing here.
    if (!row.functionKey || !isModuleKey(row.functionKey)) continue;
    result.get(row.userId)!.grants.push({
      id: row.id,
      moduleKey: row.functionKey,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      accessLevel: row.accessLevel,
    });
  }

  return result;
}

/**
 * One person's organization access in one group, read once per request
 * (NAV-02 QUERY-01): the session resolver, the group's company contexts and the
 * development access panel all ask for it, and all get the same snapshot. The
 * key is the group and the user, so another person's access is never answered
 * with this one's. Callers treat the result as read-only.
 */
export function loadOrganizationAccessFor(parentGroupId: string, userId: string): Promise<OrganizationAccess> {
  return scoped(`org:${parentGroupId}:${userId}`, async () => {
    const startedAt = performance.now();
    const access = (await loadOrganizationAccess(parentGroupId, [userId])).get(userId) ?? EMPTY;
    recordDuration(Metric.ORGANIZATION_LOAD_MS, Metric.ORGANIZATION_LOAD, startedAt);
    return access;
  });
}

/** The assignments that concern one company: the group's heads and that company's own. */
export function assignmentsInCompany(assignments: readonly ContextAssignment[], companyId: string): ContextAssignment[] {
  return assignments.filter((assignment) => assignment.companyId === null || assignment.companyId === companyId);
}

/**
 * The position a membership's role is held with in one company (E-06 §7, §121).
 *
 * Only an assignment held with the membership's own role counts: heading Group
 * Finance makes somebody a manager where they work as Finance, not wherever
 * they happen to be a Viewer. And only in a function that role belongs to: a
 * department the group added itself binds no role, so heading or managing it
 * is organizational and widens nothing (E-13 §59, ADR 0003). A group head
 * outranks a company manager; the union of what both hold is the head's
 * profile, which contains the manager's.
 */
export function positionFor(
  role: RoleKey,
  companyId: string,
  assignments: readonly ContextAssignment[],
): PositionLevel {
  const ownRole = assignments.filter(
    (assignment) => assignment.functionalRoleKey === role && rolesOfFunction(assignment.groupDepartmentKey).includes(role),
  );
  if (ownRole.some((assignment) => assignment.positionLevel === "GROUP_HEAD" && assignment.companyId === null)) {
    return "GROUP_HEAD";
  }
  if (ownRole.some((assignment) => assignment.positionLevel === "COMPANY_MANAGER" && assignment.companyId === companyId)) {
    return "COMPANY_MANAGER";
  }
  return "MEMBER";
}

/**
 * Grants that reach one company: made for the whole group or for that company.
 * Narrower grants (a department, a project, a record) are recorded but do not
 * yet widen a module in V0.1; they are refused when made.
 */
export function grantsInCompany(
  grants: readonly ContextGrant[],
  parentGroupId: string,
  companyId: string,
): ContextGrant[] {
  return grants.filter(
    (grant) =>
      (grant.scopeType === "GROUP" && (grant.scopeId === null || grant.scopeId === parentGroupId)) ||
      (grant.scopeType === "COMPANY" && grant.scopeId === companyId),
  );
}
