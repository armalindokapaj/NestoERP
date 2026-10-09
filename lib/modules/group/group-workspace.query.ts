import { canGroup, type GroupContext } from "@/lib/context/group-context";
import { AccessError } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";

/**
 * What a group-only session reads (Admin PRD #9 §45, §70): every query names
 * the group of the caller's own seat and nothing else, and none of them goes
 * through a company to get to it.
 */

function assertCan(context: GroupContext, capability: Parameters<typeof canGroup>[1]) {
  if (!canGroup(context, capability)) throw new AccessError("FORBIDDEN");
}

export async function groupOverview(context: GroupContext) {
  assertCan(context, "group.view");
  const [companies, seats, ceo] = await Promise.all([
    prisma.company.count({ where: { parentGroupId: context.groupId, status: "ACTIVE" } }),
    prisma.parentGroupMember.count({ where: { parentGroupId: context.groupId, status: "ACTIVE", user: { status: "ACTIVE" } } }),
    prisma.parentGroupMember.findFirst({ where: { parentGroupId: context.groupId, status: "ACTIVE", role: { key: "OWNER" } }, select: { user: { select: { firstName: true, lastName: true } } } }),
  ]);
  return { companies, seats, ceo: ceo ? `${ceo.user.firstName} ${ceo.user.lastName}` : null };
}

export async function groupCompanies(context: GroupContext) {
  assertCan(context, "group.companies.view");
  const rows = await prisma.company.findMany({
    where: { parentGroupId: context.groupId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, slug: true, status: true, _count: { select: { memberships: true, projects: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, status: row.status, people: row._count.memberships, projects: row._count.projects }));
}

export async function groupRoleCounts(context: GroupContext) {
  assertCan(context, "group.roles.view");
  const rows = await prisma.parentGroupMember.findMany({
    where: { parentGroupId: context.groupId, status: "ACTIVE", role: { isNot: null }, user: { status: "ACTIVE" } },
    select: { role: { select: { key: true } }, user: { select: { firstName: true, lastName: true } } },
  });
  const holders = (key: string) => rows.filter((row) => row.role?.key === key).map((row) => `${row.user.firstName} ${row.user.lastName}`);
  return { OWNER: holders("OWNER"), GROUP_IT: holders("GROUP_IT") };
}

/**
 * The group shell's search (UI-01 §8): the group's own companies and seats, and
 * only those the caller's capabilities already let them list. The group comes
 * from the session's seat, never from the request, so no query can reach another
 * group.
 */
export async function groupSearch(context: GroupContext, query: string) {
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return [];
  const contains = { contains: q, mode: "insensitive" as const };
  const [companies, seats] = await Promise.all([
    canGroup(context, "group.companies.view")
      ? prisma.company.findMany({ where: { parentGroupId: context.groupId, OR: [{ name: contains }, { slug: contains }] }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 6, select: { id: true, name: true, slug: true } })
      : [],
    canGroup(context, "group.users.view")
      ? prisma.parentGroupMember.findMany({
          where: { parentGroupId: context.groupId, status: "ACTIVE", user: { status: "ACTIVE", OR: [{ firstName: contains }, { lastName: contains }, { username: contains }] } },
          take: 6,
          select: { user: { select: { id: true, firstName: true, lastName: true, username: true } } },
        })
      : [],
  ]);
  return [
    ...companies.map((row) => ({ type: "Company", id: row.id, title: row.name, subtitle: row.slug, href: `/group/companies/${row.id}/users` })),
    ...seats.map((row) => ({ type: "User", id: row.user.id, title: `${row.user.firstName} ${row.user.lastName}`, subtitle: row.user.username, href: "/group/users" })),
  ];
}
