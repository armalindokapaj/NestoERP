import { AccessError } from "@/lib/access/guards";
import { effectivePolicyForUser } from "@/lib/core/security/mobile-policy.service";
import { hitThrottle, peekThrottle } from "@/lib/core/security/throttle";
import { prisma } from "@/lib/database/prisma";
import { recordAuthEvent } from "./events";
import { verifyPassword } from "./password";
import { markRecentAuthentication } from "./session-store";

/**
 * Recent authentication for sensitive actions (MOB-11 §47-§49).
 *
 * A session that is merely valid is not enough to end someone's other devices or
 * change the mobile policy: a stolen, unlocked phone would be enough. The
 * session row remembers when the server last saw the person prove who they are
 * (`recentAuthAt`, set at sign-in and by a password check below); a sensitive
 * action asks whether that is inside the policy's window. It is server state, in
 * server time — nothing the client sends is read for it — and it does not assume
 * a password: whatever authenticates the person later (SSO) sets the same field.
 */

/** The window in use when the policy cannot be read; short on purpose. */
const FALLBACK_WINDOW_MINUTES = 15;

/** What recent authentication needs of a caller: a company context or a platform one. */
type Caller = { userId: string; sessionId: string; companyId?: string | null };

export async function hasRecentAuthentication(context: Caller, now: number = Date.now()): Promise<boolean> {
  if (!context.sessionId) return false;
  const [session, policy] = await Promise.all([
    prisma.session.findUnique({ where: { id: context.sessionId }, select: { recentAuthAt: true, userId: true } }),
    effectivePolicyForUser(context.userId).catch(() => null),
  ]);
  if (!session || session.userId !== context.userId) return false;
  const windowMs = (policy?.recentAuthMinutes ?? FALLBACK_WINDOW_MINUTES) * 60_000;
  return now - session.recentAuthAt.getTime() <= windowMs;
}

/** Throws `REAUTH_REQUIRED` (403) when the last sign-in is older than the window. Fails closed. */
export async function assertRecentAuthentication(context: Caller): Promise<void> {
  if (!(await hasRecentAuthentication(context))) throw new AccessError("REAUTH_REQUIRED");
}

/**
 * Proves the current person again with their password. Wrong guesses are
 * throttled per account, like every other place that checks a password, so a
 * stolen session cannot be used as a password oracle (PRD #38 §17).
 */
export async function reauthenticateWithPassword(context: Caller, password: string, request: { ipAddress?: string | null; userAgent?: string | null } = {}): Promise<void> {
  const allowance = await peekThrottle("PASSWORD_CHANGE", { account: context.userId });
  if (!allowance.allowed) throw new AccessError("CONFLICT", "RATE_LIMITED", { retryAfterSeconds: allowance.retryAfterSeconds });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: context.userId }, select: { passwordHash: true } });
  if (!password || !(await verifyPassword(password, user.passwordHash))) {
    await hitThrottle("PASSWORD_CHANGE", { account: context.userId });
    throw new AccessError("VALIDATION_ERROR", "CURRENT_PASSWORD_INCORRECT");
  }
  if (!(await markRecentAuthentication(context.sessionId, context.userId))) throw new AccessError("UNAUTHENTICATED");
  await recordAuthEvent({ type: "SENSITIVE_REAUTH", userId: context.userId, companyId: context.companyId, sessionId: context.sessionId, ipAddress: request.ipAddress, userAgent: request.userAgent });
}
