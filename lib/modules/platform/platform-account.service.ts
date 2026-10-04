import { AccessError } from "@/lib/access/guards";
import { recordAuthEvent } from "@/lib/auth/events";
import { setPassword } from "@/lib/auth/identity";
import { verifyPassword } from "@/lib/auth/password";
import { startRecoveryEmailChange, type RecoveryEmailStartOutcome } from "@/lib/auth/password-recovery";
import { revokeSessions } from "@/lib/auth/session-store";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordGlobalPlatformAction } from "@/lib/core/audit/audit.service";
import { hitThrottle, peekThrottle } from "@/lib/core/security/throttle";
import { prisma } from "@/lib/database/prisma";
import { describeDevice } from "@/lib/modules/account/account.service";
import type { ChangePasswordInput } from "@/lib/modules/account/account.schema";

/**
 * My Account & Security for a Platform Admin (ADM-01).
 *
 * A platform account has no company membership, so the tenant account service
 * (which runs on a company context) cannot serve it, and none is forced onto
 * it. The credential writes are Auth's own helpers; the audit is platform-wide.
 */

export type PlatformAccountDTO = {
  username: string;
  fullName: string;
  recoveryEmail: string | null;
  recoveryEmailVerifiedAt: string | null;
  pendingRecoveryEmail: { email: string; expiresAt: string } | null;
  sessions: Array<{ id: string; current: boolean; device: string; ipAddress: string | null; createdAt: string; expiresAt: string }>;
};

export async function getPlatformAccount(context: PlatformContext): Promise<PlatformAccountDTO> {
  const [user, pending, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: context.userId }, select: { username: true, recoveryEmail: true, recoveryEmailVerifiedAt: true } }),
    prisma.recoveryEmailChallenge.findFirst({ where: { userId: context.userId, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { email: true, expiresAt: true } }),
    prisma.session.findMany({ where: { userId: context.userId, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true } }),
  ]);
  return {
    username: user.username,
    fullName: context.fullName,
    recoveryEmail: user.recoveryEmail,
    recoveryEmailVerifiedAt: user.recoveryEmailVerifiedAt?.toISOString() ?? null,
    pendingRecoveryEmail: pending ? { email: pending.email, expiresAt: pending.expiresAt.toISOString() } : null,
    sessions: sessions.map((session) => ({ id: session.id, current: session.id === context.sessionId, device: describeDevice(session.userAgent), ipAddress: session.ipAddress, createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString() })),
  };
}

/** Who changes their own password: a Platform Admin or a group-only person (Admin PRD #9). */
export type AccountActor = Pick<PlatformContext, "userId" | "sessionId" | "fullName"> & { roleKey: string };

async function guardPassword(context: Pick<AccountActor, "userId">, currentPassword: string): Promise<boolean> {
  const allowance = await peekThrottle("PASSWORD_CHANGE", { account: context.userId });
  if (!allowance.allowed) throw new AccessError("CONFLICT", "RATE_LIMITED", { retryAfterSeconds: allowance.retryAfterSeconds });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: context.userId }, select: { passwordHash: true } });
  if (await verifyPassword(currentPassword, user.passwordHash)) return true;
  await hitThrottle("PASSWORD_CHANGE", { account: context.userId });
  return false;
}

export async function changePlatformPassword(context: AccountActor, input: ChangePasswordInput, meta: { ipAddress?: string | null; userAgent?: string | null } = {}): Promise<{ revokedSessions: number }> {
  if (!(await guardPassword(context, input.currentPassword))) throw new AccessError("VALIDATION_ERROR", "CURRENT_PASSWORD_INCORRECT");
  const revoked = await prisma.$transaction(async (tx) => {
    await setPassword(tx, context.userId, input.newPassword);
    const sessions = await revokeSessions(tx, { userId: context.userId, exceptSessionId: context.sessionId });
    await recordGlobalPlatformAction(context, { actionKey: AuditAction.AUTH_PASSWORD_CHANGED, entity: { type: "User", id: context.userId, label: context.fullName }, metadata: { otherSessionsRevoked: sessions } }, { tx });
    return sessions;
  });
  await recordAuthEvent({ type: "PASSWORD_CHANGED", userId: context.userId, sessionId: context.sessionId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  return { revokedSessions: revoked };
}

/** Recent authentication (the current password) before a verification link goes to the new address. */
export async function startPlatformRecoveryEmail(context: PlatformContext, input: { email: string; currentPassword: string }): Promise<RecoveryEmailStartOutcome> {
  if (!(await guardPassword(context, input.currentPassword))) return { ok: false, code: "CURRENT_PASSWORD_INCORRECT" };
  return startRecoveryEmailChange(context.userId, input);
}

async function recordRevocation(context: PlatformContext, scope: string, revoked: number) {
  await recordGlobalPlatformAction(context, { actionKey: AuditAction.AUTH_SESSIONS_REVOKED, entity: { type: "User", id: context.userId, label: context.fullName }, after: { scope, revoked } });
}

export async function revokePlatformOwnSession(context: PlatformContext, sessionId: string): Promise<{ current: boolean }> {
  const revoked = await revokeSessions(prisma, { sessionId, userId: context.userId });
  if (revoked === 0) throw new AccessError("NOT_FOUND", "That session does not exist.");
  await recordRevocation(context, sessionId === context.sessionId ? "current" : "one", 1);
  return { current: sessionId === context.sessionId };
}

export async function revokePlatformOtherSessions(context: PlatformContext): Promise<number> {
  const revoked = await revokeSessions(prisma, { userId: context.userId, exceptSessionId: context.sessionId });
  await recordRevocation(context, "others", revoked);
  return revoked;
}

export async function revokePlatformAllSessions(context: PlatformContext): Promise<number> {
  const revoked = await revokeSessions(prisma, { userId: context.userId });
  await recordRevocation(context, "all", revoked);
  return revoked;
}
