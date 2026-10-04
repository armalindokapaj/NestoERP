import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { createProvisionedUser } from "@/lib/auth/identity";
import { revokeSessions } from "@/lib/auth/session-store";
import { DEFAULT_PASSWORD } from "@/lib/auth/temporary-password";
import { normaliseUsername, usernameProblem } from "@/lib/auth/username";
import { canPlatform, type PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { assertWithinLimit } from "@/lib/modules/entitlements/entitlement.service";
import { departmentKeyFor, memberPlace } from "@/lib/modules/platform/platform-implementation.service";
import { GROUP_LEVEL_ROLES } from "./platform.schema";

/**
 * A Parent Group's own people (Admin PRD #8): the Group CEO (the Owner role at
 * group level) and Group IT, added, replaced and removed from the group's own
 * Users tab, in any status the group is open in — not only while it is being
 * implemented.
 *
 * A group seat is a `ParentGroupMember` plus a membership of the same group
 * role in each of the group's companies (that is how a person signs in and
 * how company-scoped authorization finds them). One account per person: an
 * existing account is given the seat, never a second one. Every write is one
 * transaction, checked against the group named in the request.
 */

const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().max(500).optional().transform((value) => value || "Group administration");
const roleKey = z.enum(GROUP_LEVEL_ROLES, { message: "Choose a group role." });

export const groupUserAddSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"), groupId: id, roleKey, replaceCurrent: z.boolean().default(false), reason,
    firstName: z.string().trim().min(1, "Enter a first name.").max(80),
    lastName: z.string().trim().min(1, "Enter a last name.").max(80),
    username: z.string().trim().max(60).optional().transform((value) => value || undefined),
    email: z.email("Enter a valid email address.").trim().max(200),
  }),
  z.object({ mode: z.literal("existing"), groupId: id, userId: id, roleKey, replaceCurrent: z.boolean().default(false), reason }),
]);
export const groupUserRemoveSchema = z.object({ groupId: id, userId: id, alsoRemoveCompanyAccess: z.boolean().default(false), reason });

export type GroupUserAdded = { userId: string; username: string; temporaryPassword?: string; expiresAt?: string };

function assertManage(context: PlatformContext) {
  if (!canPlatform(context, "platform.membership.manage")) throw new AccessError("FORBIDDEN");
}

async function openGroup(groupId: string) {
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, isTestFixture: false, kind: "GROUP" }, select: { id: true, name: true, status: true } }));
  if (!["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"].includes(group.status)) {
    throw new AccessError("CONFLICT", `${group.name} is ${group.status.toLowerCase()}. Reactivate it before changing its people.`, { code: "ORGANIZATION_NOT_ACTIVE" });
  }
  return group;
}

async function groupCompanies(tx: Prisma.TransactionClient, groupId: string) {
  const companies = await tx.company.findMany({ where: { parentGroupId: groupId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (companies.length === 0) {
    throw new AccessError("CONFLICT", "Add a company to the group first. A group seat works through the group's companies.", { code: "GROUP_HAS_NO_COMPANY" });
  }
  return companies;
}

/** Active holders of a group role, by their group-level memberships. */
async function activeHolders(tx: Prisma.TransactionClient, groupId: string, key: string) {
  const rows = await tx.companyMember.findMany({
    where: { status: "ACTIVE", archivedAt: null, role: { key }, company: { parentGroupId: groupId }, user: { parentGroupMemberships: { some: { parentGroupId: groupId, status: "ACTIVE" } } } },
    select: { userId: true, user: { select: { firstName: true, lastName: true } } },
  });
  const byUser = new Map(rows.map((row) => [row.userId, `${row.user.firstName} ${row.user.lastName}`]));
  return [...byUser].map(([userId, name]) => ({ userId, name }));
}

/** Ends a person's group-role memberships in the group's companies; the seat itself stays. */
async function endGroupRole(tx: Prisma.TransactionClient, groupId: string, userId: string, key: string | null) {
  const members = await tx.companyMember.findMany({
    where: { userId, status: "ACTIVE", archivedAt: null, company: { parentGroupId: groupId }, ...(key ? { role: { key } } : {}) },
    select: { id: true, companyId: true },
  });
  const now = new Date();
  for (const member of members) {
    await tx.projectMember.updateMany({ where: { companyMemberId: member.id, status: "ACTIVE" }, data: { status: "INACTIVE", leftAt: now } });
    await tx.companyMember.updateMany({ where: { id: member.id, status: "ACTIVE" }, data: { status: "INACTIVE", deactivatedAt: now, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
    await revokeSessions(tx, { membershipId: member.id, relocate: true });
  }
  return members.length;
}

/**
 * Gives the person the group seat with this role: the seat, then the role in
 * every company of the group (a different role they held there becomes this one).
 */
async function seatPerson(tx: Prisma.TransactionClient, context: PlatformContext, group: { id: string }, companies: Array<{ id: string }>, userId: string, key: string) {
  const [roleRow, seat] = await Promise.all([
    tx.role.findUniqueOrThrow({ where: { key }, select: { id: true } }),
    tx.parentGroupMember.findUnique({ where: { parentGroupId_userId: { parentGroupId: group.id, userId } }, select: { id: true, status: true } }),
  ]);
  if (seat) {
    if (seat.status !== "ACTIVE") await tx.parentGroupMember.updateMany({ where: { id: seat.id, status: seat.status }, data: { status: "ACTIVE", joinedAt: new Date() } });
  } else {
    await tx.parentGroupMember.create({ data: { parentGroupId: group.id, userId, status: "ACTIVE", joinedAt: new Date() } });
  }
  const groupDepartment = await tx.groupDepartment.findFirst({ where: { parentGroupId: group.id, key: departmentKeyFor(key), status: "ACTIVE" }, select: { id: true } });
  for (const company of companies) {
    const branch = groupDepartment ? await tx.department.findFirst({ where: { companyId: company.id, groupDepartmentId: groupDepartment.id, status: "ACTIVE" }, select: { id: true, groupDepartmentId: true } }) : null;
    const previous = await tx.companyMember.findFirst({ where: { companyId: company.id, userId, archivedAt: null }, select: { id: true, status: true, roleId: true } });
    if (previous?.status === "ACTIVE" && previous.roleId === roleRow.id) continue;
    if (previous?.status !== "ACTIVE") await assertWithinLimit(tx, company.id, "users");
    if (previous) {
      await tx.companyMember.updateMany({ where: { id: previous.id, status: previous.status }, data: { roleId: roleRow.id, status: "ACTIVE", departmentId: branch?.id ?? null, joinedAt: new Date(), deactivatedAt: null, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
      await revokeSessions(tx, { membershipId: previous.id, relocate: false });
    } else {
      await tx.companyMember.create({ data: { companyId: company.id, userId, roleId: roleRow.id, departmentId: branch?.id ?? null, status: "ACTIVE", joinedAt: new Date() } });
    }
    if (branch) {
      const placed = await tx.departmentAssignment.count({ where: { userId, companyId: company.id, companyDepartmentId: branch.id, status: "ACTIVE" } });
      if (!placed) await memberPlace(tx, { parentGroupId: group.id, userId, companyId: company.id, branch, roleKey: key, actorUserId: context.userId });
    }
  }
}

/**
 * Adds a person to the group with a group role (§13-§17, §22-§25): a new
 * account or an existing one. Naming the Group CEO when there is one already
 * is refused unless `replaceCurrent` says the current CEO steps down — the
 * CEO is one person (§72, §73), replaced in the same transaction.
 */
export async function addGroupUser(context: PlatformContext, raw: unknown): Promise<GroupUserAdded> {
  assertManage(context);
  const input = groupUserAddSchema.parse(raw);
  const group = await openGroup(input.groupId);

  let existing: { id: string; username: string; firstName: string; lastName: string } | null = null;
  if (input.mode === "existing") {
    const user = assertFound(await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, username: true, firstName: true, lastName: true, status: true, platformAccess: { select: { status: true } }, personProfile: { select: { parentGroupId: true } } } }));
    if (user.platformAccess?.status === "ACTIVE") throw new AccessError("VALIDATION_ERROR", "A Platform Admin account cannot hold a group seat.");
    if (user.status !== "ACTIVE") throw new AccessError("VALIDATION_ERROR", `${user.firstName} ${user.lastName}'s account is not active.`, { code: "ACCOUNT_INACTIVE" });
    if (!user.personProfile || user.personProfile.parentGroupId !== group.id) throw new AccessError("VALIDATION_ERROR", `${user.firstName} ${user.lastName} belongs to another organization and cannot join ${group.name}.`, { code: "OTHER_ORGANIZATION" });
    existing = user;
  } else {
    const clash = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: "insensitive" } }, select: { id: true, firstName: true, lastName: true } });
    if (clash) throw new AccessError("CONFLICT", `A NESTO account already exists for this email. Add ${clash.firstName} ${clash.lastName} to ${group.name} instead?`, { code: "ACCOUNT_EXISTS", field: "email", userId: clash.id, name: `${clash.firstName} ${clash.lastName}` });
  }

  const username = input.mode === "new" && input.username ? normaliseUsername(input.username) : null;
  if (username && usernameProblem(username)) throw new AccessError("VALIDATION_ERROR", "Usernames use lowercase letters, numbers, dots, hyphens and underscores.", { field: "username" });

  return prisma.$transaction(async (tx) => {
    const companies = await groupCompanies(tx, group.id);

    let userId: string;
    let accountUsername: string;
    let created = false;
    if (existing) {
      userId = existing.id;
      accountUsername = existing.username;
    } else {
      if (input.mode !== "new") throw new AccessError("VALIDATION_ERROR", "Choose a person.");
      if (username && (await tx.user.count({ where: { username } })) > 0) throw new AccessError("CONFLICT", "That username is taken.", { field: "username" });
      const person = await tx.personProfile.create({ data: { parentGroupId: group.id, firstName: input.firstName, lastName: input.lastName, workEmail: input.email, lifecycleStatus: "EMPLOYEE", createdByUserId: context.userId }, select: { id: true } });
      const account = await createProvisionedUser(tx, { personProfileId: person.id, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: null, username, temporaryPassword: DEFAULT_PASSWORD, expiresAt: null });
      userId = account.id;
      accountUsername = account.username;
      created = true;
    }

    let replaced: { userId: string; name: string } | null = null;
    if (input.roleKey === "OWNER") {
      const others = (await activeHolders(tx, group.id, "OWNER")).filter((holder) => holder.userId !== userId);
      if (others.length > 0) {
        if (!input.replaceCurrent) {
          throw new AccessError("CONFLICT", `${others[0].name} is already the Group CEO of ${group.name}. Change the Group CEO to replace them.`, { code: "CEO_EXISTS", currentCeo: others[0].name });
        }
        // The old CEO keeps the seat in the group and their account; they lose the authority.
        for (const other of others) await endGroupRole(tx, group.id, other.userId, "OWNER");
        replaced = others[0];
      }
    }

    await seatPerson(tx, context, group, companies, userId, input.roleKey);

    const personName = existing ? `${existing.firstName} ${existing.lastName}` : input.mode === "new" ? `${input.firstName} ${input.lastName}` : "";
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_GROUP_USER_ADDED, entity: { type: "User", id: userId, label: `${personName} · ${group.name}` }, after: { groupId: group.id, userId, roleKey: input.roleKey, companies: companies.length, newAccount: created, replacedUserId: replaced?.userId ?? null }, reason: input.reason }, { tx });
    if (replaced) {
      await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_GROUP_CEO_REPLACED, entity: { type: "ParentGroup", id: group.id, label: group.name }, before: { groupId: group.id, userId: replaced.userId, roleKey: "OWNER" }, after: { groupId: group.id, userId, roleKey: "OWNER" }, reason: input.reason }, { tx });
    }
    return created ? { userId, username: accountUsername, temporaryPassword: DEFAULT_PASSWORD } : { userId, username: accountUsername };
  });
}

/**
 * Takes a person out of the group (§41, §43): the seat, and — only when asked —
 * their group-role memberships in its companies. The account is never
 * touched. The only Group CEO cannot be removed (§74): name another first.
 */
export async function removeGroupUser(context: PlatformContext, raw: unknown): Promise<void> {
  assertManage(context);
  const input = groupUserRemoveSchema.parse(raw);
  const group = await openGroup(input.groupId);
  const seat = assertFound(await prisma.parentGroupMember.findUnique({ where: { parentGroupId_userId: { parentGroupId: group.id, userId: input.userId } }, select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } } }));
  if (seat.status !== "ACTIVE") return;

  await prisma.$transaction(async (tx) => {
    const owners = await activeHolders(tx, group.id, "OWNER");
    if (input.alsoRemoveCompanyAccess && owners.length === 1 && owners[0].userId === input.userId) {
      throw new AccessError("CONFLICT", "This is the only Group CEO. Assign another Group CEO first.", { code: "LAST_GROUP_ADMIN" });
    }
    await tx.parentGroupMember.updateMany({ where: { id: seat.id, status: "ACTIVE" }, data: { status: "INACTIVE" } });
    await tx.departmentAssignment.updateMany({ where: { parentGroupId: group.id, userId: input.userId, companyId: null, status: "ACTIVE" }, data: { status: "INACTIVE", endsAt: new Date() } });
    const ended = input.alsoRemoveCompanyAccess ? await endGroupRole(tx, group.id, input.userId, null) : 0;
    await recordPlatformAction(context, group.id, { actionKey: AuditAction.PLATFORM_GROUP_USER_REMOVED, entity: { type: "User", id: input.userId, label: `${seat.user.firstName} ${seat.user.lastName} · ${group.name}` }, before: { groupId: group.id, userId: input.userId, status: "ACTIVE" }, after: { groupId: group.id, userId: input.userId, status: "INACTIVE", companyAccessEnded: ended }, reason: input.reason }, { tx });
  });
}

/** Accounts of this group that may be given a seat: not the platform's own, not already holding one. */
export async function eligibleGroupUsers(context: PlatformContext, groupId: string, q: string) {
  assertManage(context);
  const group = assertFound(await prisma.parentGroup.findFirst({ where: { id: groupId, isTestFixture: false, kind: "GROUP" }, select: { id: true } }));
  const text = q.trim().slice(0, 120);
  const contains = { contains: text, mode: "insensitive" as const };
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      personProfile: { parentGroupId: group.id },
      OR: [{ platformAccess: { is: null } }, { platformAccess: { is: { status: { not: "ACTIVE" } } } }],
      ...(text ? { AND: [{ OR: [{ firstName: contains }, { lastName: contains }, { username: contains }, { email: contains }] }] } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: 20,
    select: { id: true, firstName: true, lastName: true, username: true, email: true },
  });
  return rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, username: row.username, email: row.email }));
}
