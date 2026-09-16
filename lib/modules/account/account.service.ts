import { AccessError } from "@/lib/access/guards";
import { recordAuthEvent } from "@/lib/auth/events";
import { verifyPassword } from "@/lib/auth/password";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { hitThrottle, peekThrottle } from "@/lib/core/security/throttle";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import type { ChangePasswordInput, UpdateProfileInput } from "./account.schema";
import { setPassword } from "@/lib/auth/identity";
import { revokeSessions } from "@/lib/auth/session-store";

/**
 * Account basics (PRD #38 §20).
 *
 * Everything here acts on the signed-in person's own account and nothing else,
 * so the only authorisation is the session itself: there is no permission to
 * edit your own name. A session id or user id is never taken from the client —
 * both come from the resolved context.
 */

export type AccountSessionDTO = {
  id: string;
  current: boolean;
  companyName: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  device: string;
};

export type ProfileDTO = {
  firstName: string;
  lastName: string;
  /** What the account signs in with (PRD #50 §6). Never editable here. */
  username: string;
  /** Contact metadata, and absent on accounts that were never given one (§67). */
  email: string | null;
  phone: string | null;
};

export async function getProfile(context: UserContext): Promise<ProfileDTO> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: context.userId },
    select: { firstName: true, lastName: true, username: true, email: true, phone: true },
  });
  return user;
}

export async function updateProfile(context: UserContext, input: UpdateProfileInput): Promise<ProfileDTO> {
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: context.userId },
    select: { firstName: true, lastName: true, phone: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: context.userId },
      data: { firstName: input.firstName, lastName: input.lastName, phone: input.phone },
      select: { firstName: true, lastName: true, username: true, email: true, phone: true },
    });

    await recordUserAction(
      context,
      {
        actionKey: AuditAction.USER_PROFILE_UPDATED,
        entity: { type: "User", id: context.userId, label: `${user.firstName} ${user.lastName}` },
        before,
        after: { firstName: user.firstName, lastName: user.lastName, phone: user.phone },
      },
      { tx },
    );

    return user;
  });

  return updated;
}

export type ChangePasswordOutcome = { revokedSessions: number };

/**
 * Changes the password after proving the current one.
 *
 * Wrong guesses are throttled per account (PRD #38 §17) — a stolen session
 * must not become an oracle for the password. On success every other session
 * is signed out, the way a reset does, and any outstanding reset link stops
 * working (PRD #6 §58).
 */
export async function changePassword(
  context: UserContext,
  input: ChangePasswordInput,
  request: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<ChangePasswordOutcome> {
  const allowance = await peekThrottle("PASSWORD_CHANGE", { account: context.userId });
  if (!allowance.allowed) {
    throw new AccessError("CONFLICT", "RATE_LIMITED", { retryAfterSeconds: allowance.retryAfterSeconds });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: context.userId },
    select: { passwordHash: true },
  });

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await hitThrottle("PASSWORD_CHANGE", { account: context.userId });
    throw new AccessError("VALIDATION_ERROR", "CURRENT_PASSWORD_INCORRECT");
  }

  const revoked = await prisma.$transaction(async (tx) => {
    // Auth owns the credential and the reset links that could undo this
    // (PRD #48 §11); the other devices go with it.
    await setPassword(tx, context.userId, input.newPassword);
    const sessions = await revokeSessions(tx, { userId: context.userId, exceptSessionId: context.sessionId });

    // Required evidence, committed with the change — never the password
    // itself (PRD #38 §156).
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.AUTH_PASSWORD_CHANGED,
        entity: { type: "User", id: context.userId, label: context.fullName },
        metadata: { otherSessionsRevoked: sessions },
      },
      { tx },
    );

    return sessions;
  });

  await recordAuthEvent({
    type: "PASSWORD_CHANGED",
    userId: context.userId,
    companyId: context.companyId,
    sessionId: context.sessionId,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
  });

  return { revokedSessions: revoked };
}

/** A readable device label from a user agent, without keeping the whole string on screen. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const system = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown device";
}

export async function listSessions(context: UserContext): Promise<AccountSessionDTO[]> {
  const sessions = await prisma.session.findMany({
    where: { userId: context.userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
      company: { select: { name: true } },
    },
  });

  return sessions.map((session) => ({
    id: session.id,
    current: session.id === context.sessionId,
    companyName: session.company.name,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    ipAddress: session.ipAddress,
    device: describeDevice(session.userAgent),
  }));
}

async function recordRevocation(context: UserContext, scope: string, revoked: number): Promise<void> {
  await recordUserAction(context, {
    actionKey: AuditAction.AUTH_SESSIONS_REVOKED,
    entity: { type: "User", id: context.userId, label: context.fullName },
    after: { scope, revoked },
  });
  await recordAuthEvent({
    type: "SESSIONS_REVOKED",
    userId: context.userId,
    companyId: context.companyId,
    sessionId: context.sessionId,
    metadata: { scope, revoked },
  });
}

/**
 * Ends one of the person's own sessions. Another user's session id answers
 * NOT_FOUND, exactly like an id that does not exist.
 */
export async function revokeOwnSession(context: UserContext, sessionId: string): Promise<{ current: boolean }> {
  const revoked = await revokeSessions(prisma, { sessionId, userId: context.userId });
  if (revoked === 0) throw new AccessError("NOT_FOUND", "That session does not exist.");
  await recordRevocation(context, sessionId === context.sessionId ? "current" : "one", 1);
  return { current: sessionId === context.sessionId };
}

export async function revokeOtherSessions(context: UserContext): Promise<number> {
  const revoked = await revokeSessions(prisma, { userId: context.userId, exceptSessionId: context.sessionId });
  await recordRevocation(context, "others", revoked);
  return revoked;
}

/** Signs the person out everywhere, including here (PRD #38 §20). */
export async function revokeAllSessions(context: UserContext): Promise<number> {
  const revoked = await revokeSessions(prisma, { userId: context.userId });
  await recordRevocation(context, "all", revoked);
  return revoked;
}
