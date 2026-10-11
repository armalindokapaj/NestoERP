import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { MEMBERSHIP_ROLE_KEYS, roles as roleDefinitions, type RoleKey } from "@/config/roles";
import { AccessError, assertFound } from "@/lib/access/guards";
import { createProvisionedUser } from "@/lib/auth/identity";
import { revokeSessions } from "@/lib/auth/session-store";
import { DEFAULT_PASSWORD } from "@/lib/auth/temporary-password";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { assertWithinLimit } from "@/lib/modules/entitlements/entitlement.service";
import { assertGroupCan, type GroupActor } from "@/lib/modules/platform/group-actor";
import { coveredCompanyIds, syncSeatAccess } from "@/lib/modules/platform/group-company-access.service";
import { departmentKeyFor, memberPlace } from "@/lib/modules/platform/group-placement";
import { GROUP_LEVEL_ROLES } from "./platform.schema";

/**
 * The Company CEO (Admin PRD #12): one named person per company, held as a
 * direct, company-scoped membership with the CEO role and pointed at by
 * `Company.ceoMemberId`.
 *
 * The pointer is unique and is only moved here, with a compare-and-set, so two
 * administrators naming different people at once cannot both win (§19, §20,
 * §91). "Who is the CEO?" is answered by the pointer, never by looking for a
 * role name (§18). The Group CEO is a different relationship — a group seat —
 * and neither implies the other (§3). Assigning, replacing or removing a CEO
 * touches only this company's membership of the people involved: their group
 * seat, other companies, projects and account are left as they are (§22, §46).
 * Everything is one transaction, authorised against the company named in the
 * request, by the capability to appoint — never a role name (§52-§54).
 */

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().max(500).optional().transform((value) => value || "Company leadership");

const FALLBACK_ROLE_KEYS = MEMBERSHIP_ROLE_KEYS.filter((key) => key !== "CEO" && !(GROUP_LEVEL_ROLES as readonly string[]).includes(key));
const previousAccessSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("KEEP_WITH_ROLE"), roleKey: z.enum(FALLBACK_ROLE_KEYS as [string, ...string[]], { message: "Choose the role they keep, or remove their company access." }) }),
  z.object({ action: z.literal("REMOVE") }),
]);
export type PreviousAccess = z.infer<typeof previousAccessSchema>;

const newCeo = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    firstName: z.string().trim().min(1, "Enter a first name.").max(80),
    lastName: z.string().trim().min(1, "Enter a last name.").max(80),
    email: z.email("Enter a valid email address.").trim().max(200),
  }),
  z.object({ mode: z.literal("existing"), userId: id }),
]);

export const ceoAssignSchema = z.intersection(z.object({ companyId: id, confirmReactivate: z.boolean().default(false), reason }), newCeo);
export const ceoReplaceSchema = z.intersection(
  z.object({ companyId: id, expectedCurrentCeoUserId: id, previous: previousAccessSchema, confirmReactivate: z.boolean().default(false), reason }),
  newCeo,
);
export const ceoRemoveSchema = z.object({ companyId: id, expectedCurrentCeoUserId: id, previous: previousAccessSchema, reason });
export const ceoGetSchema = z.object({ companyId: id });
export const ceoCandidatesSchema = z.object({ companyId: id, q: z.string().trim().max(120).default("") });
export const ceoCandidateSchema = z.object({ companyId: id, userId: id });

type Tx = Prisma.TransactionClient;
type Company = { id: string; name: string; status: string; parentGroupId: string };

export type CeoState = "ACTIVE" | "ACCOUNT_SUSPENDED" | "ACCESS_SUSPENDED";
export type CompanyLeadership = {
  companyId: string;
  companyName: string;
  /** Whether this actor may appoint, replace or remove (the buttons follow the server's answer). */
  canManage: boolean;
  open: boolean;
  version: string | null;
  ceo: null | {
    userId: string;
    membershipId: string;
    name: string;
    email: string | null;
    state: CeoState;
    /** The CEO also reaches the company through a group seat (§119, §120). */
    viaGroup: { groupName: string; roleKey: string | null; covers: boolean } | null;
  };
  fallbackRoles: { key: string; label: string }[];
};

export type CeoCandidate = {
  userId: string;
  name: string;
  email: string | null;
  accountStatus: string;
  /** Only what is needed to choose: the group seat and this company's own membership (§57, §58). */
  group: { name: string; roleKey: string | null } | null;
  company: { roleKey: string; status: string; groupDerived: boolean } | null;
  blocked: "ACCOUNT_SUSPENDED" | "GROUP_COVERED" | "PLATFORM_ACCOUNT" | null;
  reactivates: boolean;
};

async function loadCompany(companyId: string): Promise<Company & { standalone: boolean }> {
  const company = assertFound(await prisma.company.findFirst({
    where: { id: companyId, parentGroup: { isTestFixture: false } },
    select: { id: true, name: true, status: true, parentGroupId: true, parentGroup: { select: { kind: true } } },
  }));
  return { id: company.id, name: company.name, status: company.status, parentGroupId: company.parentGroupId, standalone: company.parentGroup.kind !== "GROUP" };
}

/** The company in the request, for this actor, or a 403 — never a company of another group (§135, §140, §141). */
async function authorise(actor: GroupActor, companyId: string, capability: "ceo.manage" | "users.view") {
  const company = await loadCompany(companyId);
  assertGroupCan(actor, capability, company.parentGroupId);
  return company;
}

function assertOpen(company: Company) {
  if (company.status !== "ACTIVE") throw new AccessError("CONFLICT", `${company.name} is ${company.status.toLowerCase()}. Reactivate it before changing its leadership.`, { code: "ORGANIZATION_NOT_ACTIVE" });
}

/** Who administers the company's own people is decided by the permission, never by a role name: Team at manage, company-wide (last-administrator rule, §50). */
const ADMINISTERS_USERS = { permission: { key: "team.manage" }, scope: "COMPANY" as const };
const roleLabel = (key: string) => roleDefinitions[key as RoleKey]?.label ?? key;

async function lockCompany(tx: Tx, companyId: string) {
  await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
}

async function groupSeatOf(client: Tx | typeof prisma, userId: string, company: Company) {
  const seat = await client.parentGroupMember.findFirst({
    where: { userId, parentGroupId: company.parentGroupId, status: "ACTIVE", parentGroup: { kind: "GROUP" } },
    select: { id: true, role: { select: { key: true } }, parentGroup: { select: { name: true } } },
  });
  if (!seat) return null;
  const covers = seat.role ? (await coveredCompanyIds(client, seat.id)).includes(company.id) : false;
  return { groupName: seat.parentGroup.name, roleKey: seat.role?.key ?? null, covers };
}

/** Who leads this company now, and what the actor may do about it (§8, §18, §73, §130). */
export async function getCompanyLeadership(actor: GroupActor, raw: unknown): Promise<CompanyLeadership> {
  const input = ceoGetSchema.parse(raw);
  const company = await authorise(actor, input.companyId, "users.view");
  const row = await prisma.company.findUniqueOrThrow({
    where: { id: company.id },
    select: { ceoMember: { select: { id: true, status: true, userId: true, user: { select: { firstName: true, lastName: true, email: true, status: true } } } } },
  });
  const member = row.ceoMember;
  const ceo = member
    ? {
        userId: member.userId,
        membershipId: member.id,
        name: `${member.user.firstName} ${member.user.lastName}`,
        email: member.user.email,
        // The two inconsistencies are shown, not hidden behind "Active" (§72, §73).
        state: (member.user.status !== "ACTIVE" ? "ACCOUNT_SUSPENDED" : member.status !== "ACTIVE" ? "ACCESS_SUSPENDED" : "ACTIVE") as CeoState,
        viaGroup: await groupSeatOf(prisma, member.userId, company),
      }
    : null;
  return {
    companyId: company.id,
    companyName: company.name,
    canManage: company.status === "ACTIVE" && actor.can("ceo.manage", company.parentGroupId),
    open: company.status === "ACTIVE",
    version: member?.userId ?? null,
    ceo,
    fallbackRoles: FALLBACK_ROLE_KEYS.map((key) => ({ key, label: roleLabel(key) })),
  };
}

/**
 * People who may be named CEO, searched inside the company's own organization
 * only (§14, §101, §102, §136): never the platform's whole user list.
 */
export async function searchCeoCandidates(actor: GroupActor, raw: unknown): Promise<CeoCandidate[]> {
  const input = ceoCandidatesSchema.parse(raw);
  const company = await authorise(actor, input.companyId, "ceo.manage");
  const text = input.q.trim();
  const contains = { contains: text, mode: "insensitive" as const };
  const rows = await prisma.user.findMany({
    where: {
      personProfile: { parentGroupId: company.parentGroupId },
      OR: [{ platformAccess: { is: null } }, { platformAccess: { is: { status: { not: "ACTIVE" } } } }],
      // The sitting CEO is not a candidate to replace themselves.
      memberships: { none: { companyId: company.id, ceoOf: { isNot: null } } },
      ...(text ? { AND: [{ OR: [{ firstName: contains }, { lastName: contains }, { username: contains }, { email: contains }] }] } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: 20,
    select: { id: true },
  });
  return Promise.all(rows.map((row) => describeCandidate(prisma, company, row.id)));
}

export async function previewCeoCandidate(actor: GroupActor, raw: unknown): Promise<CeoCandidate> {
  const input = ceoCandidateSchema.parse(raw);
  const company = await authorise(actor, input.companyId, "ceo.manage");
  return describeCandidate(prisma, company, input.userId);
}

async function describeCandidate(client: Tx | typeof prisma, company: Company, userId: string): Promise<CeoCandidate> {
  const user = assertFound(await client.user.findFirst({
    where: { id: userId, personProfile: { parentGroupId: company.parentGroupId } },
    select: { id: true, firstName: true, lastName: true, email: true, status: true, platformAccess: { select: { status: true } } },
  }));
  const [seat, membership] = await Promise.all([
    groupSeatOf(client, user.id, company),
    client.companyMember.findFirst({ where: { companyId: company.id, userId: user.id, archivedAt: null }, select: { status: true, groupDerived: true, role: { select: { key: true } } } }),
  ]);
  const covered = membership?.status === "ACTIVE" && membership.groupDerived;
  return {
    userId: user.id,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    accountStatus: user.status,
    group: seat ? { name: seat.groupName, roleKey: seat.roleKey } : null,
    company: membership ? { roleKey: membership.role.key, status: membership.status, groupDerived: membership.groupDerived } : null,
    blocked: user.platformAccess?.status === "ACTIVE" ? "PLATFORM_ACCOUNT" : user.status !== "ACTIVE" ? "ACCOUNT_SUSPENDED" : covered ? "GROUP_COVERED" : null,
    reactivates: Boolean(membership && membership.status !== "ACTIVE"),
  };
}

type Provisioned = { userId: string; membershipId: string; username: string; name: string; newAccount: boolean; reactivated: boolean; previousRoleKey: string | null; temporaryPassword?: string };

/** The department place a role has in this company, when its group runs that department here. */
async function place(tx: Tx, actor: GroupActor, company: Company, userId: string, roleKey: string) {
  const branch = await tx.department.findFirst({ where: { companyId: company.id, status: "ACTIVE", groupDepartment: { key: departmentKeyFor(roleKey), status: "ACTIVE" } }, select: { id: true, groupDepartmentId: true } });
  if (!branch) return null;
  const placed = await tx.departmentAssignment.count({ where: { userId, companyId: company.id, companyDepartmentId: branch.id, status: "ACTIVE" } });
  if (!placed) await memberPlace(tx, { parentGroupId: company.parentGroupId, userId, companyId: company.id, branch, roleKey, actorUserId: actor.userId });
  return branch.id;
}

/**
 * Resolves the person (a new account, or an existing one of the same
 * organization) and gives them this company's CEO membership — a new row, or
 * the one they already have, re-roled. One identity per address (§17, §65).
 */
async function provisionCeo(tx: Tx, actor: GroupActor, company: Company, input: z.infer<typeof newCeo> & { confirmReactivate: boolean }): Promise<Provisioned> {
  const ceoRole = await tx.role.findUniqueOrThrow({ where: { key: "CEO" }, select: { id: true } });
  if (input.mode === "new") {
    const clash = await tx.user.findFirst({ where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true, firstName: true, lastName: true } });
    if (clash) throw new AccessError("CONFLICT", `A NESTO account already exists for this email. Select ${clash.firstName} ${clash.lastName} instead?`, { code: "ACCOUNT_EXISTS", field: "email", userId: clash.id, name: `${clash.firstName} ${clash.lastName}` });
    await assertWithinLimit(tx, company.id, "users");
    const person = await tx.personProfile.create({ data: { parentGroupId: company.parentGroupId, firstName: input.firstName, lastName: input.lastName, workEmail: input.email, lifecycleStatus: "EMPLOYEE", createdByUserId: actor.userId }, select: { id: true } });
    const account = await createProvisionedUser(tx, { personProfileId: person.id, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: null, username: null, temporaryPassword: DEFAULT_PASSWORD, expiresAt: null });
    const departmentId = await place(tx, actor, company, account.id, "CEO");
    const member = await tx.companyMember.create({ data: { companyId: company.id, userId: account.id, roleId: ceoRole.id, departmentId, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } });
    return { userId: account.id, membershipId: member.id, username: account.username, name: `${input.firstName} ${input.lastName}`, newAccount: true, reactivated: false, previousRoleKey: null, temporaryPassword: DEFAULT_PASSWORD };
  }

  const user = assertFound(await tx.user.findFirst({
    where: { id: input.userId, personProfile: { parentGroupId: company.parentGroupId } },
    select: { id: true, username: true, firstName: true, lastName: true, status: true, platformAccess: { select: { status: true } } },
  }));
  const name = `${user.firstName} ${user.lastName}`;
  if (user.platformAccess?.status === "ACTIVE") throw new AccessError("VALIDATION_ERROR", "A Platform Admin account cannot hold a company membership.");
  if (user.status !== "ACTIVE") throw new AccessError("CONFLICT", `${name}'s account is suspended. Reactivate the account before assigning them as Company CEO.`, { code: "ACCOUNT_SUSPENDED" });
  const previous = await tx.companyMember.findFirst({ where: { companyId: company.id, userId: user.id, archivedAt: null }, select: { id: true, status: true, groupDerived: true, role: { select: { key: true } } } });
  if (previous?.status === "ACTIVE" && previous.groupDerived) {
    // One membership per person per company: the group seat's access owns it, and a direct CEO role cannot sit beside it.
    throw new AccessError("CONFLICT", `${name} already reaches ${company.name} through their group seat. Take ${company.name} out of that seat's company access first, then assign them as CEO.`, { code: "GROUP_COVERED" });
  }
  const reactivating = Boolean(previous && previous.status !== "ACTIVE");
  if (reactivating && !input.confirmReactivate) {
    throw new AccessError("CONFLICT", `${name} previously had ${previous!.status.toLowerCase()} access to ${company.name}. Assigning them as CEO reactivates it.`, { code: "REACTIVATION_REQUIRED" });
  }
  if (!previous || reactivating) await assertWithinLimit(tx, company.id, "users");
  const departmentId = await place(tx, actor, company, user.id, "CEO");
  if (previous) {
    // Moves the membership from the state just read, so a change made meanwhile is refused instead of overwritten.
    const written = await tx.companyMember.updateMany({ where: { id: previous.id, status: previous.status }, data: { roleId: ceoRole.id, status: "ACTIVE", groupDerived: false, departmentId: departmentId ?? undefined, joinedAt: reactivating ? new Date() : undefined, deactivatedAt: null, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
    if (written.count === 0) throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
    // The next request builds their access afresh from the CEO role (§68, §70).
    await revokeSessions(tx, { membershipId: previous.id, relocate: false });
    return { userId: user.id, membershipId: previous.id, username: user.username, name, newAccount: false, reactivated: reactivating, previousRoleKey: previous.role.key };
  }
  const member = await tx.companyMember.create({ data: { companyId: company.id, userId: user.id, roleId: ceoRole.id, departmentId, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } });
  return { userId: user.id, membershipId: member.id, username: user.username, name, newAccount: false, reactivated: false, previousRoleKey: null };
}

/** Active people who administer the company's users, apart from one membership (§50). */
async function otherAdministrators(tx: Tx, companyId: string, excludeMemberId: string) {
  return tx.companyMember.count({ where: { companyId, id: { not: excludeMemberId }, status: "ACTIVE", archivedAt: null, role: { permissions: { some: ADMINISTERS_USERS } }, user: { status: "ACTIVE" } } });
}

/** What happens to the outgoing CEO's company access: an explicit choice, never a silent default (§43-§45). */
async function endDesignation(tx: Tx, actor: GroupActor, company: Company, member: { id: string; userId: string }, previous: PreviousAccess): Promise<{ remainingRoleKey: string | null }> {
  if (previous.action === "KEEP_WITH_ROLE") {
    const role = await tx.role.findUniqueOrThrow({ where: { key: previous.roleKey }, select: { id: true } });
    const departmentId = await place(tx, actor, company, member.userId, previous.roleKey);
    await tx.companyMember.updateMany({ where: { id: member.id }, data: { roleId: role.id, departmentId: departmentId ?? undefined, accessVersion: { increment: 1 } } });
    await revokeSessions(tx, { membershipId: member.id, relocate: false });
    return { remainingRoleKey: previous.roleKey };
  }
  const now = new Date();
  await tx.projectMember.updateMany({ where: { companyMemberId: member.id, companyId: company.id, status: "ACTIVE" }, data: { status: "INACTIVE", leftAt: now } });
  await tx.companyMember.updateMany({ where: { id: member.id, status: "ACTIVE" }, data: { status: "INACTIVE", deactivatedAt: now, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
  await revokeSessions(tx, { membershipId: member.id, relocate: true });
  // A group seat that covers this company still owns its own way in (§119): give it back.
  const seat = await tx.parentGroupMember.findFirst({ where: { userId: member.userId, parentGroupId: company.parentGroupId, status: "ACTIVE", roleId: { not: null } }, select: { id: true } });
  if (seat) await syncSeatAccess(tx, { seatId: seat.id, actorUserId: actor.userId, companyId: company.id });
  return { remainingRoleKey: null };
}

async function currentCeo(tx: Tx, companyId: string) {
  const row = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { ceoMember: { select: { id: true, userId: true, status: true, user: { select: { firstName: true, lastName: true } } } } } });
  return row.ceoMember;
}

async function point(tx: Tx, companyId: string, from: string | null, to: string | null) {
  const moved = await tx.company.updateMany({ where: { id: companyId, ceoMemberId: from }, data: { ceoMemberId: to, configVersion: { increment: 1 } } });
  if (moved.count !== 1) throw new AccessError("CONFLICT", "Company leadership has changed. Refresh and review the current CEO before continuing.", { code: "LEADERSHIP_CHANGED" });
}

export type CeoAssigned = { userId: string; username: string; changed: boolean; temporaryPassword?: string };

/** Names the company's CEO when it has none (§11-§17, §88-§93). */
export async function assignCompanyCeo(actor: GroupActor, raw: unknown): Promise<CeoAssigned> {
  const input = ceoAssignSchema.parse(raw);
  const company = await authorise(actor, input.companyId, "ceo.manage");
  assertOpen(company);
  return prisma.$transaction(async (tx) => {
    await lockCompany(tx, company.id);
    const sitting = await currentCeo(tx, company.id);
    if (sitting) {
      // The same person again is the state that already exists (§93); anyone else is a conflict (§91).
      if (input.mode === "existing" && sitting.userId === input.userId && sitting.status === "ACTIVE") {
        const user = await tx.user.findUniqueOrThrow({ where: { id: sitting.userId }, select: { username: true } });
        return { userId: sitting.userId, username: user.username, changed: false };
      }
      throw new AccessError("CONFLICT", "This company already has a CEO. Refresh to see the current leadership.", { code: "CEO_EXISTS", currentCeo: `${sitting.user.firstName} ${sitting.user.lastName}` });
    }
    const person = await provisionCeo(tx, actor, company, input);
    await point(tx, company.id, null, person.membershipId);
    await recordPlatformAction(actor, company.parentGroupId, { actionKey: AuditAction.PLATFORM_COMPANY_CEO_ASSIGNED, entity: { type: "CompanyMember", id: person.membershipId, label: `${person.name} · ${company.name}` }, before: { companyId: company.id }, after: { companyId: company.id, userId: person.userId, newAccount: person.newAccount, reactivated: person.reactivated, previousRoleKey: person.previousRoleKey, source: actor.roleKey }, reason: input.reason }, { tx, companyId: company.id });
    return { userId: person.userId, username: person.username, changed: true, temporaryPassword: person.temporaryPassword };
  });
}

/**
 * Hands the CEO role to someone else in one transaction (§38-§47, §90): the
 * request names the CEO it was made against, and is refused if it has moved
 * since (§133). The outgoing CEO's access is the explicit choice in the request.
 */
export async function replaceCompanyCeo(actor: GroupActor, raw: unknown): Promise<CeoAssigned> {
  const input = ceoReplaceSchema.parse(raw);
  const company = await authorise(actor, input.companyId, "ceo.manage");
  assertOpen(company);
  return prisma.$transaction(async (tx) => {
    await lockCompany(tx, company.id);
    const sitting = await currentCeo(tx, company.id);
    if (!sitting) throw new AccessError("CONFLICT", "Company leadership has changed. Refresh and review the current CEO before continuing.", { code: "LEADERSHIP_CHANGED" });
    if (sitting.userId !== input.expectedCurrentCeoUserId) throw new AccessError("CONFLICT", "Company leadership has changed. Refresh and review the current CEO before continuing.", { code: "LEADERSHIP_CHANGED" });
    if (input.mode === "existing" && input.userId === sitting.userId) throw new AccessError("VALIDATION_ERROR", "That person is already the CEO. Choose someone else.", { code: "SAME_CEO" });

    // The outgoing CEO's designation ends first, so the pointer is never on two people at once.
    const outgoing = await endDesignation(tx, actor, company, { id: sitting.id, userId: sitting.userId }, input.previous);
    await tx.company.updateMany({ where: { id: company.id, ceoMemberId: sitting.id }, data: { ceoMemberId: null } });
    const person = await provisionCeo(tx, actor, company, input);
    await point(tx, company.id, null, person.membershipId);
    await recordPlatformAction(actor, company.parentGroupId, { actionKey: AuditAction.PLATFORM_COMPANY_CEO_REPLACED, entity: { type: "CompanyMember", id: person.membershipId, label: `${person.name} · ${company.name}` }, before: { companyId: company.id, userId: sitting.userId }, after: { companyId: company.id, userId: person.userId, previousAccess: input.previous.action, previousRoleKey: outgoing.remainingRoleKey ?? undefined, newAccount: person.newAccount, source: actor.roleKey }, reason: input.reason }, { tx, companyId: company.id });
    return { userId: person.userId, username: person.username, changed: true, temporaryPassword: person.temporaryPassword };
  });
}

/** Leaves the company without a CEO, where administration is not lost with them (§48-§51). */
export async function removeCompanyCeo(actor: GroupActor, raw: unknown): Promise<void> {
  const input = ceoRemoveSchema.parse(raw);
  const company = await authorise(actor, input.companyId, "ceo.manage");
  assertOpen(company);
  await prisma.$transaction(async (tx) => {
    await lockCompany(tx, company.id);
    const sitting = await currentCeo(tx, company.id);
    if (!sitting) throw new AccessError("CONFLICT", "Company leadership has changed. Refresh and review the current CEO before continuing.", { code: "LEADERSHIP_CHANGED" });
    if (sitting.userId !== input.expectedCurrentCeoUserId) throw new AccessError("CONFLICT", "Company leadership has changed. Refresh and review the current CEO before continuing.", { code: "LEADERSHIP_CHANGED" });
    const keepsAdmin = input.previous.action === "KEEP_WITH_ROLE" && (await tx.rolePermission.count({ where: { role: { key: input.previous.roleKey }, ...ADMINISTERS_USERS } })) > 0;
    if (!keepsAdmin && (await otherAdministrators(tx, company.id, sitting.id)) === 0) {
      throw new AccessError("CONFLICT", actor.userId === sitting.userId
        ? "You cannot remove yourself as the last Company administrator. Assign another CEO or Company administrator first."
        : `${company.name} would have no one to administer it. Assign another CEO or Company administrator first.`, { code: "LAST_COMPANY_ADMIN" });
    }
    const outgoing = await endDesignation(tx, actor, company, { id: sitting.id, userId: sitting.userId }, input.previous);
    await point(tx, company.id, sitting.id, null);
    await recordPlatformAction(actor, company.parentGroupId, { actionKey: AuditAction.PLATFORM_COMPANY_CEO_REMOVED, entity: { type: "CompanyMember", id: sitting.id, label: `${sitting.user.firstName} ${sitting.user.lastName} · ${company.name}` }, before: { companyId: company.id, userId: sitting.userId }, after: { companyId: company.id, userId: sitting.userId, previousAccess: input.previous.action, remainingRoleKey: outgoing.remainingRoleKey ?? undefined, source: actor.roleKey }, reason: input.reason }, { tx, companyId: company.id });
  });
}

/**
 * The generic membership editors must not move the CEO by the back door (§81):
 * a company's CEO changes its role or leaves only through Change / Remove CEO.
 */
export async function assertNotCompanyCeo(client: Tx | typeof prisma, membershipId: string): Promise<void> {
  const row = await client.company.findFirst({ where: { ceoMemberId: membershipId }, select: { name: true } });
  if (row) throw new AccessError("CONFLICT", `This person is the CEO of ${row.name}. Use Change CEO or Remove CEO to change that.`, { code: "IS_COMPANY_CEO" });
}
