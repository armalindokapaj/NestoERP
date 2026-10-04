import type { CompanyAccessMode, Prisma } from "@prisma/client";
import { z } from "zod";

import { AccessError, assertFound } from "@/lib/access/guards";
import { revokeSessions } from "@/lib/auth/session-store";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { assertWithinLimit } from "@/lib/modules/entitlements/entitlement.service";
import { assertGroupCan, type GroupActor } from "@/lib/modules/platform/group-actor";
import { departmentKeyFor, memberPlace } from "@/lib/modules/platform/group-placement";

/**
 * Which companies a group seat's role reaches (PRD #10): NONE, ALL or SELECTED.
 *
 * Three relationships stay apart. The seat (`ParentGroupMember`) says the person
 * belongs to the group. The policy (`companyAccessMode` plus the selected rows)
 * says where the seat's group role applies. A direct membership is a company
 * administrator's own grant. A company session is still built from a
 * `CompanyMember`, so the policy is enforced by keeping one membership per
 * covered company, flagged `groupDerived` — owned by the policy, created and
 * ended with it, while a direct membership (flag false) is never touched here.
 *
 * ALL is persisted intent, not a count: SELECTED with every current company is
 * a different policy, because a company added later joins ALL and not SELECTED.
 */

const id = z.string().trim().min(1).max(128);

export const companyAccessSchema = z
  .object({ mode: z.enum(["NONE", "ALL", "SELECTED"]), companyIds: z.array(id).max(1000).default([]) })
  .superRefine((value, ctx) => {
    if (value.mode === "SELECTED" && new Set(value.companyIds).size === 0) {
      ctx.addIssue({ code: "custom", path: ["companyIds"], message: 'Select at least one company or choose "No companies".' });
    }
  })
  .transform((value) => ({ mode: value.mode, companyIds: value.mode === "SELECTED" ? [...new Set(value.companyIds)] : [] }));
export type CompanyAccessInput = z.infer<typeof companyAccessSchema>;

export const groupUserAccessGetSchema = z.object({ groupId: id, userId: id });
export const groupUserAccessUpdateSchema = z.object({
  groupId: id,
  userId: id,
  companyAccess: companyAccessSchema,
  /** The version the form was loaded at; a seat changed since is refused, not overwritten. */
  expectedVersion: z.number().int().min(1).optional(),
  reason: z.string().trim().max(500).optional().transform((value) => value || "Group administration"),
});
export const groupCompanyChoicesSchema = z.object({ groupId: id, q: z.string().trim().max(120).default(""), cursor: id.optional() });

const USABLE_GROUP = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"];
const PAGE = 50;

export type CompanyAccessState = { mode: CompanyAccessMode; companyIds: string[]; version: number };
export type CompanyAccessSource = "GROUP_DERIVED" | "DIRECT_COMPANY" | "BOTH" | "NONE";

type Tx = Prisma.TransactionClient;

/** The companies a seat's policy covers right now. Empty unless the seat, its role, its person and its group are all live. */
export async function coveredCompanyIds(tx: Tx | typeof prisma, seatId: string): Promise<string[]> {
  const seat = await tx.parentGroupMember.findUnique({
    where: { id: seatId },
    select: {
      status: true, roleId: true, companyAccessMode: true, parentGroupId: true,
      user: { select: { status: true } }, parentGroup: { select: { status: true, kind: true } },
    },
  });
  if (!seat || seat.status !== "ACTIVE" || !seat.roleId || seat.user.status !== "ACTIVE") return [];
  if (seat.parentGroup.kind !== "GROUP" || !USABLE_GROUP.includes(seat.parentGroup.status)) return [];
  // A company outside the seat's group is never covered, whatever the rows say (§31, §113).
  const inGroup: Prisma.CompanyWhereInput = { parentGroupId: seat.parentGroupId, status: "ACTIVE" };
  if (seat.companyAccessMode === "ALL") {
    return (await tx.company.findMany({ where: inGroup, select: { id: true } })).map((row) => row.id);
  }
  if (seat.companyAccessMode === "SELECTED") {
    return (await tx.parentGroupMemberCompany.findMany({ where: { seatId, company: inGroup }, select: { companyId: true } })).map((row) => row.companyId);
  }
  return [];
}

async function endDerived(tx: Tx, memberId: string) {
  const now = new Date();
  await tx.projectMember.updateMany({ where: { companyMemberId: memberId, status: "ACTIVE" }, data: { status: "INACTIVE", leftAt: now } });
  await tx.companyMember.updateMany({ where: { id: memberId, status: "ACTIVE" }, data: { status: "INACTIVE", deactivatedAt: now, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
  await revokeSessions(tx, { membershipId: memberId, relocate: true });
}

/**
 * Brings a seat's policy-owned memberships in line with its policy: one in every
 * covered company, none anywhere else. Direct memberships are left exactly as
 * they are — a direct member the policy also covers simply has both sources.
 * Pass `companyId` to look at one company only (it joined, left or changed status).
 */
export async function syncSeatAccess(tx: Tx, input: { seatId: string; actorUserId: string; companyId?: string }): Promise<{ granted: number; ended: number }> {
  const seat = await tx.parentGroupMember.findUnique({ where: { id: input.seatId }, select: { id: true, userId: true, parentGroupId: true, roleId: true, role: { select: { key: true } } } });
  if (!seat) return { granted: 0, ended: 0 };
  const covered = new Set(await coveredCompanyIds(tx, seat.id));
  const scope: Prisma.CompanyMemberWhereInput = { userId: seat.userId, archivedAt: null, groupDerived: true, company: { parentGroupId: seat.parentGroupId }, ...(input.companyId ? { companyId: input.companyId } : {}) };

  let ended = 0;
  for (const member of await tx.companyMember.findMany({ where: { ...scope, status: "ACTIVE" }, select: { id: true, companyId: true } })) {
    if (covered.has(member.companyId)) continue;
    await endDerived(tx, member.id);
    ended += 1;
  }

  let granted = 0;
  if (seat.roleId && seat.role) {
    const targets = [...covered].filter((companyId) => !input.companyId || companyId === input.companyId);
    const groupDepartment = await tx.groupDepartment.findFirst({ where: { parentGroupId: seat.parentGroupId, key: departmentKeyFor(seat.role.key), status: "ACTIVE" }, select: { id: true } });
    for (const companyId of targets) {
      const previous = await tx.companyMember.findFirst({ where: { companyId, userId: seat.userId, archivedAt: null }, select: { id: true, status: true, roleId: true, groupDerived: true } });
      // A direct membership already serves the person here; the policy adds a source, not a row.
      if (previous?.status === "ACTIVE" && !previous.groupDerived) continue;
      // A direct membership a company administrator suspended stays suspended: the policy does not quietly override that decision (PRD #13 §70).
      if (previous?.status === "SUSPENDED" && !previous.groupDerived) continue;
      if (previous?.status === "ACTIVE" && previous.roleId === seat.roleId) continue;
      const branch = groupDepartment ? await tx.department.findFirst({ where: { companyId, groupDepartmentId: groupDepartment.id, status: "ACTIVE" }, select: { id: true, groupDepartmentId: true } }) : null;
      if (previous?.status !== "ACTIVE") await assertWithinLimit(tx, companyId, "users");
      if (previous) {
        await tx.companyMember.updateMany({ where: { id: previous.id, status: previous.status }, data: { roleId: seat.roleId, status: "ACTIVE", groupDerived: true, departmentId: branch?.id ?? null, joinedAt: new Date(), deactivatedAt: null, deactivatedByMemberId: null, accessVersion: { increment: 1 } } });
        // A role changed under live sessions ends them; a membership coming back from inactive has none to end, and a
        // direct row just removed under a person who is still covered by the group must not sign them out (PRD #14 §89).
        if (previous.status === "ACTIVE") await revokeSessions(tx, { membershipId: previous.id, relocate: false });
      } else {
        await tx.companyMember.create({ data: { companyId, userId: seat.userId, roleId: seat.roleId, departmentId: branch?.id ?? null, status: "ACTIVE", groupDerived: true, joinedAt: new Date() } });
      }
      granted += 1;
      if (branch && (await tx.departmentAssignment.count({ where: { userId: seat.userId, companyId, companyDepartmentId: branch.id, status: "ACTIVE" } })) === 0) {
        await memberPlace(tx, { parentGroupId: seat.parentGroupId, userId: seat.userId, companyId, branch, roleKey: seat.role.key, actorUserId: input.actorUserId });
      }
    }
  }
  return { granted, ended };
}

/** Every live seat of a group re-read for one company: it joined the group, was created in it, or changed status (§55, §57). */
export async function reconcileCompanyForSeats(tx: Tx, input: { companyId: string; parentGroupId: string; actorUserId: string }): Promise<void> {
  const seats = await tx.parentGroupMember.findMany({ where: { parentGroupId: input.parentGroupId, roleId: { not: null }, companyAccessMode: { not: "NONE" } }, select: { id: true } });
  for (const seat of seats) await syncSeatAccess(tx, { seatId: seat.id, actorUserId: input.actorUserId, companyId: input.companyId });
}

/**
 * A company leaves its group (§52-§54, §107): no seat may still name it as
 * selected, and the memberships the old group's policies owned in it end. Direct
 * memberships stay until the transfer itself decides about them (§108).
 */
export async function releaseCompanyFromGroup(tx: Tx, input: { companyId: string }): Promise<void> {
  await tx.parentGroupMemberCompany.deleteMany({ where: { companyId: input.companyId } });
  for (const member of await tx.companyMember.findMany({ where: { companyId: input.companyId, groupDerived: true, status: "ACTIVE" }, select: { id: true } })) await endDerived(tx, member.id);
}

/** Whether one person reaches one company, and by which road (§74-§78). */
export async function resolveGroupCompanyAccess(userId: string, companyId: string): Promise<{ allowed: boolean; source: CompanyAccessSource; seatId: string | null; mode: CompanyAccessMode | null }> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, status: true, parentGroupId: true } });
  if (!company || company.status !== "ACTIVE") return { allowed: false, source: "NONE", seatId: null, mode: null };
  const [direct, seat] = await Promise.all([
    prisma.companyMember.findFirst({ where: { companyId, userId, status: "ACTIVE", archivedAt: null, groupDerived: false }, select: { id: true } }),
    prisma.parentGroupMember.findUnique({ where: { parentGroupId_userId: { parentGroupId: company.parentGroupId, userId } }, select: { id: true, companyAccessMode: true } }),
  ]);
  const viaGroup = seat ? (await coveredCompanyIds(prisma, seat.id)).includes(companyId) : false;
  const source: CompanyAccessSource = direct && viaGroup ? "BOTH" : viaGroup ? "GROUP_DERIVED" : direct ? "DIRECT_COMPANY" : "NONE";
  return { allowed: source !== "NONE", source, seatId: seat?.id ?? null, mode: seat?.companyAccessMode ?? null };
}

async function seatOf(groupId: string, userId: string) {
  return assertFound(
    await prisma.parentGroupMember.findUnique({
      where: { parentGroupId_userId: { parentGroupId: groupId, userId } },
      select: {
        id: true, status: true, accessVersion: true, companyAccessMode: true, role: { select: { key: true } },
        user: { select: { firstName: true, lastName: true } },
        parentGroup: { select: { id: true, name: true, status: true, kind: true } },
        companies: { select: { companyId: true } },
      },
    }),
  );
}

function assertOpen(group: { name: string; status: string; kind: string }) {
  if (group.kind !== "GROUP") throw new AccessError("NOT_FOUND");
  if (!USABLE_GROUP.includes(group.status)) throw new AccessError("CONFLICT", `${group.name} is ${group.status.toLowerCase()}. Reactivate it before changing its people.`, { code: "ORGANIZATION_NOT_ACTIVE" });
}

/** A seat's company access as the Edit Access form loads it. */
export async function getGroupUserAccess(actor: GroupActor, raw: unknown): Promise<CompanyAccessState & { roleKey: string | null; seatStatus: string }> {
  const input = groupUserAccessGetSchema.parse(raw);
  assertGroupCan(actor, "users.manage", input.groupId);
  const seat = await seatOf(input.groupId, input.userId);
  return { mode: seat.companyAccessMode, companyIds: seat.companies.map((row) => row.companyId).sort(), version: seat.accessVersion, roleKey: seat.role?.key ?? null, seatStatus: seat.status };
}

/** The group's companies for the picker: this group's only, searched and paged on the server (§16, §100). */
export async function groupCompanyChoices(actor: GroupActor, raw: unknown) {
  const input = groupCompanyChoicesSchema.parse(raw);
  assertGroupCan(actor, "users.manage", input.groupId);
  const rows = await prisma.company.findMany({
    where: { parentGroupId: input.groupId, status: "ACTIVE", ...(input.q ? { name: { contains: input.q, mode: "insensitive" } } : {}) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: PAGE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: { id: true, name: true, status: true, country: true },
  });
  const total = await prisma.company.count({ where: { parentGroupId: input.groupId, status: "ACTIVE" } });
  return { total, companies: rows.slice(0, PAGE), nextCursor: rows.length > PAGE ? rows[PAGE - 1].id : null };
}

/** Replaces a seat's selected companies and mode inside the caller's transaction. */
export async function writeCompanyPolicy(tx: Tx, input: { seatId: string; parentGroupId: string; companyAccess: CompanyAccessInput }): Promise<void> {
  const { mode, companyIds } = input.companyAccess;
  if (mode === "SELECTED") {
    // One foreign or archived id fails the whole request (§68, §73, §99).
    const valid = await tx.company.count({ where: { id: { in: companyIds }, parentGroupId: input.parentGroupId, status: "ACTIVE" } });
    if (valid !== companyIds.length) throw new AccessError("VALIDATION_ERROR", "Choose among this group's active companies.", { field: "companyIds", code: "COMPANY_NOT_IN_GROUP" });
  }
  // Switching to ALL or NONE drops the selected rows so a stale list can never restrict or widen it (§37).
  await tx.parentGroupMemberCompany.deleteMany({ where: { seatId: input.seatId, ...(mode === "SELECTED" ? { companyId: { notIn: companyIds } } : {}) } });
  if (mode === "SELECTED") await tx.parentGroupMemberCompany.createMany({ data: companyIds.map((companyId) => ({ seatId: input.seatId, companyId })), skipDuplicates: true });
  await tx.parentGroupMember.update({ where: { id: input.seatId }, data: { companyAccessMode: mode, accessVersion: { increment: 1 } } });
}

/**
 * Edit Access (§35-§40, §66-§72): one transaction, validated against the group
 * in the request, idempotent, audited. Direct memberships are never removed
 * here; only the memberships the policy itself owns come and go.
 */
export async function updateGroupUserAccess(actor: GroupActor, raw: unknown): Promise<CompanyAccessState> {
  const input = groupUserAccessUpdateSchema.parse(raw);
  assertGroupCan(actor, "users.manage", input.groupId);
  return prisma.$transaction(async (tx) => {
    const seat = await tx.parentGroupMember.findUnique({
      where: { parentGroupId_userId: { parentGroupId: input.groupId, userId: input.userId } },
      select: { id: true, status: true, roleId: true, accessVersion: true, companyAccessMode: true, role: { select: { key: true } }, user: { select: { firstName: true, lastName: true } }, parentGroup: { select: { id: true, name: true, status: true, kind: true } }, companies: { select: { companyId: true } } },
    });
    if (!seat) throw new AccessError("NOT_FOUND");
    assertOpen(seat.parentGroup);
    if (seat.status !== "ACTIVE" || !seat.roleId) throw new AccessError("CONFLICT", "This person has no active group role to give company access to.", { code: "NO_GROUP_ROLE" });
    // The CEO's seat is the CEO's own call to change, not IT's (§72).
    if (seat.role?.key === "OWNER") assertGroupCan(actor, "ceo.manage", input.groupId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== seat.accessVersion) {
      throw new AccessError("CONFLICT", "This person's access was changed by someone else. Reload and try again.", { code: "ACCESS_CHANGED" });
    }

    const before = { mode: seat.companyAccessMode, companyIds: seat.companies.map((row) => row.companyId).sort() };
    const next = input.companyAccess;
    const after = { mode: next.mode, companyIds: [...next.companyIds].sort() };
    if (before.mode === after.mode && before.companyIds.join() === after.companyIds.join()) {
      return { ...before, version: seat.accessVersion };
    }

    await writeCompanyPolicy(tx, { seatId: seat.id, parentGroupId: input.groupId, companyAccess: next });
    const sync = await syncSeatAccess(tx, { seatId: seat.id, actorUserId: actor.userId });

    const entity = { type: "User", id: input.userId, label: `${seat.user.firstName} ${seat.user.lastName} · ${seat.parentGroup.name}` };
    const base = { groupId: input.groupId, userId: input.userId };
    const added = after.companyIds.filter((companyId) => !before.companyIds.includes(companyId));
    const removed = before.companyIds.filter((companyId) => !after.companyIds.includes(companyId));
    const audit = (actionKey: string, data: Record<string, unknown>) =>
      recordPlatformAction(actor, input.groupId, { actionKey, entity, before: { ...base, mode: before.mode, companyIds: before.companyIds }, after: { ...base, ...data }, reason: input.reason }, { tx });
    await audit(AuditAction.GROUP_COMPANY_ACCESS_CHANGED, { mode: after.mode, companyIds: after.companyIds, granted: sync.granted, ended: sync.ended });
    if (before.mode !== after.mode) await audit(AuditAction.GROUP_COMPANY_ACCESS_MODE_CHANGED, { mode: after.mode, companyIds: after.companyIds });
    if (after.mode === "SELECTED" && added.length > 0) await audit(AuditAction.GROUP_COMPANY_ACCESS_GRANTED, { mode: after.mode, companyIds: added });
    if (before.mode === "SELECTED" && removed.length > 0) await audit(AuditAction.GROUP_COMPANY_ACCESS_REVOKED, { mode: after.mode, companyIds: removed });
    return { ...after, version: seat.accessVersion + 1 };
  });
}
