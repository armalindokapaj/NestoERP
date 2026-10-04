import type { CompanyAccessMode, MembershipStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { MEMBERSHIP_ROLE_KEYS } from "@/config/roles";
import { AccessError, assertFound } from "@/lib/access/guards";
import { createProvisionedUser } from "@/lib/auth/identity";
import { revokeSessions } from "@/lib/auth/session-store";
import { DEFAULT_PASSWORD } from "@/lib/auth/temporary-password";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { assertWithinLimit } from "@/lib/modules/entitlements/entitlement.service";
import { assertNotCompanyCeo } from "@/lib/modules/platform/company-leadership.service";
import { syncSeatAccess } from "@/lib/modules/platform/group-company-access.service";
import { assertGroupCan, type GroupActor } from "@/lib/modules/platform/group-actor";
import { departmentKeyFor, memberPlace } from "@/lib/modules/platform/group-placement";
import { companyProjects, syncProjects } from "@/lib/modules/platform/platform-organization-admin.service";
import { GROUP_LEVEL_ROLES } from "@/lib/modules/platform/platform.schema";

/**
 * A company's people, seen from inside the company (Admin PRD #13).
 *
 * One person is one row however they got in. Whether the access is the
 * company's own (a direct membership), the parent group's (a seat whose policy
 * covers the company) or both is worked out here from the same two facts PRD
 * #10 keeps — the membership row and the seat's coverage — and never rebuilt
 * from lists in the browser. Every request names the company; the actor must
 * hold the capability for that company's group, so a company outside the actor's
 * reach answers 403 whatever else the request says.
 *
 * What is managed here is the person's relationship with this company: role,
 * department, position, projects, suspension, removal. The global account and
 * the group seat are other surfaces' business; removing someone from a company
 * never deletes them.
 */

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().max(500).optional().transform((value) => value || "Company administration");
/** The CEO is named through Assign / Change CEO; group-level and platform roles are never company roles (PRD #13 §25-§27). */
export const COMPANY_ROLE_KEYS = MEMBERSHIP_ROLE_KEYS.filter((key) => key !== "CEO" && !(GROUP_LEVEL_ROLES as readonly string[]).includes(key));
const roleKey = z.enum(COMPANY_ROLE_KEYS as [string, ...string[]], { message: "Choose a role." });
const jobTitle = z.string().trim().max(120);

const PAGE = 25;
const BULK_MAX = 100;
const LISTED: MembershipStatus[] = ["ACTIVE", "INVITED", "SUSPENDED"];
const USABLE_GROUP = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"];

export const companyUsersListSchema = z.object({
  companyId: id,
  q: z.string().trim().max(120).catch(""),
  role: z.string().trim().max(40).catch(""),
  departmentId: z.string().trim().max(128).catch(""),
  status: z.enum(["", "ACTIVE", "INVITED", "SUSPENDED"]).catch(""),
  source: z.enum(["", "DIRECT", "GROUP", "BOTH"]).catch(""),
  projectId: z.string().trim().max(128).catch(""),
  sort: z.enum(["name", "role", "department", "recent"]).catch("name"),
  cursor: z.string().trim().max(128).optional().catch(undefined),
});
export const companyUserSchema = z.object({ companyId: id, userId: id });
export const companyUserActivitySchema = z.object({ companyId: id, userId: id, cursor: id.optional() });
export const companyUserAddSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"), companyId: id, roleKey, departmentId: id.nullish(), jobTitle: jobTitle.optional(), projectIds: z.array(id).max(50).default([]), reason,
    firstName: z.string().trim().min(1, "Enter a first name.").max(80),
    lastName: z.string().trim().min(1, "Enter a last name.").max(80),
    email: z.email("Enter a valid email address.").trim().max(200),
  }),
  z.object({ mode: z.literal("existing"), companyId: id, userId: id, roleKey, departmentId: id.nullish(), jobTitle: jobTitle.optional(), projectIds: z.array(id).max(50).default([]), reason }),
]);
export const companyUserUpdateSchema = z.object({
  companyId: id, userId: id,
  roleKey: roleKey.optional(),
  /** null clears the department. */
  departmentId: id.nullish(),
  jobTitle: jobTitle.optional(),
  projectIds: z.array(id).max(50).optional(),
  /** The version the form was loaded at; a membership changed since is refused, not overwritten (§135). */
  expectedVersion: z.number().int().min(1).optional(),
  reason,
});
export const companyUserStatusSchema = z.object({ companyId: id, userId: id, expectedVersion: z.number().int().min(1).optional(), reason });
export const companyUserCandidatesSchema = z.object({ companyId: id, q: z.string().trim().max(120).default("") });
export const companyUserBulkSchema = z.object({
  companyId: id,
  userIds: z.array(id).min(1).max(BULK_MAX),
  operation: z.discriminatedUnion("type", [
    z.object({ type: z.literal("department"), departmentId: id }),
    z.object({ type: z.literal("project"), projectId: id }),
    z.object({ type: z.literal("suspend") }),
  ]),
  reason,
});

type Tx = Prisma.TransactionClient;
export type CompanyUserSource = "DIRECT" | "GROUP" | "BOTH";

type CompanyRef = { id: string; name: string; parentGroupId: string };

/** The company, only if the actor reaches it; a foreign company is a 403, never a hint that it exists (§111, §112). */
async function companyFor(actor: GroupActor, companyId: string, capability: "users.view" | "users.manage", options: { open?: boolean } = {}): Promise<CompanyRef> {
  const company = await prisma.company.findFirst({ where: { id: companyId, parentGroup: { isTestFixture: false } }, select: { id: true, name: true, status: true, parentGroupId: true } });
  if (!company) throw new AccessError("FORBIDDEN");
  assertGroupCan(actor, capability, company.parentGroupId);
  if (options.open && company.status !== "ACTIVE") {
    throw new AccessError("CONFLICT", `${company.name} is ${company.status.toLowerCase()}. Reactivate it before changing its users.`, { code: "ORGANIZATION_NOT_ACTIVE" });
  }
  return { id: company.id, name: company.name, parentGroupId: company.parentGroupId };
}

/** The people whose seat's policy covers this company right now, with the group role it gives them (§12, §118, §120). */
async function groupCoverage(company: CompanyRef): Promise<Map<string, { seatId: string; roleName: string; roleKey: string; mode: CompanyAccessMode }>> {
  const group = await prisma.parentGroup.findUnique({ where: { id: company.parentGroupId }, select: { status: true, kind: true } });
  if (!group || group.kind !== "GROUP" || !USABLE_GROUP.includes(group.status)) return new Map();
  const seats = await prisma.parentGroupMember.findMany({
    where: {
      parentGroupId: company.parentGroupId, status: "ACTIVE", roleId: { not: null }, user: { status: "ACTIVE" },
      OR: [{ companyAccessMode: "ALL" }, { companyAccessMode: "SELECTED", companies: { some: { companyId: company.id } } }],
    },
    select: { id: true, userId: true, companyAccessMode: true, role: { select: { key: true, name: true } } },
  });
  return new Map(seats.filter((seat) => seat.role).map((seat) => [seat.userId, { seatId: seat.id, roleName: seat.role!.name, roleKey: seat.role!.key, mode: seat.companyAccessMode }]));
}

const memberSelect = {
  id: true, status: true, jobTitle: true, groupDerived: true, accessVersion: true, joinedAt: true, createdAt: true,
  user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, status: true } },
  role: { select: { key: true, name: true } },
  department: { select: { id: true, name: true } },
  ceoOf: { select: { id: true } },
  _count: { select: { projectMemberships: { where: { status: "ACTIVE" as const, project: { archivedAt: null } } } } },
} satisfies Prisma.CompanyMemberSelect;
type MemberRow = Prisma.CompanyMemberGetPayload<{ select: typeof memberSelect }>;

export type CompanyUserRow = {
  userId: string;
  membershipId: string;
  name: string;
  username: string;
  email: string | null;
  /** The company's own role; null when the person is here only through the group. */
  directRole: string | null;
  directRoleKey: string | null;
  /** The group role covering the company; null when the access is only direct. */
  groupRole: string | null;
  department: { id: string; name: string } | null;
  jobTitle: string | null;
  source: CompanyUserSource;
  /** The direct membership's own status. */
  membershipStatus: MembershipStatus;
  accountStatus: string;
  /** What actually applies: an unusable account beats everything (§75, §76). */
  effective: "ACTIVE" | "PENDING" | "SUSPENDED" | "ACCOUNT_SUSPENDED";
  projects: number;
  isCeo: boolean;
  version: number;
};

function toRow(row: MemberRow, coverage: Map<string, { roleName: string; roleKey: string }>): CompanyUserRow {
  const seat = coverage.get(row.user.id) ?? null;
  const source: CompanyUserSource = row.groupDerived ? "GROUP" : seat ? "BOTH" : "DIRECT";
  const accountOk = row.user.status === "ACTIVE";
  return {
    userId: row.user.id, membershipId: row.id,
    name: `${row.user.firstName} ${row.user.lastName}`, username: row.user.username, email: row.user.email,
    directRole: row.groupDerived ? null : row.role.name, directRoleKey: row.groupDerived ? null : row.role.key,
    groupRole: source === "DIRECT" ? null : seat?.roleName ?? row.role.name,
    department: row.department, jobTitle: row.jobTitle, source,
    membershipStatus: row.status, accountStatus: row.user.status,
    effective: !accountOk ? "ACCOUNT_SUSPENDED" : row.status === "ACTIVE" ? "ACTIVE" : row.status === "INVITED" ? "PENDING" : "SUSPENDED",
    projects: row._count.projectMemberships, isCeo: Boolean(row.ceoOf), version: row.accessVersion,
  };
}

/**
 * The company's effective users (§17, §120-§124): direct and group-derived in
 * one query, one row per person, filtered, sorted and paged on the server.
 */
export async function listCompanyUsers(actor: GroupActor, raw: unknown) {
  const input = companyUsersListSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.view");
  const coverage = await groupCoverage(company);
  const covered = [...coverage.keys()];
  const contains = input.q ? { contains: input.q, mode: "insensitive" as const } : undefined;
  const where: Prisma.CompanyMemberWhereInput = {
    companyId: company.id, archivedAt: null, status: input.status ? input.status : { in: LISTED },
    ...(input.role ? { role: { key: input.role } } : {}),
    ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    ...(input.projectId ? { projectMemberships: { some: { projectId: input.projectId, status: "ACTIVE" } } } : {}),
    ...(contains ? { user: { OR: [{ firstName: contains }, { lastName: contains }, { username: contains }, { email: contains }] } } : {}),
    ...(input.source === "GROUP" ? { groupDerived: true } : {}),
    ...(input.source === "BOTH" ? { groupDerived: false, userId: { in: covered } } : {}),
    ...(input.source === "DIRECT" ? { groupDerived: false, userId: { notIn: covered } } : {}),
  };
  const orderBy: Prisma.CompanyMemberOrderByWithRelationInput[] =
    input.sort === "role" ? [{ role: { name: "asc" } }, { user: { lastName: "asc" } }, { id: "asc" }]
      : input.sort === "department" ? [{ department: { name: "asc" } }, { user: { lastName: "asc" } }, { id: "asc" }]
      : input.sort === "recent" ? [{ createdAt: "desc" }, { id: "desc" }]
      : [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }, { id: "asc" }];
  const [rows, total] = await Promise.all([
    prisma.companyMember.findMany({ where, orderBy, take: PAGE + 1, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}), select: memberSelect }),
    prisma.companyMember.count({ where }),
  ]);
  const page = rows.slice(0, PAGE);
  return {
    company: { id: company.id, name: company.name },
    total,
    rows: page.map((row) => toRow(row, coverage)),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
    can: { manage: actor.can("users.manage", company.parentGroupId) },
  };
}

/** The pickers the Add and Edit forms need, from this company only (§24, §29, §31). */
export async function companyUserOptions(actor: GroupActor, raw: unknown) {
  const input = z.object({ companyId: id }).parse(raw);
  const company = await companyFor(actor, input.companyId, "users.view");
  const [roles, departments, projects] = await Promise.all([
    prisma.role.findMany({ where: { key: { in: COMPANY_ROLE_KEYS } }, select: { key: true, name: true } }),
    prisma.department.findMany({ where: { companyId: company.id, status: "ACTIVE" }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    prisma.project.findMany({ where: { companyId: company.id, archivedAt: null }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  const order = new Map(COMPANY_ROLE_KEYS.map((key, index) => [key as string, index]));
  return { roles: roles.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)), departments, projects };
}

export type CompanyUserDetail = CompanyUserRow & {
  company: { id: string; name: string };
  joinedAt: string | null;
  groupAccess: { groupName: string; roleName: string; mode: CompanyAccessMode } | null;
  projectAccess: { projectId: string; projectName: string; role: string | null }[];
  activity: { rows: CompanyUserActivityRow[]; nextCursor: string | null };
  /** What this actor may do with this person; the UI offers only what is true (§44, §81). */
  can: { manage: boolean; editAccess: boolean; editRole: boolean; suspend: boolean; reactivate: boolean; removeDirect: boolean; manageGroupAccess: boolean };
  isSelf: boolean;
};
export type CompanyUserActivityRow = { id: string; actionKey: string; occurredAt: string; actorName: string | null; detail: string | null };

const ACTIVITY_ACTIONS: string[] = [
  AuditAction.PLATFORM_ORGANIZATION_USER_ADDED,
  AuditAction.PLATFORM_ORGANIZATION_USER_REMOVED,
  AuditAction.PLATFORM_ORGANIZATION_USER_PROJECTS_CHANGED,
  AuditAction.PLATFORM_MEMBERSHIP_CHANGED,
  AuditAction.COMPANY_USER_ACCESS_CHANGED,
  AuditAction.COMPANY_USER_ACCESS_SUSPENDED,
  AuditAction.COMPANY_USER_ACCESS_REACTIVATED,
  AuditAction.COMPANY_DIRECT_ACCESS_REMOVED,
  AuditAction.PLATFORM_COMPANY_CEO_ASSIGNED,
  AuditAction.PLATFORM_COMPANY_CEO_REPLACED,
  AuditAction.PLATFORM_COMPANY_CEO_REMOVED,
];

function activityDetail(actionKey: string, before: Record<string, unknown>, after: Record<string, unknown>): string | null {
  if (actionKey === AuditAction.COMPANY_USER_ACCESS_CHANGED || actionKey === AuditAction.PLATFORM_MEMBERSHIP_CHANGED) {
    const parts: string[] = [];
    if (before.roleKey !== after.roleKey && after.roleKey) parts.push(`role ${String(before.roleKey ?? "—")} → ${String(after.roleKey)}`);
    if (before.jobTitle !== after.jobTitle && after.jobTitle !== undefined) parts.push("position changed");
    if (before.departmentId !== after.departmentId && after.departmentId !== undefined) parts.push("department changed");
    return parts.join(", ") || null;
  }
  if (actionKey === AuditAction.COMPANY_DIRECT_ACCESS_REMOVED && after.stillViaGroup) return "Access continues through the group";
  return null;
}

async function activityFor(company: CompanyRef, userId: string, membershipId: string | null, cursor?: string) {
  const rows = await prisma.auditEvent.findMany({
    where: {
      companyId: company.id, actionKey: { in: ACTIVITY_ACTIONS },
      OR: [{ entityType: "User", entityId: userId }, ...(membershipId ? [{ entityType: "CompanyMember", entityId: membershipId }] : [])],
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: 11,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, actionKey: true, occurredAt: true, actorDisplayNameSnapshot: true, beforeJson: true, afterJson: true },
  });
  const page = rows.slice(0, 10).map((row): CompanyUserActivityRow => ({
    id: row.id, actionKey: row.actionKey, occurredAt: row.occurredAt.toISOString(), actorName: row.actorDisplayNameSnapshot,
    detail: activityDetail(row.actionKey, (row.beforeJson ?? {}) as Record<string, unknown>, (row.afterJson ?? {}) as Record<string, unknown>),
  }));
  return { rows: page, nextCursor: rows.length > 10 ? page[page.length - 1].id : null };
}

/** Company-contextual events about this person, and only this company's (§95, §96). */
export async function companyUserActivity(actor: GroupActor, raw: unknown) {
  const input = companyUserActivitySchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.view");
  const member = await prisma.companyMember.findFirst({ where: { companyId: company.id, userId: input.userId, archivedAt: null }, select: { id: true } });
  return activityFor(company, input.userId, member?.id ?? null, input.cursor);
}

async function loadMember(companyId: string, userId: string) {
  return assertFound(await prisma.companyMember.findFirst({ where: { companyId, userId, archivedAt: null, status: { in: LISTED } }, select: memberSelect }));
}

/** One person's relationship with this company (§37-§47, §117). The person must be one of the company's users. */
export async function getCompanyUserDetail(actor: GroupActor, raw: unknown): Promise<CompanyUserDetail> {
  const input = companyUserSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.view");
  const [member, coverage] = await Promise.all([loadMember(company.id, input.userId), groupCoverage(company)]);
  const row = toRow(member, coverage);
  const [projects, activity, group] = await Promise.all([
    prisma.projectMember.findMany({
      where: { companyMemberId: member.id, status: "ACTIVE", project: { archivedAt: null } },
      orderBy: [{ project: { name: "asc" } }, { id: "asc" }], take: 100,
      select: { projectId: true, projectRole: true, project: { select: { name: true } } },
    }),
    activityFor(company, input.userId, member.id),
    prisma.parentGroup.findUnique({ where: { id: company.parentGroupId }, select: { name: true } }),
  ]);
  const seat = coverage.get(input.userId) ?? null;
  const manage = actor.can("users.manage", company.parentGroupId);
  const isSelf = actor.userId === input.userId;
  const direct = row.source !== "GROUP";
  return {
    ...row,
    company: { id: company.id, name: company.name },
    joinedAt: member.joinedAt?.toISOString() ?? null,
    groupAccess: seat && group ? { groupName: group.name, roleName: seat.roleName, mode: seat.mode } : null,
    projectAccess: projects.map((place) => ({ projectId: place.projectId, projectName: place.project.name, role: place.projectRole })),
    activity,
    can: {
      manage,
      editAccess: manage && direct,
      editRole: manage && direct && !row.isCeo,
      suspend: manage && row.source === "DIRECT" && row.membershipStatus === "ACTIVE" && !row.isCeo && !isSelf,
      reactivate: manage && direct && row.membershipStatus === "SUSPENDED",
      removeDirect: manage && direct && !row.isCeo && !isSelf,
      manageGroupAccess: manage && row.source !== "DIRECT",
    },
    isSelf,
  };
}

/** Why a direct change cannot be made on this row; the same rules guard the UI's menu and the server (§44, §53, §78, §79, §80). */
function assertDirect(row: CompanyUserRow, kind: "role" | "other" | "suspend" | "remove", selfUserId: string) {
  if (row.source === "GROUP") {
    throw new AccessError("CONFLICT", "This person's access is provided by the parent group. Change it in the group, or add direct company access first.", { code: "GROUP_ONLY" });
  }
  if (row.isCeo && kind !== "other") {
    throw new AccessError("CONFLICT", `${row.name} is the current Company CEO. Use Change CEO to modify company leadership.`, { code: "IS_COMPANY_CEO" });
  }
  if ((kind === "suspend" || kind === "remove") && row.userId === selfUserId) {
    throw new AccessError("CONFLICT", "You cannot remove or suspend your own access. Ask another administrator.", { code: "SELF_LOCKOUT" });
  }
  if (kind === "suspend" && row.source === "BOTH") {
    throw new AccessError("CONFLICT", "This person also has access through the group, so direct access cannot be suspended on its own. Remove the direct access instead; group access continues.", { code: "SUSPEND_MIXED" });
  }
}

async function departmentOf(tx: Tx, company: CompanyRef, departmentId: string) {
  const branch = await tx.department.findFirst({ where: { id: departmentId, companyId: company.id, status: "ACTIVE" }, select: { id: true, groupDepartmentId: true } });
  // A department of another company or group is refused, whole request (§115).
  if (!branch) throw new AccessError("VALIDATION_ERROR", "Choose a department of this company.", { field: "departmentId" });
  return branch;
}

/** Puts the person in this department: the member row and the placement history, in step (§28, §54). */
async function placeIn(tx: Tx, company: CompanyRef, input: { userId: string; roleKey: string; actorUserId: string; branch: { id: string; groupDepartmentId: string | null } | null }) {
  const now = new Date();
  await tx.departmentAssignment.updateMany({
    where: { userId: input.userId, companyId: company.id, status: "ACTIVE", companyDepartmentId: input.branch ? { not: input.branch.id } : undefined },
    data: { status: "INACTIVE", endsAt: now, endedByUserId: input.actorUserId },
  });
  if (input.branch && (await tx.departmentAssignment.count({ where: { userId: input.userId, companyId: company.id, companyDepartmentId: input.branch.id, status: "ACTIVE" } })) === 0) {
    await memberPlace(tx, { parentGroupId: company.parentGroupId, userId: input.userId, companyId: company.id, branch: input.branch, roleKey: input.roleKey, actorUserId: input.actorUserId });
  }
}

/** The department a role works in here when the form leaves it blank: the same default PRD #7 gave new users. */
async function defaultBranch(tx: Tx, company: CompanyRef, role: string) {
  return tx.department.findFirst({ where: { companyId: company.id, status: "ACTIVE", groupDepartment: { key: departmentKeyFor(role), status: "ACTIVE" } }, select: { id: true, groupDepartmentId: true } });
}

/**
 * Edit Access (§48-§54, §136): role, department, position and projects in one
 * transaction, only what the form actually changed, idempotent, audited.
 * The group role is never touched here, and the CEO's role only through PRD #12.
 */
export async function updateCompanyUserAccess(actor: GroupActor, raw: unknown): Promise<{ changed: boolean; version: number }> {
  const input = companyUserUpdateSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.manage", { open: true });
  const [member, coverage] = await Promise.all([loadMember(company.id, input.userId), groupCoverage(company)]);
  const row = toRow(member, coverage);
  const roleChange = input.roleKey !== undefined && input.roleKey !== row.directRoleKey;
  assertDirect(row, roleChange ? "role" : "other", actor.userId);
  if (roleChange) await assertNotCompanyCeo(prisma, member.id);
  if (input.expectedVersion !== undefined && input.expectedVersion !== member.accessVersion) {
    throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
  }

  return prisma.$transaction(async (tx) => {
    const newRoleKey = roleChange ? input.roleKey! : member.role.key;
    const role = roleChange ? assertFound(await tx.role.findUnique({ where: { key: newRoleKey }, select: { id: true } })) : null;
    const departmentChange = input.departmentId !== undefined && (input.departmentId ?? null) !== (member.department?.id ?? null);
    const branch = departmentChange && input.departmentId ? await departmentOf(tx, company, input.departmentId) : null;
    const titleChange = input.jobTitle !== undefined && (input.jobTitle || null) !== (member.jobTitle ?? null);
    const currentProjects = (await tx.projectMember.findMany({ where: { companyMemberId: member.id, companyId: company.id, status: "ACTIVE" }, select: { projectId: true } })).map((place) => place.projectId).sort();
    const nextProjects = input.projectIds ? await companyProjects(tx, company.id, input.projectIds) : null;
    const projectChange = nextProjects !== null && [...nextProjects].sort().join() !== currentProjects.join();

    if (!roleChange && !departmentChange && !titleChange && !projectChange) return { changed: false, version: member.accessVersion };
    // A suspended membership is not edited into activity; reactivate it first.
    if (projectChange && member.status !== "ACTIVE") throw new AccessError("CONFLICT", "Reactivate this person's company access before giving them projects.", { code: "NOT_ACTIVE" });

    // Version-guarded write: a concurrent change makes this update match nothing (§135).
    const written = await tx.companyMember.updateMany({
      where: { id: member.id, companyId: company.id, status: member.status, accessVersion: member.accessVersion },
      data: {
        roleId: role?.id,
        departmentId: departmentChange ? branch?.id ?? null : undefined,
        jobTitle: titleChange ? input.jobTitle || null : undefined,
        accessVersion: { increment: 1 },
      },
    });
    if (written.count === 0) throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
    if (departmentChange) await placeIn(tx, company, { userId: member.user.id, roleKey: newRoleKey, actorUserId: actor.userId, branch });
    if (projectChange && nextProjects) await syncProjects(tx, company.id, member.id, nextProjects);
    // The next request builds its access afresh from the new role; the person is not signed out (§130).
    if (roleChange) await revokeSessions(tx, { membershipId: member.id, relocate: false });

    const entity = { type: "CompanyMember", id: member.id, label: `${row.name} · ${company.name}` };
    if (roleChange || departmentChange || titleChange) {
      await recordPlatformAction(actor, company.parentGroupId, {
        actionKey: AuditAction.COMPANY_USER_ACCESS_CHANGED, entity,
        before: { companyId: company.id, userId: member.user.id, roleKey: member.role.key, departmentId: member.department?.id ?? null, jobTitle: member.jobTitle ?? null },
        after: { companyId: company.id, userId: member.user.id, roleKey: newRoleKey, departmentId: departmentChange ? branch?.id ?? null : member.department?.id ?? null, jobTitle: titleChange ? input.jobTitle || null : member.jobTitle ?? null },
        reason: input.reason,
      }, { tx, companyId: company.id });
    }
    if (projectChange && nextProjects) {
      await recordPlatformAction(actor, company.parentGroupId, {
        actionKey: AuditAction.PLATFORM_ORGANIZATION_USER_PROJECTS_CHANGED, entity,
        before: { companyId: company.id, userId: member.user.id, projectIds: currentProjects },
        after: { companyId: company.id, userId: member.user.id, projectIds: [...nextProjects].sort() },
        reason: input.reason,
      }, { tx, companyId: company.id });
    }
    return { changed: true, version: member.accessVersion + 1 };
  });
}

export type CompanyUserAdded = { userId: string; membershipId: string; username: string; source: CompanyUserSource; temporaryPassword?: string };

/**
 * Add User (§18-§36, §94): a new account or an existing one, given direct
 * access with a required role. A person who already reaches the company through
 * the group gains a direct source on the same row (BOTH), and the group seat
 * is untouched. One transaction, or none of it.
 */
export async function addCompanyUser(actor: GroupActor, raw: unknown): Promise<CompanyUserAdded> {
  const input = companyUserAddSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.manage", { open: true });
  const role = assertFound(await prisma.role.findUnique({ where: { key: input.roleKey }, select: { id: true } }));

  if (input.mode === "new") {
    // One identity per address (§22): offer the account that already exists.
    const existing = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true, firstName: true, lastName: true } });
    if (existing) {
      throw new AccessError("CONFLICT", `A NESTO account already exists for this email. Add ${existing.firstName} ${existing.lastName} to ${company.name} instead?`, { code: "ACCOUNT_EXISTS", field: "email", userId: existing.id, name: `${existing.firstName} ${existing.lastName}` });
    }
    return prisma.$transaction(async (tx) => {
      const projectIds = await companyProjects(tx, company.id, input.projectIds);
      await assertWithinLimit(tx, company.id, "users");
      const branch = input.departmentId ? await departmentOf(tx, company, input.departmentId) : await defaultBranch(tx, company, input.roleKey);
      const person = await tx.personProfile.create({ data: { parentGroupId: company.parentGroupId, firstName: input.firstName, lastName: input.lastName, workEmail: input.email, lifecycleStatus: "EMPLOYEE", createdByUserId: actor.userId }, select: { id: true } });
      const account = await createProvisionedUser(tx, { personProfileId: person.id, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: null, username: null, temporaryPassword: DEFAULT_PASSWORD, expiresAt: null });
      const member = await tx.companyMember.create({ data: { companyId: company.id, userId: account.id, roleId: role.id, departmentId: branch?.id ?? null, jobTitle: input.jobTitle || null, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } });
      await placeIn(tx, company, { userId: account.id, roleKey: input.roleKey, actorUserId: actor.userId, branch });
      await syncProjects(tx, company.id, member.id, projectIds);
      await recordPlatformAction(actor, company.parentGroupId, { actionKey: AuditAction.PLATFORM_ORGANIZATION_USER_ADDED, entity: { type: "User", id: account.id, label: `${input.firstName} ${input.lastName} · ${company.name}` }, after: { companyId: company.id, userId: account.id, roleKey: input.roleKey, status: "ACTIVE", projectIds, newAccount: true, username: account.username }, reason: input.reason }, { tx, companyId: company.id });
      return { userId: account.id, membershipId: member.id, username: account.username, source: "DIRECT" as const, temporaryPassword: DEFAULT_PASSWORD };
    });
  }

  const user = assertFound(await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, username: true, firstName: true, lastName: true, platformAccess: { select: { status: true } }, personProfile: { select: { parentGroupId: true } } } }));
  if (user.platformAccess?.status === "ACTIVE") throw new AccessError("VALIDATION_ERROR", "A Platform Admin account cannot hold a company membership.");
  // Someone from another organization is not this company's to add (§21, §113).
  if (!user.personProfile || user.personProfile.parentGroupId !== company.parentGroupId) throw new AccessError("VALIDATION_ERROR", `${user.firstName} ${user.lastName} belongs to another organization and cannot join ${company.name}.`, { code: "OTHER_ORGANIZATION" });
  return prisma.$transaction(async (tx) => {
    // Read under the transaction so two submissions cannot both create (§137).
    const previous = await tx.companyMember.findFirst({ where: { companyId: company.id, userId: user.id, archivedAt: null }, select: { id: true, status: true, groupDerived: true } });
    if (previous && previous.status !== "INACTIVE" && !previous.groupDerived) throw new AccessError("CONFLICT", `${user.firstName} ${user.lastName} already has direct access to ${company.name}.`, { code: "ALREADY_MEMBER" });
    const projectIds = await companyProjects(tx, company.id, input.projectIds);
    if (!previous || previous.status === "INACTIVE") await assertWithinLimit(tx, company.id, "users");
    const branch = input.departmentId ? await departmentOf(tx, company, input.departmentId) : await defaultBranch(tx, company, input.roleKey);
    const data = { roleId: role.id, departmentId: branch?.id ?? null, jobTitle: input.jobTitle || null, status: "ACTIVE" as const, groupDerived: false, joinedAt: new Date(), deactivatedAt: null, deactivatedByMemberId: null };
    let membershipId: string;
    if (previous) {
      // The group's row or a former membership becomes the direct one: one membership per person and company.
      await tx.companyMember.updateMany({ where: { id: previous.id, status: previous.status }, data: { ...data, accessVersion: { increment: 1 } } });
      await revokeSessions(tx, { membershipId: previous.id, relocate: false });
      membershipId = previous.id;
    } else {
      membershipId = (await tx.companyMember.create({ data: { companyId: company.id, userId: user.id, ...data }, select: { id: true } })).id;
    }
    await placeIn(tx, company, { userId: user.id, roleKey: input.roleKey, actorUserId: actor.userId, branch });
    await syncProjects(tx, company.id, membershipId, projectIds);
    const viaGroup = (await groupCoverage(company)).has(user.id);
    await recordPlatformAction(actor, company.parentGroupId, { actionKey: AuditAction.PLATFORM_ORGANIZATION_USER_ADDED, entity: { type: "User", id: user.id, label: `${user.firstName} ${user.lastName} · ${company.name}` }, before: previous ? { companyId: company.id, userId: user.id, status: previous.status } : undefined, after: { companyId: company.id, userId: user.id, roleKey: input.roleKey, status: "ACTIVE", projectIds, newAccount: false }, reason: input.reason }, { tx, companyId: company.id });
    return { userId: user.id, membershipId, username: user.username, source: viaGroup ? ("BOTH" as const) : ("DIRECT" as const) };
  });
}

/**
 * Who the Add form offers (§20, §21): people of this company's own organization
 * who do not already hold direct access, the ones the group already gives access
 * to first. Never the whole identity directory.
 */
export async function searchCompanyUserCandidates(actor: GroupActor, raw: unknown) {
  const input = companyUserCandidatesSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.manage");
  const contains = { contains: input.q, mode: "insensitive" as const };
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      personProfile: { parentGroupId: company.parentGroupId },
      OR: [{ platformAccess: { is: null } }, { platformAccess: { is: { status: { not: "ACTIVE" } } } }],
      // Anyone already holding a direct row here is in the list, not the picker.
      memberships: { none: { companyId: company.id, status: { in: LISTED }, archivedAt: null, groupDerived: false } },
      ...(input.q ? { AND: [{ OR: [{ firstName: contains }, { lastName: contains }, { username: contains }, { email: contains }] }] } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: 20,
    select: { id: true, firstName: true, lastName: true, username: true, email: true, parentGroupMemberships: { where: { parentGroupId: company.parentGroupId, status: "ACTIVE" }, select: { role: { select: { name: true } } } } },
  });
  const coverage = await groupCoverage(company);
  return rows
    .map((row) => ({
      id: row.id, name: `${row.firstName} ${row.lastName}`, username: row.username, email: row.email,
      groupRole: row.parentGroupMemberships[0]?.role?.name ?? null,
      viaGroup: coverage.has(row.id),
    }))
    .sort((a, b) => Number(b.viaGroup) - Number(a.viaGroup));
}

export type CompanyUserRemovalPreview = {
  name: string;
  kind: "DIRECT" | "BOTH" | "GROUP_ONLY";
  roleName: string | null;
  projects: string[];
  /** What the person keeps through the group; null when nothing does. */
  stillViaGroup: { roleName: string } | null;
  blocked: "COMPANY_CEO" | "SELF" | "GROUP_ONLY" | null;
};

/** What removing the direct access will really do, worked out here and not guessed in the browser (§61-§67). */
export async function previewCompanyUserRemoval(actor: GroupActor, raw: unknown): Promise<CompanyUserRemovalPreview> {
  const input = companyUserSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.manage");
  const [member, coverage] = await Promise.all([loadMember(company.id, input.userId), groupCoverage(company)]);
  const row = toRow(member, coverage);
  const projects = await prisma.projectMember.findMany({ where: { companyMemberId: member.id, status: "ACTIVE", project: { archivedAt: null } }, orderBy: { project: { name: "asc" } }, select: { project: { select: { name: true } } } });
  const seat = coverage.get(input.userId) ?? null;
  return {
    name: row.name,
    kind: row.source === "GROUP" ? "GROUP_ONLY" : row.source === "BOTH" ? "BOTH" : "DIRECT",
    roleName: row.directRole,
    projects: projects.map((place) => place.project.name),
    stillViaGroup: seat ? { roleName: seat.roleName } : null,
    blocked: row.source === "GROUP" ? "GROUP_ONLY" : row.isCeo ? "COMPANY_CEO" : row.userId === actor.userId ? "SELF" : null,
  };
}

/**
 * Removes the person's direct access to this company (§61-§69, §99). Their
 * project places here end with it. The account, other companies and the group
 * seat are untouched; when the seat still covers the company the access carries
 * on as a group-derived row and the answer says so.
 */
export async function removeCompanyUserAccess(actor: GroupActor, raw: unknown): Promise<{ stillViaGroup: boolean }> {
  const input = companyUserStatusSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.manage", { open: true });
  const [member, coverage] = await Promise.all([loadMember(company.id, input.userId), groupCoverage(company)]);
  const row = toRow(member, coverage);
  assertDirect(row, "remove", actor.userId);
  await assertNotCompanyCeo(prisma, member.id);
  if (input.expectedVersion !== undefined && input.expectedVersion !== member.accessVersion) {
    throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
  }
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const ended = await tx.projectMember.updateMany({ where: { companyMemberId: member.id, companyId: company.id, status: "ACTIVE" }, data: { status: "INACTIVE", leftAt: now } });
    const written = await tx.companyMember.updateMany({ where: { id: member.id, companyId: company.id, status: { in: LISTED }, groupDerived: false }, data: { status: "INACTIVE", deactivatedAt: now, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
    if (written.count === 0) throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
    await revokeSessions(tx, { membershipId: member.id, relocate: true });
    // Where the seat still covers the company its own membership comes back (PRD #10); the answer reads the same coverage.
    const seat = coverage.get(input.userId);
    if (seat) {
      await syncSeatAccess(tx, { seatId: seat.seatId, actorUserId: actor.userId, companyId: company.id });
    }
    const stillViaGroup = Boolean(seat);
    await recordPlatformAction(actor, company.parentGroupId, {
      actionKey: AuditAction.COMPANY_DIRECT_ACCESS_REMOVED,
      entity: { type: "CompanyMember", id: member.id, label: `${row.name} · ${company.name}` },
      before: { companyId: company.id, userId: member.user.id, roleKey: member.role.key, status: member.status },
      after: { companyId: company.id, userId: member.user.id, status: "INACTIVE", stillViaGroup, projectsEnded: ended.count },
      reason: input.reason,
    }, { tx, companyId: company.id });
    return { stillViaGroup };
  });
}

async function setDirectStatus(actor: GroupActor, raw: unknown, next: "SUSPENDED" | "ACTIVE") {
  const input = companyUserStatusSchema.parse(raw);
  const company = await companyFor(actor, input.companyId, "users.manage", { open: true });
  const [member, coverage] = await Promise.all([loadMember(company.id, input.userId), groupCoverage(company)]);
  const row = toRow(member, coverage);
  assertDirect(row, next === "SUSPENDED" ? "suspend" : "other", actor.userId);
  if (next === "SUSPENDED") await assertNotCompanyCeo(prisma, member.id);
  if (member.status === next) return { status: next };
  if (next === "ACTIVE" && member.status !== "SUSPENDED") throw new AccessError("CONFLICT", "Only suspended company access can be reactivated.", { code: "NOT_SUSPENDED" });
  if (next === "SUSPENDED" && member.status !== "ACTIVE") throw new AccessError("CONFLICT", "Only active company access can be suspended.", { code: "NOT_ACTIVE" });
  if (input.expectedVersion !== undefined && input.expectedVersion !== member.accessVersion) {
    throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
  }
  return prisma.$transaction(async (tx) => {
    if (next === "ACTIVE") await assertWithinLimit(tx, company.id, "users");
    const written = await tx.companyMember.updateMany({ where: { id: member.id, companyId: company.id, status: member.status, accessVersion: member.accessVersion }, data: { status: next, accessVersion: { increment: 1 } } });
    if (written.count === 0) throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
    // The company's access ends on the next request; the person's account, group seat and other companies are untouched (§70).
    if (next === "SUSPENDED") await revokeSessions(tx, { membershipId: member.id, relocate: true });
    await recordPlatformAction(actor, company.parentGroupId, {
      actionKey: next === "SUSPENDED" ? AuditAction.COMPANY_USER_ACCESS_SUSPENDED : AuditAction.COMPANY_USER_ACCESS_REACTIVATED,
      entity: { type: "CompanyMember", id: member.id, label: `${row.name} · ${company.name}` },
      before: { companyId: company.id, userId: member.user.id, roleKey: member.role.key, status: member.status },
      after: { companyId: company.id, userId: member.user.id, roleKey: member.role.key, status: next },
      reason: input.reason,
    }, { tx, companyId: company.id });
    return { status: next };
  });
}

export const suspendCompanyUserAccess = (actor: GroupActor, raw: unknown) => setDirectStatus(actor, raw, "SUSPENDED");
export const reactivateCompanyUserAccess = (actor: GroupActor, raw: unknown) => setDirectStatus(actor, raw, "ACTIVE");

export type CompanyUserBulkResult = { done: string[]; skipped: { userId: string; reason: string }[] };

/**
 * Safe routine operations on several people (§82-§85). Each person is its own
 * transaction and the answer lists who was changed and who was skipped and why,
 * so a partial result is explicit. Group-only rows are skipped, never mutated.
 */
export async function bulkCompanyUsers(actor: GroupActor, raw: unknown): Promise<CompanyUserBulkResult> {
  const input = companyUserBulkSchema.parse(raw);
  await companyFor(actor, input.companyId, "users.manage", { open: true });
  const result: CompanyUserBulkResult = { done: [], skipped: [] };
  for (const userId of [...new Set(input.userIds)]) {
    try {
      const { operation } = input;
      if (operation.type === "suspend") {
        await suspendCompanyUserAccess(actor, { companyId: input.companyId, userId, reason: input.reason });
      } else if (operation.type === "department") {
        await updateCompanyUserAccess(actor, { companyId: input.companyId, userId, departmentId: operation.departmentId, reason: input.reason });
      } else {
        const current = await prisma.projectMember.findMany({ where: { companyId: input.companyId, member: { userId }, status: "ACTIVE" }, select: { projectId: true } });
        await updateCompanyUserAccess(actor, { companyId: input.companyId, userId, projectIds: [...new Set([...current.map((place) => place.projectId), operation.projectId])], reason: input.reason });
      }
      result.done.push(userId);
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      result.skipped.push({ userId, reason: (error.details as { code?: string } | undefined)?.code === "GROUP_ONLY" ? "Access is managed by the parent group." : error.message });
    }
  }
  return result;
}
