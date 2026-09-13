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
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Used when a password is reset: every other session for that user is dropped. */
export async function revokeSessionsForUser(
  userId: string,
  options: { except?: string } = {},
): Promise<void> {
  await prisma.session.deleteMany({
    where: { userId, ...(options.except ? { id: { not: options.except } } : {}) },
  });
}
