import { modules as registry } from "@/config/modules";
import { AccessError } from "@/lib/access/guards";
import { ENTITLABLE_MODULES, entitledModulesFor } from "@/lib/core/entitlements/entitlement.resolver";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { prisma } from "@/lib/database/prisma";
import { threeDState } from "@/lib/modules/platform/platform-dashboard.query";

/**
 * The tabs of an organization's page (Organizations PRD §20-§41, §58-§60).
 *
 * `scope` is either one company or every company of a group: the same canonical
 * projects, memberships and module rows seen from either level, never copied.
 * Each tab reads only its own data, when it is the one open.
 */
export type OrganizationScope = { kind: "group"; groupId: string } | { kind: "company"; companyId: string };

function companyWhere(scope: OrganizationScope) {
  return scope.kind === "group" ? { parentGroupId: scope.groupId, parentGroup: { isTestFixture: false } } : { id: scope.companyId, parentGroup: { isTestFixture: false } };
}

function assertView(context: PlatformContext) {
  if (!canPlatform(context, "platform.company.view")) throw new AccessError("FORBIDDEN");
}

/** The group's companies with their counts (§24). */
export async function organizationCompanies(context: PlatformContext, groupId: string) {
  assertView(context);
  const rows = await prisma.company.findMany({
    where: { parentGroupId: groupId, parentGroup: { isTestFixture: false, kind: "GROUP" } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, slug: true, status: true, _count: { select: { projects: { where: { archivedAt: null } }, memberships: { where: { status: "ACTIVE" } }, modules: { where: { enabled: true } } } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, status: row.status, projects: row._count.projects, users: row._count.memberships, modules: row._count.modules }));
}

/** Canonical projects of the scope; a project is listed once, under its managing company (§33-§35). */
export async function organizationProjects(context: PlatformContext, scope: OrganizationScope) {
  assertView(context);
  const rows = await prisma.project.findMany({
    where: { company: companyWhere(scope) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }, { id: "asc" }],
    select: { id: true, code: true, name: true, status: true, archivedAt: true, company: { select: { id: true, name: true } }, _count: { select: { members: { where: { status: "ACTIVE" } } } }, project3DConfig: { select: { visibility: true, deletedAt: true } } },
  });
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, status: row.archivedAt ? "ARCHIVED" : row.status, company: row.company, users: row._count.members, threeD: threeDState(row.project3DConfig) }));
}

/**
 * Account holders with a place in the scope (§36-§38): company memberships,
 * and for a group its group-level seats. Employees without a login are not
 * here — they have no account.
 */
export async function organizationUsers(context: PlatformContext, scope: OrganizationScope) {
  assertView(context);
  const [members, seats] = await Promise.all([
    prisma.companyMember.findMany({
      where: { company: companyWhere(scope), archivedAt: null },
      orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }, { id: "asc" }],
      select: {
        id: true, status: true, jobTitle: true,
        user: { select: { id: true, firstName: true, lastName: true, username: true, status: true } },
        role: { select: { name: true } },
        company: { select: { id: true, name: true } },
        department: { select: { name: true } },
        _count: { select: { projectMemberships: { where: { status: "ACTIVE" } } } },
      },
    }),
    scope.kind === "group"
      ? prisma.parentGroupMember.findMany({ where: { parentGroupId: scope.groupId }, select: { id: true, status: true, user: { select: { id: true, firstName: true, lastName: true, username: true, status: true } } } })
      : Promise.resolve([]),
  ]);
  return [
    ...seats.map((row) => ({ id: `seat:${row.id}`, userId: row.user.id, name: `${row.user.firstName} ${row.user.lastName}`, username: row.user.username, role: "Group level", company: null, department: null, projects: null, membership: row.status, account: row.user.status })),
    ...members.map((row) => ({ id: row.id, userId: row.user.id, name: `${row.user.firstName} ${row.user.lastName}`, username: row.user.username, role: row.role.name, company: row.company, department: row.department?.name ?? null, projects: row._count.projectMemberships, membership: row.status, account: row.user.status })),
  ];
}

/**
 * Module entitlements, company by company (§39, §40): a group shows how many of
 * its companies have each module, never one switch for all of them.
 */
export async function organizationModules(context: PlatformContext, scope: OrganizationScope) {
  if (!canPlatform(context, "platform.module.view")) throw new AccessError("FORBIDDEN");
  const companies = await prisma.company.findMany({ where: companyWhere(scope), select: { id: true } });
  // From the canonical entitlements (Admin Modules PRD #4 §56), not a second calculation.
  const entitled = await entitledModulesFor(companies.map((row) => row.id));
  return {
    companies: companies.length,
    modules: ENTITLABLE_MODULES.map((key) => ({ key, name: registry[key].label, description: registry[key].description, enabledIn: [...entitled.values()].filter((keys) => keys.has(key)).length })),
  };
}

/** Only what NESTO measures (§41). */
export async function organizationUsage(context: PlatformContext, scope: OrganizationScope) {
  assertView(context);
  const where = companyWhere(scope);
  const [companies, projects, users, modules, storage, experiences] = await Promise.all([
    prisma.company.count({ where }),
    prisma.project.count({ where: { company: where, archivedAt: null } }),
    prisma.companyMember.findMany({ where: { company: where, status: "ACTIVE" }, distinct: ["userId"], select: { userId: true } }),
    prisma.companyModule.count({ where: { enabled: true, company: where } }),
    prisma.companyStorageUsage.aggregate({ where: { company: where }, _sum: { usedBytes: true, fileCount: true } }),
    prisma.project3DConfig.count({ where: { deletedAt: null, project: { company: where } } }),
  ]);
  return { companies, projects, users: users.length, modules, storageBytes: Number(storage._sum.usedBytes ?? 0), files: storage._sum.fileCount ?? 0, experiences };
}

/** Recent organization events from the audit trail, at most five (§57). */
export async function organizationActivity(context: PlatformContext, scope: OrganizationScope, limit = 5) {
  if (!canPlatform(context, "platform.audit.view")) return [];
  const rows = await prisma.auditEvent.findMany({
    where: scope.kind === "group" ? { parentGroupId: scope.groupId, moduleKey: "platform" } : { OR: [{ companyId: scope.companyId }, { entityType: "Company", entityId: scope.companyId }], moduleKey: "platform" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, actionKey: true, actorDisplayNameSnapshot: true, entityLabelSnapshot: true, occurredAt: true },
  });
  return rows.map((row) => ({ id: row.id, actionKey: row.actionKey, actor: row.actorDisplayNameSnapshot, entity: row.entityLabelSnapshot, occurredAt: row.occurredAt.toISOString() }));
}
