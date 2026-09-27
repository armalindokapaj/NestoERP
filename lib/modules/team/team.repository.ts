import { Prisma } from "@prisma/client";

import { buildProjectScopeWhere } from "@/lib/access/scope";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import type { UserContext } from "@/lib/context/types";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import type { TeamListQuery, TeamSortKey } from "./team.schema";
import { buildTeamScopeWhere } from "./team.scope";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Database access for Team (PRD #14 §143, §232).
 *
 * The directory is a join across User, Role and Department, and a list of 25
 * must not become 100 queries — every column a row needs is selected up front
 * (PRD #14 §232).
 */

const SORT_ORDER: Record<TeamSortKey, Prisma.CompanyMemberOrderByWithRelationInput[]> = {
  "name-asc": [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
  "name-desc": [{ user: { firstName: "desc" } }, { user: { lastName: "desc" } }],
  "created-desc": [{ createdAt: "desc" }],
  "updated-desc": [{ updatedAt: "desc" }],
  "role-asc": [{ role: { name: "asc" } }, { user: { firstName: "asc" } }],
  "department-asc": [{ department: { name: "asc" } }, { user: { firstName: "asc" } }],
  "last-login-desc": [{ user: { lastLoginAt: { sort: "desc", nulls: "last" } } }],
};

const SUMMARY_SELECT = {
  id: true,
  userId: true,
  jobTitle: true,
  status: true,
  joinedAt: true,
  invitedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
      avatarUrl: true,
      lastLoginAt: true,
    },
  },
  role: { select: { id: true, key: true, name: true } },
  department: { select: { id: true, name: true } },
} satisfies Prisma.CompanyMemberSelect;

export type TeamMemberRow = Prisma.CompanyMemberGetPayload<{ select: typeof SUMMARY_SELECT }>;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  deactivatedAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
      phone: true,
      avatarUrl: true,
      lastLoginAt: true,
      personProfileId: true,
    },
  },
} satisfies Prisma.CompanyMemberSelect;

export type TeamMemberDetailRow = Prisma.CompanyMemberGetPayload<{ select: typeof DETAIL_SELECT }>;

export function buildTeamListWhere(
  context: UserContext,
  query: TeamListQuery,
): Prisma.CompanyMemberWhereInput {
  const filters: Prisma.CompanyMemberWhereInput[] = [buildTeamScopeWhere(context)];

  const search = searchClause(query.search, ["jobTitle"]);
  if (search) {
    const term = query.search!.trim();
    // An invitee's account name is not shown for their row (PRD #47 §59), so it
    // must not be searchable either — a match would confirm it just the same.
    const joined: Prisma.CompanyMemberWhereInput = { status: { not: "INVITED" } };
    filters.push({
      OR: [
        ...search.OR.map((clause) => clause as Prisma.CompanyMemberWhereInput),
        { ...joined, user: { firstName: { contains: term, mode: "insensitive" } } },
        { ...joined, user: { lastName: { contains: term, mode: "insensitive" } } },
        { user: { email: { contains: term, mode: "insensitive" } } },
        { department: { name: { contains: term, mode: "insensitive" } } },
        { role: { name: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  if (query.roleId) filters.push({ roleId: query.roleId });
  if (query.departmentId) filters.push({ departmentId: query.departmentId });
  if (query.status?.length) filters.push({ status: { in: query.status } });

  // A project filter runs through the reader's own project scope, so it cannot
  // be used to enumerate a project they may not open (PRD #14 §40).
  if (query.projectId) {
    filters.push({
      OR: [
        {
          projectMemberships: {
            some: {
              status: "ACTIVE",
              project: { AND: [buildProjectScopeWhere(context), { id: query.projectId }] },
            },
          },
        },
        { managedProjects: { some: { AND: [buildProjectScopeWhere(context), { id: query.projectId }] } } },
      ],
    });
  }

  return { AND: filters };
}

export async function listMembers(context: UserContext, query: TeamListQuery) {
  const where = buildTeamListWhere(context, query);

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "team.members.list",
    async (tx) => {
      const window = pageWindow(await tx.companyMember.count({ where }), query.page, query.limit);
      const rows = await tx.companyMember.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: withTieBreaker(SORT_ORDER[query.sort]),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const counts = await visibleProjectCounts(context, rows.map((row) => row.id));

  return { rows, total: window.total, window, projectCounts: counts };
}

/**
 * Visible project counts for a page of members, in one grouped query.
 *
 * Counted through the reader's own project scope, so the number never tells
 * somebody how many projects they cannot see (PRD #14 §52, §233).
 */
export async function visibleProjectCounts(
  context: UserContext,
  memberIds: string[],
): Promise<Map<string, number>> {
  if (memberIds.length === 0) return new Map();

  const [memberships, managed] = await Promise.all([
    prisma.projectMember.groupBy({
      by: ["companyMemberId"],
      where: {
        companyMemberId: { in: memberIds },
        status: "ACTIVE",
        project: buildProjectScopeWhere(context),
      },
      _count: { _all: true },
    }),
    // The projects these people manage, with whether each manager is also an active member of it.
    // A manager who is also a member is counted once — by the membership above. (A `none` over the
    // whole page used to drop a project whenever anybody else on the page was a member of it.)
    prisma.project.findMany({
      where: { AND: [buildProjectScopeWhere(context), { projectManagerMemberId: { in: memberIds } }] },
      select: {
        projectManagerMemberId: true,
        members: { where: { companyMemberId: { in: memberIds }, status: "ACTIVE" }, select: { companyMemberId: true } },
      },
    }),
  ]);

  const counts = new Map<string, number>();
  for (const row of memberships) counts.set(row.companyMemberId, row._count._all);
  for (const project of managed) {
    const manager = project.projectManagerMemberId;
    if (!manager || project.members.some((member) => member.companyMemberId === manager)) continue;
    counts.set(manager, (counts.get(manager) ?? 0) + 1);
  }
  return counts;
}

export async function findMemberInScope(
  context: UserContext,
  memberId: string,
): Promise<TeamMemberDetailRow | null> {
  return prisma.companyMember.findFirst({
    where: { AND: [buildTeamScopeWhere(context), { id: memberId }] },
    select: DETAIL_SELECT,
  });
}

/** The projects a member belongs to, narrowed to what the reader can see. */
export async function listMemberProjects(context: UserContext, memberId: string) {
  const [memberships, managed] = await Promise.all([
    prisma.projectMember.findMany({
      where: { companyMemberId: memberId, project: buildProjectScopeWhere(context) },
      select: {
        projectRole: true,
        status: true,
        project: { select: { id: true, code: true, name: true, status: true } },
      },
      orderBy: { project: { name: "asc" } },
    }),
    prisma.project.findMany({
      where: { AND: [buildProjectScopeWhere(context), { projectManagerMemberId: memberId }] },
      select: { id: true, code: true, name: true, status: true },
    }),
  ]);

  return { memberships, managed };
}

/**
 * How much work would be left behind by removing this member's access.
 *
 * Deactivation does not reassign anything, so the person doing it is told what
 * they are about to orphan (PRD #14 §101, §104).
 */
export async function membershipGuards(context: UserContext, memberId: string) {
  const [managedActiveProjects, openAssignedTasks, activeOwners, member] = await Promise.all([
    prisma.project.count({
      where: {
        companyId: context.companyId,
        projectManagerMemberId: memberId,
        archivedAt: null,
        status: { in: ["PENDING", "ACTIVE"] },
      },
    }),
    prisma.task.count({
      where: {
        companyId: context.companyId,
        assigneeMemberId: memberId,
        archivedAt: null,
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      },
    }),
    prisma.companyMember.count({
      where: { companyId: context.companyId, status: "ACTIVE", role: { key: "OWNER" } },
    }),
    prisma.companyMember.findFirst({
      where: { id: memberId, companyId: context.companyId },
      select: { status: true, role: { select: { key: true } } },
    }),
  ]);

  const isActiveOwner = member?.role.key === "OWNER" && member.status === "ACTIVE";

  return {
    managedActiveProjects,
    openAssignedTasks,
    // The company must never lose its last active Owner (PRD #14 §93).
    lastActiveOwner: isActiveOwner && activeOwners <= 1,
  };
}

export async function activeOwnerCount(companyId: string): Promise<number> {
  return prisma.companyMember.count({
    where: { companyId, status: "ACTIVE", role: { key: "OWNER" } },
  });
}

/* -------------------------------------------------------------------------- */
/* Overview and filters                                                        */
/* -------------------------------------------------------------------------- */

export async function teamOverviewStats(context: UserContext) {
  const scope = buildTeamScopeWhere(context);

  const [activeMembers, departments, pendingInvitations, inactiveMembers, suspendedMembers] =
    await Promise.all([
      prisma.companyMember.count({ where: { AND: [scope, { status: "ACTIVE" }] } }),
      prisma.department.count({
        where: { companyId: context.companyId, status: { not: "ARCHIVED" } },
      }),
      prisma.companyInvite.count({
        where: { companyId: context.companyId, status: "PENDING", expiresAt: { gt: new Date() } },
      }),
      prisma.companyMember.count({ where: { AND: [scope, { status: "INACTIVE" }] } }),
      prisma.companyMember.count({ where: { AND: [scope, { status: "SUSPENDED" }] } }),
    ]);

  return { activeMembers, departments, pendingInvitations, inactiveMembers, suspendedMembers };
}

/** Department headcount for the overview chart (PRD #14 §30, §235). */
export async function departmentDistribution(context: UserContext) {
  const groups = await prisma.companyMember.groupBy({
    by: ["departmentId"],
    where: { AND: [buildTeamScopeWhere(context), { status: "ACTIVE" }] },
    _count: { _all: true },
  });

  const departments = await prisma.department.findMany({
    where: { companyId: context.companyId, status: { not: "ARCHIVED" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const counts = new Map(groups.map((group) => [group.departmentId ?? "", group._count._all]));

  return departments
    .map((department) => ({
      id: department.id,
      name: department.name,
      members: counts.get(department.id) ?? 0,
    }))
    .filter((entry) => entry.members > 0);
}

export async function recentMembers(context: UserContext, take = 5) {
  return prisma.companyMember.findMany({
    where: { AND: [buildTeamScopeWhere(context), { status: "ACTIVE" }] },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Filter values, derived from the members this reader can already discover. */
export async function teamFilterOptions(context: UserContext) {
  const scope = buildTeamScopeWhere(context);

  const [roles, departments] = await Promise.all([
    prisma.role.findMany({
      where: { members: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({
      where: { companyId: context.companyId, members: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { roles, departments };
}
