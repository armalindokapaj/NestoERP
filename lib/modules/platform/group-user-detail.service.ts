import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { revokeSessions } from "@/lib/auth/session-store";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { coveredCompanyIds, syncSeatAccess, type CompanyAccessSource } from "@/lib/modules/platform/group-company-access.service";
import { assertGroupCan, type GroupActor } from "@/lib/modules/platform/group-actor";

/**
 * One person's relationship with one parent group (Admin PRD #11): the seat,
 * the group role, where it reaches, what the person holds directly, the
 * projects they work on and what was done to their access. Read and changed
 * from inside the group; the person's global account is not this surface's
 * business.
 *
 * Every request names the group and the person and is answered only when the
 * person has a seat in that group. The same services serve the Platform Admin
 * and the group's own seats; what each may do is a capability, never a role name.
 */

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().max(500).optional().transform((value) => value || "Group administration");
export const groupUserDetailSchema = z.object({ groupId: id, userId: id });
export const groupUserActivitySchema = z.object({ groupId: id, userId: id, cursor: id.optional() });
export const groupUserSuspendSchema = z.object({ groupId: id, userId: id, reason });
export const groupUserRemovePreviewSchema = z.object({ groupId: id, userId: id });
export const groupDirectAccessRemoveSchema = z.object({ groupId: id, userId: id, companyId: id, reason });

const USABLE_GROUP = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"];
const COMPANY_ROWS = 50;
const PROJECT_ROWS = 50;
const ACTIVITY_PAGE = 10;

type Tx = Prisma.TransactionClient;

export type GroupUserCompanyRow = {
  companyId: string;
  companyName: string;
  source: Exclude<CompanyAccessSource, "NONE">;
  /** The role the group seat gives here; null when the access is only direct. */
  groupRole: string | null;
  /** The role of the person's own membership in the company; null when the access is only through the group. */
  directRole: string | null;
};
export type GroupUserProjectRow = { projectId: string; projectName: string; companyId: string; companyName: string; role: string; source: "DIRECT" | "VIA_GROUP" };
export type GroupUserActivityRow = { id: string; actionKey: string; occurredAt: string; actorName: string | null; detail: string | null };

export type GroupUserDetail = {
  user: { id: string; name: string; username: string; email: string | null };
  /** The global account's status: suspended here still means the person cannot sign in anywhere. */
  accountStatus: string;
  seatStatus: string;
  joinedAt: string | null;
  roleKey: string | null;
  roleName: string | null;
  /** True when the group role carries group-wide authority (the Group CEO). */
  groupWide: boolean;
  department: string | null;
  companyAccess: { mode: "NONE" | "ALL" | "SELECTED"; version: number; total: number; companies: GroupUserCompanyRow[] };
  projects: { total: number; rows: GroupUserProjectRow[] };
  activity: { rows: GroupUserActivityRow[]; nextCursor: string | null };
  /** What this actor may do with this person; the UI shows only what is true here. */
  can: { manage: boolean; manageCeo: boolean };
  isSelf: boolean;
};

async function seatFor(groupId: string, userId: string) {
  const seat = await prisma.parentGroupMember.findFirst({
    where: { parentGroupId: groupId, userId, parentGroup: { isTestFixture: false, kind: "GROUP" } },
    select: {
      id: true, status: true, joinedAt: true, accessVersion: true, companyAccessMode: true,
      role: { select: { key: true, name: true } },
      parentGroup: { select: { id: true, name: true, status: true } },
      user: { select: { id: true, firstName: true, lastName: true, username: true, email: true, status: true } },
    },
  });
  // A person with no seat here is not this group's to show, whoever else's they are (§72, §118).
  return assertFound(seat);
}

function assertOpen(group: { name: string; status: string }) {
  if (!USABLE_GROUP.includes(group.status)) {
    throw new AccessError("CONFLICT", `${group.name} is ${group.status.toLowerCase()}. Reactivate it before changing its people.`, { code: "ORGANIZATION_NOT_ACTIVE" });
  }
}

function modeLabel(value: unknown): string | null {
  return value === "ALL" || value === "NONE" || value === "SELECTED" ? value : null;
}

/** Recent audit events about this person in this group, newest first, paged (§60-§64, §104). */
export async function groupUserActivity(actor: GroupActor, raw: unknown): Promise<GroupUserDetail["activity"]> {
  const input = groupUserActivitySchema.parse(raw);
  assertGroupCan(actor, "users.view", input.groupId);
  await seatFor(input.groupId, input.userId);
  const rows = await prisma.auditEvent.findMany({
    where: { parentGroupId: input.groupId, entityType: "User", entityId: input.userId, actionKey: { in: ACTIVITY_ACTIONS } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: ACTIVITY_PAGE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: { id: true, actionKey: true, occurredAt: true, actorDisplayNameSnapshot: true, beforeJson: true, afterJson: true },
  });
  const page = rows.slice(0, ACTIVITY_PAGE).map((row): GroupUserActivityRow => {
    const before = (row.beforeJson ?? {}) as Record<string, unknown>;
    const after = (row.afterJson ?? {}) as Record<string, unknown>;
    const from = modeLabel(before.mode);
    const to = modeLabel(after.mode);
    // Only what the policy lets through is ever stored; this adds nothing secret.
    const detail = row.actionKey === AuditAction.GROUP_COMPANY_ACCESS_CHANGED && from && to ? `${from} → ${to}` : null;
    return { id: row.id, actionKey: row.actionKey, occurredAt: row.occurredAt.toISOString(), actorName: row.actorDisplayNameSnapshot, detail };
  });
  return { rows: page, nextCursor: rows.length > ACTIVITY_PAGE ? page[page.length - 1].id : null };
}

const ACTIVITY_ACTIONS: string[] = [
  AuditAction.PLATFORM_GROUP_USER_ADDED,
  AuditAction.PLATFORM_GROUP_USER_REMOVED,
  AuditAction.PLATFORM_GROUP_CEO_REPLACED,
  AuditAction.GROUP_COMPANY_ACCESS_CHANGED,
  AuditAction.GROUP_ACCESS_SUSPENDED,
  AuditAction.GROUP_ACCESS_REACTIVATED,
  AuditAction.GROUP_DIRECT_COMPANY_ACCESS_REMOVED,
];

/** The company rows: one per company, both roads folded into one (§17, §21, §74). */
async function effectiveCompanies(seat: { id: string; role: { name: string } | null }, groupId: string, userId: string) {
  const [covered, direct] = await Promise.all([
    coveredCompanyIds(prisma, seat.id),
    prisma.companyMember.findMany({
      where: { userId, status: "ACTIVE", archivedAt: null, groupDerived: false, company: { parentGroupId: groupId, status: "ACTIVE" } },
      select: { companyId: true, role: { select: { name: true } } },
    }),
  ]);
  const directBy = new Map(direct.map((row) => [row.companyId, row.role.name]));
  const ids = [...new Set([...covered, ...directBy.keys()])];
  const names = await prisma.company.findMany({ where: { id: { in: ids } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: COMPANY_ROWS, select: { id: true, name: true } });
  const coveredSet = new Set(covered);
  const rows = names.map((company): GroupUserCompanyRow => {
    const viaGroup = coveredSet.has(company.id);
    const directRole = directBy.get(company.id) ?? null;
    return {
      companyId: company.id, companyName: company.name,
      source: viaGroup && directRole ? "BOTH" : viaGroup ? "GROUP_DERIVED" : "DIRECT_COMPANY",
      groupRole: viaGroup ? seat.role?.name ?? null : null, directRole,
    };
  });
  return { total: ids.length, rows };
}

async function projectAccess(groupId: string, userId: string) {
  const where: Prisma.ProjectMemberWhereInput = { status: "ACTIVE", member: { userId, status: "ACTIVE", archivedAt: null, company: { parentGroupId: groupId, status: "ACTIVE" } }, project: { archivedAt: null } };
  const [total, rows] = await Promise.all([
    prisma.projectMember.count({ where }),
    prisma.projectMember.findMany({
      where, orderBy: [{ project: { name: "asc" } }, { id: "asc" }], take: PROJECT_ROWS,
      select: { projectId: true, projectRole: true, project: { select: { name: true } }, member: { select: { groupDerived: true, company: { select: { id: true, name: true } }, role: { select: { name: true } } } } },
    }),
  ]);
  return {
    total,
    rows: rows.map((row): GroupUserProjectRow => ({
      projectId: row.projectId, projectName: row.project.name, companyId: row.member.company.id, companyName: row.member.company.name,
      role: row.projectRole ?? row.member.role.name, source: row.member.groupDerived ? "VIA_GROUP" : "DIRECT",
    })),
  };
}

/**
 * The whole picture of one person in one group (§3, §73). Read-only viewers
 * get the same facts with `can.manage` false, so the UI never offers what the
 * server would refuse (§78-§80).
 */
export async function getGroupUserDetail(actor: GroupActor, raw: unknown): Promise<GroupUserDetail> {
  const input = groupUserDetailSchema.parse(raw);
  // Authorized and related before a single field is read (§71, §72).
  assertGroupCan(actor, "users.view", input.groupId);
  const seat = await seatFor(input.groupId, input.userId);
  const [companies, projects, activity, department] = await Promise.all([
    effectiveCompanies(seat, input.groupId, input.userId),
    projectAccess(input.groupId, input.userId),
    groupUserActivity(actor, input),
    prisma.departmentAssignment.findFirst({
      where: { userId: input.userId, parentGroupId: input.groupId, companyId: null, status: "ACTIVE" },
      select: { groupDepartment: { select: { name: true } } },
    }),
  ]);
  const isCeo = seat.role?.key === "OWNER";
  const canManage = actor.can("users.manage", input.groupId);
  return {
    user: { id: seat.user.id, name: `${seat.user.firstName} ${seat.user.lastName}`, username: seat.user.username, email: seat.user.email },
    accountStatus: seat.user.status,
    seatStatus: seat.status,
    joinedAt: seat.joinedAt?.toISOString() ?? null,
    roleKey: seat.role?.key ?? null,
    roleName: seat.role?.name ?? null,
    groupWide: isCeo && seat.status === "ACTIVE",
    department: department?.groupDepartment?.name ?? null,
    companyAccess: { mode: seat.companyAccessMode, version: seat.accessVersion, ...companies, companies: companies.rows },
    projects,
    activity,
    can: { manage: canManage && (!isCeo || actor.can("ceo.manage", input.groupId)), manageCeo: actor.can("ceo.manage", input.groupId) },
    isSelf: actor.userId === input.userId,
  };
}

/** The only Group CEO holds the group together: no suspension or removal until another is named (§48, §49). */
async function assertNotLastCeo(tx: Tx, groupId: string, userId: string, roleKey: string | null) {
  if (roleKey !== "OWNER") return;
  const owners = await tx.parentGroupMember.count({ where: { parentGroupId: groupId, status: "ACTIVE", role: { key: "OWNER" }, user: { status: "ACTIVE" }, NOT: { userId } } });
  if (owners === 0) throw new AccessError("CONFLICT", "This is the only Group CEO. Assign another Group CEO first.", { code: "LAST_GROUP_ADMIN" });
}

/** Suspend or reactivate the seat: the group role stops or resumes, the account and direct access are untouched (§42-§44). */
async function setSeatStatus(actor: GroupActor, raw: unknown, next: "SUSPENDED" | "ACTIVE") {
  const input = groupUserSuspendSchema.parse(raw);
  assertGroupCan(actor, "users.manage", input.groupId);
  return prisma.$transaction(async (tx) => {
    const seat = assertFound(await tx.parentGroupMember.findFirst({
      where: { parentGroupId: input.groupId, userId: input.userId, parentGroup: { isTestFixture: false, kind: "GROUP" } },
      select: { id: true, status: true, roleId: true, role: { select: { key: true } }, parentGroup: { select: { name: true, status: true } }, user: { select: { firstName: true, lastName: true } } },
    }));
    assertOpen(seat.parentGroup);
    if (seat.role?.key === "OWNER") assertGroupCan(actor, "ceo.manage", input.groupId);
    if (next === "SUSPENDED") {
      if (actor.userId === input.userId) throw new AccessError("CONFLICT", "You cannot suspend your own group access. Ask another administrator.", { code: "SELF_SUSPENSION" });
      if (seat.status !== "ACTIVE") return { status: seat.status };
      await assertNotLastCeo(tx, input.groupId, input.userId, seat.role?.key ?? null);
    } else {
      if (seat.status === "ACTIVE") return { status: seat.status };
      // A removed seat has no role to come back to; adding the person again is the way back.
      if (seat.status !== "SUSPENDED" || !seat.roleId) throw new AccessError("CONFLICT", "Only suspended group access can be reactivated.", { code: "NOT_SUSPENDED" });
    }
    await tx.parentGroupMember.updateMany({ where: { id: seat.id, status: seat.status }, data: { status: next, accessVersion: { increment: 1 } } });
    // Group-derived memberships end or return with the seat; direct ones are never read here.
    const sync = await syncSeatAccess(tx, { seatId: seat.id, actorUserId: actor.userId });
    const entity = { type: "User", id: input.userId, label: `${seat.user.firstName} ${seat.user.lastName} · ${seat.parentGroup.name}` };
    const base = { groupId: input.groupId, userId: input.userId };
    await recordPlatformAction(actor, input.groupId, next === "SUSPENDED"
      ? { actionKey: AuditAction.GROUP_ACCESS_SUSPENDED, entity, before: { ...base, status: "ACTIVE" }, after: { ...base, status: "SUSPENDED", companyAccessEnded: sync.ended }, reason: input.reason }
      : { actionKey: AuditAction.GROUP_ACCESS_REACTIVATED, entity, before: { ...base, status: "SUSPENDED" }, after: { ...base, status: "ACTIVE", companyAccessGranted: sync.granted }, reason: input.reason }, { tx });
    return { status: next };
  });
}

export const suspendGroupAccess = (actor: GroupActor, raw: unknown) => setSeatStatus(actor, raw, "SUSPENDED");
export const reactivateGroupAccess = (actor: GroupActor, raw: unknown) => setSeatStatus(actor, raw, "ACTIVE");

export type GroupRemovalPreview = {
  name: string;
  roleName: string | null;
  /** Companies the person reaches only because of the seat: they go with it. */
  lostCompanies: string[];
  /** The person's own memberships: they stay unless the administrator ticks the box. */
  directCompanies: { name: string; role: string }[];
  projectsLost: number;
  /** Why the removal cannot go ahead, so the dialog says it before the click (§48-§50). */
  blocked: "LAST_GROUP_ADMIN" | "SELF" | null;
};

/** What removing the person will really do, worked out here and not guessed in the browser (§46). */
export async function previewGroupUserRemoval(actor: GroupActor, raw: unknown): Promise<GroupRemovalPreview> {
  const input = groupUserRemovePreviewSchema.parse(raw);
  assertGroupCan(actor, "users.manage", input.groupId);
  const seat = await seatFor(input.groupId, input.userId);
  if (seat.role?.key === "OWNER") assertGroupCan(actor, "ceo.manage", input.groupId);
  const [members, lastCeo] = await Promise.all([
    prisma.companyMember.findMany({
      where: { userId: input.userId, status: "ACTIVE", archivedAt: null, company: { parentGroupId: input.groupId, status: "ACTIVE" } },
      orderBy: { company: { name: "asc" } },
      select: { groupDerived: true, company: { select: { name: true } }, role: { select: { name: true } }, projectMemberships: { where: { status: "ACTIVE" }, select: { id: true } } },
    }),
    seat.role?.key === "OWNER" ? prisma.parentGroupMember.count({ where: { parentGroupId: input.groupId, status: "ACTIVE", role: { key: "OWNER" }, user: { status: "ACTIVE" }, NOT: { userId: input.userId } } }).then((n) => n === 0) : Promise.resolve(false),
  ]);
  const derived = members.filter((member) => member.groupDerived);
  return {
    name: `${seat.user.firstName} ${seat.user.lastName}`,
    roleName: seat.role?.name ?? null,
    lostCompanies: derived.map((member) => member.company.name),
    directCompanies: members.filter((member) => !member.groupDerived).map((member) => ({ name: member.company.name, role: member.role.name })),
    projectsLost: derived.reduce((sum, member) => sum + member.projectMemberships.length, 0),
    blocked: actor.userId === input.userId ? "SELF" : lastCeo && seat.status === "ACTIVE" ? "LAST_GROUP_ADMIN" : null,
  };
}

/**
 * Ends the person's own membership in one company of the group (§27, §29).
 * When the seat still covers the company, access carries on through the
 * group: the result says which, so nothing claims the access is gone when it is not.
 */
export async function removeDirectCompanyAccess(actor: GroupActor, raw: unknown): Promise<{ stillViaGroup: boolean }> {
  const input = groupDirectAccessRemoveSchema.parse(raw);
  assertGroupCan(actor, "users.manage", input.groupId);
  return prisma.$transaction(async (tx) => {
    const seat = assertFound(await tx.parentGroupMember.findFirst({
      where: { parentGroupId: input.groupId, userId: input.userId, parentGroup: { isTestFixture: false, kind: "GROUP" } },
      select: { id: true, role: { select: { key: true } }, parentGroup: { select: { name: true, status: true } }, user: { select: { firstName: true, lastName: true } } },
    }));
    assertOpen(seat.parentGroup);
    if (seat.role?.key === "OWNER") assertGroupCan(actor, "ceo.manage", input.groupId);
    const member = assertFound(await tx.companyMember.findFirst({
      where: { companyId: input.companyId, userId: input.userId, status: "ACTIVE", archivedAt: null, groupDerived: false, company: { parentGroupId: input.groupId } },
      select: { id: true, role: { select: { key: true } }, company: { select: { name: true } } },
    }));
    const now = new Date();
    await tx.projectMember.updateMany({ where: { companyMemberId: member.id, status: "ACTIVE" }, data: { status: "INACTIVE", leftAt: now } });
    await tx.companyMember.updateMany({ where: { id: member.id, status: "ACTIVE" }, data: { status: "INACTIVE", deactivatedAt: now, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
    await revokeSessions(tx, { membershipId: member.id, relocate: true });
    // The seat's policy brings its own membership back where it still covers the company.
    await syncSeatAccess(tx, { seatId: seat.id, actorUserId: actor.userId, companyId: input.companyId });
    const stillViaGroup = (await coveredCompanyIds(tx, seat.id)).includes(input.companyId);
    await recordPlatformAction(actor, input.groupId, {
      actionKey: AuditAction.GROUP_DIRECT_COMPANY_ACCESS_REMOVED,
      entity: { type: "User", id: input.userId, label: `${seat.user.firstName} ${seat.user.lastName} · ${member.company.name}` },
      before: { groupId: input.groupId, userId: input.userId, companyId: input.companyId, roleKey: member.role.key, status: "ACTIVE" },
      after: { groupId: input.groupId, userId: input.userId, companyId: input.companyId, status: "INACTIVE", stillViaGroup },
      reason: input.reason,
    }, { tx, companyId: input.companyId });
    return { stillViaGroup };
  });
}
