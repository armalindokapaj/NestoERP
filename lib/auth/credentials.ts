import { prisma } from "@/lib/database/prisma";
import {
  clearThrottle,
  clientAddress,
  hitThrottle,
  peekThrottle,
  userAgentOf,
} from "@/lib/core/security/throttle";
import { SignInRateLimited } from "./errors";
import { recordAuthEvent } from "./events";
import { verifyPassword } from "./password";
import { credentialsSchema } from "./schema";
import { createSession } from "./session-store";
import { recordSignIn } from "./identity";

export type AuthenticatedUser = { id: string; email: string; sessionId: string };

/**
 * The credentials check behind every way into NESTO (PRD #6 §6-§10,
 * PRD #38 §17).
 *
 * Auth.js calls this from `authorize`, whether sign-in arrived through the
 * login form's server action, the invitation flow, or a direct POST to the
 * credentials callback — so the throttle here covers all three. It lives
 * outside the Auth.js config so it can be tested without a request cycle.
 *
 * Returns null for every ordinary failure, with one generic message upstream.
 * Throws `SignInRateLimited` when the account or address is locked out.
 */
export async function authenticateCredentials(
  rawCredentials: unknown,
  requestHeaders: Headers | null | undefined,
): Promise<AuthenticatedUser | null> {
  const parsed = credentialsSchema.safeParse(rawCredentials);
  if (!parsed.success) return null;

  const email = parsed.data.email.toLowerCase();
  const ipAddress = clientAddress(requestHeaders);
  const userAgent = userAgentOf(requestHeaders);
  const throttleSubjects = { account: email, ip: ipAddress };

  // Checked before the password, so a locked account costs an attacker
  // nothing to learn and the server no bcrypt round (PRD #38 §17).
  const allowance = await peekThrottle("AUTH_LOGIN", throttleSubjects);
  if (!allowance.allowed) {
    await recordAuthEvent({ type: "LOGIN_RATE_LIMITED", ipAddress, userAgent });
    throw new SignInRateLimited();
  }

  // Every failure counts, including an address nobody has registered, so
  // the lockout itself cannot be used to discover accounts.
  const failed = () => hitThrottle("AUTH_LOGIN", throttleSubjects);

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        include: { company: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  // One generic failure for every cause, so the form never reveals
  // whether an account exists (PRD #6 §8).
  if (!user) {
    await failed();
    await recordAuthEvent({ type: "LOGIN_FAILED", ipAddress, userAgent, metadata: { email } });
    return null;
  }

  const passwordMatches = await verifyPassword(
    parsed.data.password,
    user.passwordHash,
  );
  if (!passwordMatches) {
    await failed();
    await recordAuthEvent({ type: "LOGIN_FAILED", userId: user.id, ipAddress, userAgent });
    return null;
  }

  if (user.status !== "ACTIVE") {
    await recordAuthEvent({ type: "ACCOUNT_BLOCKED", userId: user.id });
    return null;
  }

  // No active membership means no company workspace to enter
  // (PRD #6 §48).
  const membership = user.memberships.find(
    (candidate) => candidate.company.status === "ACTIVE",
  );

  if (!membership) {
    await recordAuthEvent({ type: "MEMBERSHIP_DENIED", userId: user.id });
    return null;
  }

  const session = await createSession({
    userId: user.id,
    membershipId: membership.id,
    companyId: membership.companyId,
    userAgent,
    ipAddress,
  });

  // The right password clears the account's failures; the address keeps
  // its count, so one good account cannot launder a spray.
  await clearThrottle("AUTH_LOGIN", { account: email });

  await recordSignIn(prisma, user.id);

  await recordAuthEvent({
    type: "LOGIN_SUCCESS",
    userId: user.id,
    companyId: membership.companyId,
    sessionId: session.id,
    ipAddress,
    userAgent,
  });

  return {
    id: user.id,
    email: user.email,
    sessionId: session.id,
  };
}
