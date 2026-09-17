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
import { normaliseUsername } from "./username";
import { createSession, USABLE_GROUP_STATUSES } from "./session-store";
import { recordSignIn } from "./identity";

export type AuthenticatedUser = { id: string; username: string; sessionId: string; mustChangePassword: boolean };

/**
 * The credentials check behind every way into NESTO (PRD #6 §6-§10,
 * PRD #38 §17, PRD #50 §6, §24).
 *
 * The identifier is the username, not an address: nothing here reads `email`,
 * and an account with no address signs in exactly like one that has an
 * address (PRD #50 §66, §325).
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

  const username = normaliseUsername(parsed.data.username);
  const ipAddress = clientAddress(requestHeaders);
  const userAgent = userAgentOf(requestHeaders);
  const throttleSubjects = { account: username, ip: ipAddress };

  // Checked before the password, so a locked account costs an attacker
  // nothing to learn and the server no bcrypt round (PRD #38 §17).
  const allowance = await peekThrottle("AUTH_LOGIN", throttleSubjects);
  if (!allowance.allowed) {
    await recordAuthEvent({ type: "LOGIN_RATE_LIMITED", ipAddress, userAgent });
    throw new SignInRateLimited();
  }

  // Every failure counts, including a username nobody has registered, so
  // the lockout itself cannot be used to discover accounts.
  const failed = () => hitThrottle("AUTH_LOGIN", throttleSubjects);

  const user = await prisma.user.findUnique({
    where: { username },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        include: { company: { select: { status: true, parentGroup: { select: { status: true } } } } },
        orderBy: { createdAt: "asc" },
      },
      platformAccess: { select: { status: true } },
    },
  });

  // One generic failure for every cause, so the form never reveals
  // whether an account exists (PRD #6 §8).
  if (!user) {
    await failed();
    await recordAuthEvent({ type: "LOGIN_FAILED", ipAddress, userAgent, metadata: { username } });
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

  // A temporary password stops working when it lapses, whether or not
  // anybody used it (PRD #50 §17). Checked after the hash comparison so the
  // answer is the same generic refusal either way.
  if (user.temporaryPasswordExpiresAt && user.temporaryPasswordExpiresAt.getTime() <= Date.now()) {
    await failed();
    await recordAuthEvent({ type: "LOGIN_FAILED", userId: user.id, ipAddress, userAgent, metadata: { reason: "TEMPORARY_PASSWORD_EXPIRED" } });
    return null;
  }

  if (user.status !== "ACTIVE") {
    await recordAuthEvent({ type: "ACCOUNT_BLOCKED", userId: user.id });
    return null;
  }

  // The Platform Admin signs in to the platform, never into a company: their
  // session names no membership, whatever else the account holds (E-06 §19,
  // §116).
  const platform = user.platformAccess?.status === "ACTIVE";

  // Otherwise no active membership in a usable company and group means no
  // workspace to enter (PRD #6 §48, E-06 §21).
  const membership = platform
    ? null
    : user.memberships.find(
        (candidate) =>
          candidate.company.status === "ACTIVE" &&
          USABLE_GROUP_STATUSES.includes(candidate.company.parentGroup.status),
      );

  if (!platform && !membership) {
    await recordAuthEvent({ type: "MEMBERSHIP_DENIED", userId: user.id });
    return null;
  }

  const session = await createSession({
    userId: user.id,
    membershipId: membership?.id ?? null,
    companyId: membership?.companyId ?? null,
    userAgent,
    ipAddress,
  });

  // The right password clears the account's failures; the address keeps
  // its count, so one good account cannot launder a spray.
  await clearThrottle("AUTH_LOGIN", { account: username });

  await recordSignIn(prisma, user.id);

  await recordAuthEvent({
    type: "LOGIN_SUCCESS",
    userId: user.id,
    companyId: membership?.companyId ?? null,
    sessionId: session.id,
    ipAddress,
    userAgent,
  });

  return {
    id: user.id,
    username: user.username,
    sessionId: session.id,
    // The caller sends them to choose a password of their own before
    // anything else (PRD #50 §16, §270).
    mustChangePassword: user.mustChangePassword,
  };
}
