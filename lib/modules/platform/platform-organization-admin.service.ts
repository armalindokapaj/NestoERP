import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { MEMBERSHIP_ROLE_KEYS, isMembershipRoleKey } from "@/config/roles";
import { AccessError, assertFound } from "@/lib/access/guards";
import { createProvisionedUser } from "@/lib/auth/identity";
import { revokeSessions } from "@/lib/auth/session-store";
import { DEFAULT_PASSWORD } from "@/lib/auth/temporary-password";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { assertWithinLimit } from "@/lib/modules/entitlements/entitlement.service";
import { assertNotCompanyCeo } from "@/lib/modules/platform/company-leadership.service";
import { departmentKeyFor, memberPlace } from "@/lib/modules/platform/platform-implementation.service";
import { GROUP_LEVEL_ROLES } from "./platform.schema";

/**
 * Managing one organization's people from inside it (Admin Organization-Scoped
 * PRD #7 §10-§24, §61-§66, §92-§94).
 *
 * Every write names the company it acts in and is checked against it: a
 * membership, its role and its project places belong to that company only, so
 * a change here never reaches the person's other companies, their group seat
 * or their account. The account itself — suspension, sessions, passwords —
 * stays on the global user page (§22).
 */

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().max(500).optional().transform((value) => value || "Organization administration");
/** Group-wide seats are placed across every company, not from one company's Users tab. */
/** The CEO is named through Assign / Change CEO, never picked from a role list (Admin PRD #12 §81, §87). */
const COMPANY_ROLE_KEYS = MEMBERSHIP_ROLE_KEYS.filter((key) => key !== "CEO" && !(GROUP_LEVEL_ROLES as readonly string[]).includes(key));
const roleKey = z.enum(COMPANY_ROLE_KEYS as [string, ...string[]], { message: "Choose a role." });

export const organizationUserAddSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"), companyId: id, roleKey, projectIds: z.array(id).max(50).default([]), reason,
    firstName: z.string().trim().min(1, "Enter a first name.").max(80),
    lastName: z.string().trim().min(1, "Enter a last name.").max(80),
    email: z.email("Enter a valid email address.").trim().max(200),
  }),
  z.object({ mode: z.literal("existing"), companyId: id, userId: id, roleKey, projectIds: z.array(id).max(50).default([]), reason }),
]);
export const organizationMemberRoleSchema = z.object({ companyId: id, membershipId: id, roleKey, reason });
export const organizationMemberProjectsSchema = z.object({ companyId: id, membershipId: id, projectIds: z.array(id).max(50).default([]), reason });
export const organizationMemberRemoveSchema = z.object({ companyId: id, membershipId: id, reason });

function assertManage(context: PlatformContext) {
  if (!canPlatform(context, "platform.membership.manage")) throw new AccessError("FORBIDDEN");
}

async function openCompany(companyId: string) {
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, parentGroup: { isTestFixture: false } }, select: { id: true, name: true, status: true, parentGroupId: true } }));
  if (company.status !== "ACTIVE") throw new AccessError("CONFLICT", `${company.name} is ${company.status.toLowerCase()}. Reactivate it before changing its users.`, { code: "ORGANIZATION_NOT_ACTIVE" });
  return company;
}

/** The membership, only if it is this company's (§62, §64). */
async function memberOf(companyId: string, membershipId: string) {
  return assertFound(await prisma.companyMember.findFirst({
    where: { id: membershipId, companyId, archivedAt: null },
    select: { id: true, status: true, userId: true, groupDerived: true, role: { select: { key: true } }, user: { select: { firstName: true, lastName: true } } },
  }));
}

/** A membership the group's company-access policy owns is changed through that policy, never here (Admin PRD #14 §49). */
function assertDirectMembership(member: { groupDerived: boolean }): void {
  if (member.groupDerived) throw new AccessError("CONFLICT", "This access comes from the group's company access policy. Change it from the group's Users tab.", { code: "GROUP_DERIVED" });
}

/** Projects must be the company's own, open ones. */
export async function companyProjects(tx: Prisma.TransactionClient, companyId: string, projectIds: string[]) {
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return [];
  const rows = await tx.project.findMany({ where: { id: { in: unique }, companyId, archivedAt: null }, select: { id: true } });
  if (rows.length !== unique.length) throw new AccessError("VALIDATION_ERROR", "Choose projects of this company.", { field: "projectIds" });
  return unique;
}

/** Puts the membership on exactly these projects; other companies' places are never read (§66). */
export async function syncProjects(tx: Prisma.TransactionClient, companyId: string, membershipId: string, projectIds: string[]) {
  const current = await tx.projectMember.findMany({ where: { companyMemberId: membershipId, companyId }, select: { id: true, projectId: true, status: true } });
  const now = new Date();
  for (const row of current) {
    const keep = projectIds.includes(row.projectId);
    if (keep && row.status !== "ACTIVE") await tx.projectMember.updateMany({ where: { id: row.id, status: row.status }, data: { status: "ACTIVE", leftAt: null, joinedAt: now } });
    if (!keep && row.status === "ACTIVE") await tx.projectMember.updateMany({ where: { id: row.id, status: "ACTIVE" }, data: { status: "INACTIVE", leftAt: now } });
  }
  for (const projectId of projectIds.filter((value) => !current.some((row) => row.projectId === value))) {
    await tx.projectMember.create({ data: { companyId, projectId, companyMemberId: membershipId, status: "ACTIVE", joinedAt: now } });
  }
}

/** The department place a role has in this company, when the group runs that department here. */
async function placeInDepartment(tx: Prisma.TransactionClient, context: PlatformContext, company: { id: string; parentGroupId: string }, userId: string, role: string) {
  const branch = await tx.department.findFirst({ where: { companyId: company.id, status: "ACTIVE", groupDepartment: { key: departmentKeyFor(role), status: "ACTIVE" } }, select: { id: true, groupDepartmentId: true } });
  if (!branch) return null;
  const placed = await tx.departmentAssignment.count({ where: { userId, companyId: company.id, companyDepartmentId: branch.id, status: "ACTIVE" } });
  if (!placed) await memberPlace(tx, { parentGroupId: company.parentGroupId, userId, companyId: company.id, branch, roleKey: role, actorUserId: context.userId });
  return branch.id;
}

export type OrganizationUserAdded = { userId: string; membershipId: string; username: string; temporaryPassword?: string; expiresAt?: string };

/**
 * Adds a person to this company (§14-§18, §92, §93): a new account with its
 * person, membership, role and projects, or an existing account given a
 * membership here. All of it in one transaction, or none of it.
 */
export async function addOrganizationUser(context: PlatformContext, raw: unknown): Promise<OrganizationUserAdded> {
  assertManage(context);
  const input = organizationUserAddSchema.parse(raw);
  const company = await openCompany(input.companyId);
  const role = assertFound(await prisma.role.findUnique({ where: { key: input.roleKey }, select: { id: true } }));

  if (input.mode === "new") {
    // One identity per address (§18): offer the account that already exists instead.
    const existing = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true, firstName: true, lastName: true } });
    if (existing) {
      throw new AccessError("CONFLICT", `A NESTO account already exists for this email. Add ${existing.firstName} ${existing.lastName} to ${company.name} instead?`, { code: "ACCOUNT_EXISTS", field: "email", userId: existing.id, name: `${existing.firstName} ${existing.lastName}` });
    }
    const temporaryPassword = DEFAULT_PASSWORD;
    const expiresAt = null;
    return prisma.$transaction(async (tx) => {
      const projectIds = await companyProjects(tx, company.id, input.projectIds);
      await assertWithinLimit(tx, company.id, "users");
      const person = await tx.personProfile.create({ data: { parentGroupId: company.parentGroupId, firstName: input.firstName, lastName: input.lastName, workEmail: input.email, lifecycleStatus: "EMPLOYEE", createdByUserId: context.userId }, select: { id: true } });
      const account = await createProvisionedUser(tx, { personProfileId: person.id, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: null, username: null, temporaryPassword, expiresAt });
      const departmentId = await placeInDepartment(tx, context, company, account.id, input.roleKey);
      const member = await tx.companyMember.create({ data: { companyId: company.id, userId: account.id, roleId: role.id, departmentId, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } });
      await syncProjects(tx, company.id, member.id, projectIds);
      await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_ORGANIZATION_USER_ADDED, entity: { type: "User", id: account.id, label: `${input.firstName} ${input.lastName} · ${company.name}` }, after: { companyId: company.id, userId: account.id, roleKey: input.roleKey, status: "ACTIVE", projectIds, newAccount: true, username: account.username }, reason: input.reason }, { tx, companyId: company.id });
      return { userId: account.id, membershipId: member.id, username: account.username, temporaryPassword, expiresAt: undefined };
    });
  }

  const user = assertFound(await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, username: true, firstName: true, lastName: true, status: true, platformAccess: { select: { status: true } }, personProfile: { select: { parentGroupId: true } } } }));
  if (user.platformAccess?.status === "ACTIVE") throw new AccessError("VALIDATION_ERROR", "A Platform Admin account cannot hold a company membership.");
  if (!user.personProfile || user.personProfile.parentGroupId !== company.parentGroupId) throw new AccessError("VALIDATION_ERROR", `${user.firstName} ${user.lastName} belongs to another organization and cannot join ${company.name}.`, { code: "OTHER_ORGANIZATION" });
  const previous = await prisma.companyMember.findFirst({ where: { companyId: company.id, userId: user.id, archivedAt: null }, select: { id: true, status: true } });
  if (previous?.status === "ACTIVE") throw new AccessError("CONFLICT", `${user.firstName} ${user.lastName} is already a user of ${company.name}.`, { code: "ALREADY_MEMBER" });
  return prisma.$transaction(async (tx) => {
    const projectIds = await companyProjects(tx, company.id, input.projectIds);
    await assertWithinLimit(tx, company.id, "users");
    const departmentId = await placeInDepartment(tx, context, company, user.id, input.roleKey);
    let membershipId: string;
    if (previous) {
      // A former membership here comes back rather than a second one (one per company).
      await tx.companyMember.updateMany({ where: { id: previous.id, status: previous.status }, data: { roleId: role.id, status: "ACTIVE", departmentId, joinedAt: new Date(), deactivatedAt: null, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
      membershipId = previous.id;
    } else {
      membershipId = (await tx.companyMember.create({ data: { companyId: company.id, userId: user.id, roleId: role.id, departmentId, status: "ACTIVE", joinedAt: new Date() }, select: { id: true } })).id;
    }
    await syncProjects(tx, company.id, membershipId, projectIds);
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_ORGANIZATION_USER_ADDED, entity: { type: "User", id: user.id, label: `${user.firstName} ${user.lastName} · ${company.name}` }, before: previous ? { companyId: company.id, userId: user.id, status: previous.status } : undefined, after: { companyId: company.id, userId: user.id, roleKey: input.roleKey, status: "ACTIVE", projectIds, newAccount: false }, reason: input.reason }, { tx, companyId: company.id });
    return { userId: user.id, membershipId, username: user.username };
  });
}

/** Changes the role this membership holds here, and nowhere else (§64). */
export async function changeOrganizationMemberRole(context: PlatformContext, raw: unknown): Promise<void> {
  assertManage(context);
  const input = organizationMemberRoleSchema.parse(raw);
  const company = await openCompany(input.companyId);
  const member = await memberOf(company.id, input.membershipId);
  if (member.role.key === input.roleKey) return;
  assertDirectMembership(member);
  await assertNotCompanyCeo(prisma, member.id);
  if (!isMembershipRoleKey(input.roleKey)) throw new AccessError("VALIDATION_ERROR", "Choose a role.");
  const role = assertFound(await prisma.role.findUnique({ where: { key: input.roleKey }, select: { id: true } }));
  await prisma.$transaction(async (tx) => {
    const departmentId = await placeInDepartment(tx, context, company, member.userId, input.roleKey);
    await tx.companyMember.updateMany({ where: { id: member.id, companyId: company.id, status: member.status }, data: { roleId: role.id, departmentId: departmentId ?? undefined, accessVersion: { increment: 1 } } });
    // The next request builds its access afresh from the new role.
    await revokeSessions(tx, { membershipId: member.id, relocate: false });
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_MEMBERSHIP_CHANGED, entity: { type: "CompanyMember", id: member.id, label: `${member.user.firstName} ${member.user.lastName} · ${company.name}` }, before: { companyId: company.id, userId: member.userId, roleKey: member.role.key, status: member.status }, after: { companyId: company.id, userId: member.userId, roleKey: input.roleKey, status: member.status }, reason: input.reason }, { tx, companyId: company.id });
  });
}

/** The company's projects this membership works on (§19 Manage Projects). */
export async function setOrganizationMemberProjects(context: PlatformContext, raw: unknown): Promise<void> {
  assertManage(context);
  const input = organizationMemberProjectsSchema.parse(raw);
  const company = await openCompany(input.companyId);
  const member = await memberOf(company.id, input.membershipId);
  if (member.status !== "ACTIVE") throw new AccessError("CONFLICT", "Add the user back to the company before giving them projects.");
  await prisma.$transaction(async (tx) => {
    const projectIds = await companyProjects(tx, company.id, input.projectIds);
    const before = (await tx.projectMember.findMany({ where: { companyMemberId: member.id, companyId: company.id, status: "ACTIVE" }, select: { projectId: true } })).map((row) => row.projectId);
    await syncProjects(tx, company.id, member.id, projectIds);
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_ORGANIZATION_USER_PROJECTS_CHANGED, entity: { type: "CompanyMember", id: member.id, label: `${member.user.firstName} ${member.user.lastName} · ${company.name}` }, before: { companyId: company.id, userId: member.userId, projectIds: before }, after: { companyId: company.id, userId: member.userId, projectIds }, reason: input.reason }, { tx, companyId: company.id });
  });
}

/**
 * Ends this company's access for the person (§20, §21): the membership and its
 * project places here. The account, other companies and the group seat are
 * left exactly as they were.
 */
export async function removeOrganizationMember(context: PlatformContext, raw: unknown): Promise<void> {
  assertManage(context);
  const input = organizationMemberRemoveSchema.parse(raw);
  const company = assertFound(await prisma.company.findFirst({ where: { id: input.companyId, parentGroup: { isTestFixture: false } }, select: { id: true, name: true, parentGroupId: true } }));
  const member = await memberOf(company.id, input.membershipId);
  if (member.status === "INACTIVE") return;
  assertDirectMembership(member);
  await assertNotCompanyCeo(prisma, member.id);
  await prisma.$transaction(async (tx) => {
    const ended = await tx.projectMember.updateMany({ where: { companyMemberId: member.id, companyId: company.id, status: "ACTIVE" }, data: { status: "INACTIVE", leftAt: new Date() } });
    await tx.companyMember.updateMany({ where: { id: member.id, companyId: company.id, status: member.status }, data: { status: "INACTIVE", deactivatedAt: new Date(), deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
    await revokeSessions(tx, { membershipId: member.id, relocate: true });
    await recordPlatformAction(context, company.parentGroupId, { actionKey: AuditAction.PLATFORM_ORGANIZATION_USER_REMOVED, entity: { type: "CompanyMember", id: member.id, label: `${member.user.firstName} ${member.user.lastName} · ${company.name}` }, before: { companyId: company.id, userId: member.userId, roleKey: member.role.key, status: member.status }, after: { companyId: company.id, userId: member.userId, status: "INACTIVE", projectsEnded: ended.count }, reason: input.reason }, { tx, companyId: company.id });
  });
}

/** Accounts that may join this company: same organization, not already in it, not the platform's own (§17). */
export async function eligibleOrganizationUsers(context: PlatformContext, companyId: string, q: string) {
  assertManage(context);
  const company = assertFound(await prisma.company.findFirst({ where: { id: companyId, parentGroup: { isTestFixture: false } }, select: { id: true, parentGroupId: true } }));
  const text = q.trim().slice(0, 120);
  const contains = { contains: text, mode: "insensitive" as const };
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      personProfile: { parentGroupId: company.parentGroupId },
      OR: [{ platformAccess: { is: null } }, { platformAccess: { is: { status: { not: "ACTIVE" } } } }],
      memberships: { none: { companyId: company.id, status: "ACTIVE", archivedAt: null } },
      ...(text ? { AND: [{ OR: [{ firstName: contains }, { lastName: contains }, { username: contains }, { email: contains }] }] } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: 20,
    select: { id: true, firstName: true, lastName: true, username: true, email: true },
  });
  return rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, username: row.username, email: row.email }));
}
