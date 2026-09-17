import { randomBytes } from "node:crypto";
import type { ParentGroupStatus } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
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
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ id: string; expiresAt: Date }> {
  const session = await prisma.session.create({
    data: {
      sessionToken: randomBytes(32).toString("hex"),
      userId: input.userId,
      ...(input.membershipId ? { membershipId: input.membershipId } : {}),
      ...(input.companyId ? { currentCompanyId: input.companyId } : {}),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
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

  const { count } = await prisma.session.updateMany({
    where: { id: input.sessionId, userId: input.userId, expiresAt: { gt: new Date() } },
    data: { membershipId: membership.id, currentCompanyId: membership.companyId },
  });
  return { moved: count === 1, companyId: membership.companyId };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await revokeSessions(prisma, { sessionId });
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
  client: Pick<typeof prisma, "session">,
  target: { userId?: string; membershipId?: string; exceptSessionId?: string; sessionId?: string },
): Promise<number> {
  if (!target.userId && !target.membershipId && !target.sessionId) {
    throw new Error("revokeSessions needs a user, a membership or a session");
  }
  const { count } = await client.session.deleteMany({
    where: {
      ...(target.sessionId ? { id: target.sessionId } : {}),
      ...(target.userId ? { userId: target.userId } : {}),
      ...(target.membershipId ? { membershipId: target.membershipId } : {}),
      ...(target.exceptSessionId ? { id: { not: target.exceptSessionId } } : {}),
    },
  });
  return count;
}
