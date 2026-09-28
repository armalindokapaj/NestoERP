import { randomBytes } from "node:crypto";
import type { ParentGroupStatus } from "@prisma/client";

import type { WorkspaceScopeType } from "@/config/workspace";
import { prisma } from "@/lib/database/prisma";
import { recordAuthEvent } from "./events";
import { SESSION_TTL_MS } from "./constants";

export { SESSION_TTL_MS };

/** A group being implemented is usable; a suspended or archived one is not (E-06 §21). */
export const USABLE_GROUP_STATUSES: ParentGroupStatus[] = ["ACTIVE", "IMPLEMENTING", "READY_FOR_VALIDATION"];

/**
 * Server-side session records (PRD #6 §26, §51).
 *
 * The cookie carries a session id, not a copy of the user's permissions, so
 * disabling a membership or a company takes effect on the next request rather
 * than when a token happens to expire (PRD #6 §113–§115).
 */
export async function createSession(input: {
  userId: string;
  /** Both null for a Platform Admin, who signs in to no company (E-06 §19). */
  membershipId: string | null;
  companyId: string | null;
  /**
   * Where the session starts (Workspace Context §16, §17). `DEFAULT` leaves it
   * for the context resolver to decide from the person's standing — the Group
   * workspace for somebody with group-level standing, their company otherwise —
   * which is what every real sign-in asks for, so a user change never carries a
   * workspace over. Omitted means their company.
   */
  workspaceScope?: WorkspaceScopeType | "DEFAULT";
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ id: string; expiresAt: Date }> {
  const createdAt = new Date();
  const session = await prisma.session.create({
    data: {
      sessionToken: randomBytes(32).toString("hex"),
      userId: input.userId,
      ...(input.membershipId ? { membershipId: input.membershipId } : {}),
      ...(input.companyId ? { currentCompanyId: input.companyId } : {}),
      workspaceScope: input.workspaceScope === "DEFAULT" ? null : (input.workspaceScope ?? "COMPANY"),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    },
    select: { id: true, expiresAt: true },
  });

  return session;
}

/**
 * Moves a session into another of the same person's company memberships
 * (E-05A §26, §34).
 *
 * The session row is what every request resolves its company from, so this is
 * the whole of a company switch: the next request is in the other company, with
 * that membership's role, permissions and scope, and nothing from the first
 * company comes with it. The cookie is untouched — it only ever carried the
 * session id.
 *
 * The target is re-read here rather than trusted from the caller: it must be
 * this user's own membership, active, in an active company. Anything else moves
 * nothing and answers false, whatever the caller already checked.
 */
export async function moveSessionToMembership(input: {
  sessionId: string;
  userId: string;
  membershipId: string;
  transitionId?: bigint;
}): Promise<{ moved: boolean; companyId: string | null }> {
  const membership = await prisma.companyMember.findFirst({
    where: {
      id: input.membershipId,
      userId: input.userId,
      status: "ACTIVE",
      company: { status: "ACTIVE", parentGroup: { status: { in: USABLE_GROUP_STATUSES } } },
      user: { status: "ACTIVE" },
    },
    select: { id: true, companyId: true },
  });
  if (!membership) return { moved: false, companyId: null };

  // A company is a company workspace: moving into one leaves the Group workspace
  // (Workspace Context §31). The group is entered again only by asking for it.
  const { count } = await prisma.session.updateMany({
    where: {
      id: input.sessionId,
      userId: input.userId,
      expiresAt: { gt: new Date() },
      ...(input.transitionId !== undefined ? { workspaceTransitionId: { lt: input.transitionId } } : {}),
    },
    data: {
      membershipId: membership.id,
      currentCompanyId: membership.companyId,
      workspaceScope: "COMPANY",
      workspaceVersion: { increment: 1 },
      ...(input.transitionId !== undefined ? { workspaceTransitionId: input.transitionId } : {}),
    },
  });
  return { moved: count === 1, companyId: membership.companyId };
}

/**
 * Sets the workspace scope of one of the person's own live sessions, leaving the
 * home company where it is (Workspace Context §15, §80). The caller has already
 * validated that the person may work in the Group workspace; this only records
 * it, for this session and this user, so a stale id moves nothing.
 */
export async function setSessionWorkspaceScope(input: {
  sessionId: string;
  userId: string;
  scope: WorkspaceScopeType;
  transitionId?: bigint;
}): Promise<boolean> {
  const { count } = await prisma.session.updateMany({
    where: {
      id: input.sessionId,
      userId: input.userId,
      expiresAt: { gt: new Date() },
      ...(input.transitionId !== undefined ? { workspaceTransitionId: { lt: input.transitionId } } : {}),
    },
    data: {
      workspaceScope: input.scope,
      workspaceVersion: { increment: 1 },
      ...(input.transitionId !== undefined ? { workspaceTransitionId: input.transitionId } : {}),
    },
  });
  return count === 1;
}

/**
 * §82 — the workspace a session sits in is gone: the membership was
 * deactivated, or its company was. A person who still works somewhere else in
 * the group is moved there rather than signed out, and the workspace is left
 * unchosen so the next request picks their default again (the Group if they may
 * use it, otherwise that company). Somebody with nowhere left to go is not
 * moved, and the caller ends the session instead.
 */
export async function relocateSessionToUsableMembership(input: { sessionId: string; userId: string }): Promise<boolean> {
  const next = await prisma.companyMember.findFirst({
    where: {
      userId: input.userId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      company: { status: "ACTIVE", parentGroup: { status: { in: USABLE_GROUP_STATUSES } } },
    },
    // Stable and explainable: the first company of the group, by name.
    orderBy: [{ company: { name: "asc" } }],
    select: { id: true, companyId: true },
  });
  if (!next) return false;

  const { count } = await prisma.session.updateMany({
    where: { id: input.sessionId, userId: input.userId, expiresAt: { gt: new Date() } },
    data: {
      membershipId: next.id,
      currentCompanyId: next.companyId,
      workspaceScope: null,
      workspaceVersion: { increment: 1 },
    },
  });
  return count === 1;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await revokeSessions(prisma, { sessionId });
}

/**
 * Ends a session the way signing out does, for a caller that holds only the
 * cookie's claims: the row must still be this user's, or nothing is ended.
 * Answers the company it was in, for the sign-out record (C-01 §21, §23).
 */
export async function endOwnSession(input: { sessionId: string; userId: string }): Promise<{ ended: boolean; companyId: string | null }> {
  const session = await prisma.session.findFirst({
    where: { id: input.sessionId, userId: input.userId },
    select: { currentCompanyId: true },
  });
  if (!session) return { ended: false, companyId: null };
  const count = await revokeSessions(prisma, { sessionId: input.sessionId, userId: input.userId });
  return { ended: count === 1, companyId: session.currentCompanyId };
}

/** Used when a password is reset: every other session for that user is dropped. */
export async function revokeSessionsForUser(
  userId: string,
  options: { except?: string } = {},
): Promise<void> {
  await revokeSessions(prisma, { userId, exceptSessionId: options.except });
}

/**
 * Every session a person holds, ended (PRD #48 §11).
 *
 * `Session` is Auth's row and the cookie is only an id into it, so deleting
 * the row is the revocation — there is no token left to expire (PRD #6 §113).
 * Account and Team both need this: changing a password signs the other devices
 * out, and deactivating a membership ends access now rather than whenever a
 * session happens to lapse (PRD #14 §242).
 *
 * Runs in the caller's transaction where one is given, so the revocation
 * commits with the change that caused it.
 */
export async function revokeSessions(
  client: Pick<typeof prisma, "session" | "companyMember" | "authEvent">,
  target: {
    userId?: string;
    membershipId?: string;
    companyId?: string;
    parentGroupId?: string;
    exceptSessionId?: string;
    sessionId?: string;
    /**
     * §82 — this revocation is one workspace being taken away, not the person
     * losing their account. Anyone who still works elsewhere in the group is
     * moved there and stays signed in; the rest are ended as usual. The caller
     * asks for this only where the access really is gone: deactivating or
     * removing a membership, or closing a company — never for a role change,
     * which ends the session precisely so the next one is built afresh.
     */
    relocate?: boolean;
  },
): Promise<number> {
  // Revocation and its audit commit together. Password/account workflows that
  // already supply a transaction keep both operations inside that transaction.
  if (client === prisma) return prisma.$transaction((tx) => revokeSessions(tx, target));
  if (!target.userId && !target.membershipId && !target.companyId && !target.parentGroupId && !target.sessionId) {
    throw new Error("revokeSessions needs a user, membership, company, parent group or session");
  }
  const where = {
    ...(target.sessionId ? { id: target.sessionId } : {}),
    ...(target.userId ? { userId: target.userId } : {}),
    ...(target.membershipId ? { membershipId: target.membershipId } : {}),
    ...(target.companyId ? { currentCompanyId: target.companyId } : {}),
    ...(target.parentGroupId ? { company: { parentGroupId: target.parentGroupId } } : {}),
    ...(target.exceptSessionId ? { id: { not: target.exceptSessionId } } : {}),
  };

  if (target.relocate) {
    // Runs in the caller's transaction, so "somewhere else they may work" is
    // read after the deactivation it accompanies: the membership being taken
    // away is already inactive here and cannot be the fallback.
    for (const session of await client.session.findMany({ where, select: { id: true, userId: true } })) {
      const next = await client.companyMember.findFirst({
        where: {
          userId: session.userId,
          status: "ACTIVE",
          user: { status: "ACTIVE" },
          company: { status: "ACTIVE", parentGroup: { status: { in: USABLE_GROUP_STATUSES } } },
          ...(target.membershipId ? { id: { not: target.membershipId } } : {}),
          ...(target.companyId ? { companyId: { not: target.companyId } } : {}),
        },
        orderBy: [{ company: { name: "asc" } }],
        select: { id: true, companyId: true },
      });
      if (!next) continue;
      // The workspace is left unchosen: the next request picks their default
      // again — the Group if they may use it, otherwise this company (§16, §82).
      await client.session.updateMany({
        where: { id: session.id },
        data: {
          membershipId: next.id,
          currentCompanyId: next.companyId,
          workspaceScope: null,
          workspaceVersion: { increment: 1 },
        },
      });
    }
  }

  const candidates = await client.session.findMany({
    where,
    // Overlapping revocations acquire row locks in the same order.
    orderBy: { id: "asc" },
    select: { id: true, userId: true, currentCompanyId: true, userAgent: true, ipAddress: true },
  });
  if (!candidates.length) return 0;
  const started = new Set((await client.authEvent.findMany({
    where: { sessionId: { in: candidates.map((row) => row.id) }, type: "IMPERSONATION_STARTED" },
    select: { sessionId: true },
  })).map((event) => event.sessionId));
  const removed: typeof candidates = [];
  for (const row of candidates) {
    // Recheck the predicate: another request may have moved or revoked this
    // row while we waited. Only the request actually deleting it records it.
    const { count } = await client.session.deleteMany({ where: { AND: [where, { id: row.id }] } });
    if (!count) continue;
    removed.push(row);
  }
  if (removed.length) await client.authEvent.createMany({ data: removed.flatMap((row) => {
    const event = { userId: row.userId, sessionId: row.id, companyId: row.currentCompanyId, userAgent: row.userAgent, ipAddress: row.ipAddress };
    return [
      { ...event, type: "SESSION_REVOKED" as const },
      ...(started.has(row.id) ? [{ ...event, type: "IMPERSONATION_ENDED" as const }] : []),
    ];
  }) });
  return removed.length;
}

/** Conditional deletion records expiration once, even with concurrent tabs. */
export async function expireSession(sessionId: string): Promise<void> {
  const row = await prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, currentCompanyId: true } });
  if (!row) return;
  const { count } = await prisma.session.deleteMany({ where: { id: sessionId, expiresAt: { lte: new Date() } } });
  if (count) {
    await recordAuthEvent({ type: "SESSION_EXPIRED", sessionId, userId: row.userId, companyId: row.currentCompanyId });
    await endImpersonation(sessionId, row.userId, row.currentCompanyId);
  }
}

async function endImpersonation(sessionId: string, userId: string, companyId: string | null): Promise<void> {
  try {
    const started = await prisma.authEvent.findFirst({ where: { sessionId, type: "IMPERSONATION_STARTED" }, select: { id: true } });
    if (started) await recordAuthEvent({ type: "IMPERSONATION_ENDED", sessionId, userId, companyId });
  } catch { /* Audit availability must not prevent session termination. */ }
}
