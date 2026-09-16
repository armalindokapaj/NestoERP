import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/database/prisma";
import { SESSION_TTL_MS } from "./constants";

export { SESSION_TTL_MS };

/**
 * Server-side session records (PRD #6 §26, §51).
 *
 * The cookie carries a session id, not a copy of the user's permissions, so
 * disabling a membership or a company takes effect on the next request rather
 * than when a token happens to expire (PRD #6 §113–§115).
 */
export async function createSession(input: {
  userId: string;
  membershipId: string;
  companyId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ id: string; expiresAt: Date }> {
  const session = await prisma.session.create({
    data: {
      sessionToken: randomBytes(32).toString("hex"),
      userId: input.userId,
      membershipId: input.membershipId,
      currentCompanyId: input.companyId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    },
    select: { id: true, expiresAt: true },
  });

  return session;
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
