import type { Prisma } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";

/**
 * The group owner is protected (the user, 2026-11-10: "Group owner is protected.").
 *
 * An Owner of a group is anyone holding the OWNER role on an active membership
 * of one of its companies — direct or group-derived — or on an active group
 * seat. A company or group the platform deleted makes nobody an Owner: its
 * memberships stay ACTIVE while it waits in Recovery, but it is gone (review of
 * 63b961f3). There can be more than one. Inside the tenant, nobody else acts on an
 * Owner's account, devices or sessions, whatever their permissions: not the
 * CEO, not a CEO access holder, not Group IT, not HR. An Owner acts on their
 * own (the person's own-device and own-session flows), and another Owner of the
 * same group may act on them. The platform operator console sits outside every
 * tenant and never asks this.
 *
 * Callers ask here, on the server, before the act: a page that hides a button
 * is a courtesy, this is the rule.
 */

const OWNER = "OWNER";

/**
 * Where an OWNER row still counts: not in a company, or a group, the platform
 * deleted. A suspended or inactive company still counts for now — whether it
 * should is the user's call, not this file's.
 */
const LIVE_GROUP: Prisma.ParentGroupWhereInput = { status: { not: "DELETED" } };
const LIVE_COMPANY: Prisma.CompanyWhereInput = { status: { not: "DELETED" }, parentGroup: LIVE_GROUP };

/** What the refusal says, by what was refused. English here; the error catalogue holds the Albanian. */
export const OWNER_PROTECTED_MESSAGE = {
  DEVICES: "The group owner manages their own devices and sessions.",
  ACCESS: "Only a group owner can change a group owner's access.",
} as const;

/** The machine code a refusal carries in `details.code`, for a client that words it itself. */
export const OWNER_PROTECTED_CODE = "OWNER_PROTECTED";

/**
 * The rule itself, with the facts already known: the person themselves, or
 * anyone when the target is not an Owner, or an Owner of the same group.
 */
export function ownerProtectionAllows(input: { actorUserId: string; targetUserId: string; actorIsOwner: boolean; targetIsOwner: boolean }): boolean {
  return input.actorUserId === input.targetUserId || !input.targetIsOwner || input.actorIsOwner;
}

/** The groups this person is an Owner of, by a membership or by a seat. */
export async function ownedGroupIds(userId: string): Promise<Set<string>> {
  const [members, seats] = await Promise.all([
    prisma.companyMember.findMany({ where: { userId, status: "ACTIVE", role: { key: OWNER }, company: LIVE_COMPANY }, select: { company: { select: { parentGroupId: true } } } }),
    prisma.parentGroupMember.findMany({ where: { userId, status: "ACTIVE", role: { key: OWNER }, parentGroup: LIVE_GROUP }, select: { parentGroupId: true } }),
  ]);
  return new Set([...members.map((member) => member.company.parentGroupId), ...seats.map((seat) => seat.parentGroupId)]);
}

/** Which of these people are Owners of this group: two queries for a page of rows. */
export async function groupOwnersAmong(userIds: readonly string[], parentGroupId: string): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const [members, seats] = await Promise.all([
    prisma.companyMember.findMany({ where: { userId: { in: ids }, status: "ACTIVE", role: { key: OWNER }, company: { ...LIVE_COMPANY, parentGroupId } }, select: { userId: true }, distinct: ["userId"] }),
    prisma.parentGroupMember.findMany({ where: { userId: { in: ids }, parentGroupId, status: "ACTIVE", role: { key: OWNER }, parentGroup: LIVE_GROUP }, select: { userId: true } }),
  ]);
  return new Set([...members, ...seats].map((row) => row.userId));
}

/** Is this person an Owner of this group? */
export async function isGroupOwner(userId: string, parentGroupId: string): Promise<boolean> {
  return (await groupOwnersAmong([userId], parentGroupId)).has(userId);
}

export type OwnerProtectionInput = { actorUserId: string; targetUserId: string; parentGroupId: string };

/** May this actor act on this person's account, devices or sessions in this group? */
export async function mayActOnAccount(input: OwnerProtectionInput): Promise<boolean> {
  if (input.actorUserId === input.targetUserId) return true;
  const owners = await groupOwnersAmong([input.actorUserId, input.targetUserId], input.parentGroupId);
  return ownerProtectionAllows({ ...input, actorIsOwner: owners.has(input.actorUserId), targetIsOwner: owners.has(input.targetUserId) });
}

/** Refuses (403, `details.code` OWNER_PROTECTED) when the actor may not act on this person. */
export async function assertMayActOnAccount(input: OwnerProtectionInput, refusal: keyof typeof OWNER_PROTECTED_MESSAGE = "ACCESS"): Promise<void> {
  if (await mayActOnAccount(input)) return;
  throw new AccessError("FORBIDDEN", OWNER_PROTECTED_MESSAGE[refusal], { code: OWNER_PROTECTED_CODE });
}

/**
 * Of these people, the ones this actor may not act on: the group's Owners
 * other than the actor, unless the actor is an Owner too. For a list or a
 * page to show them read-only without guessing.
 */
export async function ownerShieldedUserIds(input: { actorUserId: string; parentGroupId: string }, userIds: readonly string[]): Promise<Set<string>> {
  const others = userIds.filter((id) => id !== input.actorUserId);
  if (others.length === 0) return new Set();
  const owners = await groupOwnersAmong([input.actorUserId, ...others], input.parentGroupId);
  if (owners.has(input.actorUserId)) return new Set();
  return new Set(others.filter((id) => owners.has(id)));
}
