import { createHash, randomBytes } from "node:crypto";

import { appLink } from "@/lib/config/app-url";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordAuditEvent } from "@/lib/core/audit/audit.service";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { prisma } from "@/lib/database/prisma";
import { sendMail } from "@/lib/mail";
import { recordAuthEvent } from "./events";
import { setPassword } from "./identity";
import { verifyPassword } from "./password";
import { revokeSessions } from "./session-store";
import { normaliseUsername } from "./username";

/**
 * Self-service password recovery (ADM-01).
 *
 * PRD #50 removed the email reset because `User.email` is contact data nobody
 * ever proved they own. Recovery comes back on a different footing: a link is
 * only ever sent to `recoveryEmail`, which is written by nothing except a
 * completed verification challenge. An account without one has no
 * self-service recovery — its administrator issues a temporary password, as
 * before.
 *
 * Tokens are random, stored as SHA-256 hashes, single-use and short-lived. The
 * reset is one transaction: claim the token, set the password (which voids
 * every other link), end every session, record the audit. Nothing signs the
 * person in afterwards. Recovery never changes an account's status, so a
 * suspended account stays suspended and revoked platform access stays revoked.
 */

export const RESET_TTL_MINUTES = 30;
export const VERIFY_TTL_MINUTES = 60;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

export type RecoveryRequestMeta = { ipAddress?: string | null; userAgent?: string | null };

function actor(user: { id: string; firstName: string; lastName: string }) {
  return { type: "USER" as const, userId: user.id, memberId: null, displayNameSnapshot: `${user.firstName} ${user.lastName}`.trim(), roleSnapshot: "SELF" };
}

/** An address for the audit trail, without writing the address itself there. */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain ?? ""}`;
}

/**
 * Sends a reset link when the identifier names an active account with a
 * verified recovery address. Always resolves the same way; the caller gives
 * one acknowledgement whatever happened.
 */
export async function requestPasswordReset(identifier: string, meta: RecoveryRequestMeta = {}): Promise<void> {
  const value = identifier.trim();
  const byEmail = value.includes("@");
  const user = await prisma.user.findFirst({
    where: byEmail
      ? { recoveryEmail: value.toLowerCase(), recoveryEmailVerifiedAt: { not: null } }
      : { username: normaliseUsername(value) },
    select: { id: true, status: true, firstName: true, recoveryEmail: true, recoveryEmailVerifiedAt: true },
  });

  await recordAuthEvent({ type: "PASSWORD_RESET_REQUEST", userId: user?.id ?? null, ipAddress: meta.ipAddress, userAgent: meta.userAgent });

  if (!user || user.status !== "ACTIVE" || !user.recoveryEmail || !user.recoveryEmailVerifiedAt) return;

  const token = newToken();
  const created = await prisma.$transaction(async (tx) => {
    // One live link at a time: asking again retires the previous one.
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    return tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) },
      select: { id: true },
    });
  });

  await sendMail({
    to: user.recoveryEmail,
    templateKey: "auth.password_reset",
    variables: { firstName: user.firstName, resetUrl: appLink(`/reset-password?token=${token}`), expiresInMinutes: String(RESET_TTL_MINUTES) },
    idempotencyKey: `password-reset:${created.id}`,
    entity: { type: "PasswordResetToken", id: created.id },
  });
}

export type TokenState = "VALID" | "EXPIRED" | "INVALID";

export async function checkResetToken(token: string): Promise<TokenState> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, select: { expiresAt: true, usedAt: true } });
  if (!record || record.usedAt) return "INVALID";
  return record.expiresAt.getTime() <= Date.now() ? "EXPIRED" : "VALID";
}

export type ResetOutcome = { ok: true } | { ok: false; reason: TokenState };

class Refused extends Error {
  constructor(readonly reason: TokenState) {
    super(reason);
  }
}

/**
 * Completes a reset. An unknown, used or expired link changes nothing; so does
 * a link for an account that is no longer active. Two submissions of one link
 * race on the claim, and only one of them sets a password.
 */
export async function completePasswordReset(token: string, newPassword: string, meta: RecoveryRequestMeta = {}): Promise<ResetOutcome> {
  const tokenHash = hashToken(token);
  let notify: { to: string; firstName: string } | null = null;
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, expiresAt: true, usedAt: true } });
      if (!record || record.usedAt) throw new Refused("INVALID");
      if (record.expiresAt.getTime() <= Date.now()) throw new Refused("EXPIRED");
      const user = await tx.user.findUniqueOrThrow({ where: { id: record.userId }, select: { id: true, status: true, firstName: true, lastName: true, recoveryEmail: true } });
      if (user.status !== "ACTIVE") throw new Refused("INVALID");

      const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new Refused("INVALID");

      await setPassword(tx, user.id, newPassword);
      const sessionsRevoked = await revokeSessions(tx, { userId: user.id });
      await recordAuditEvent(
        { companyId: null, actor: actor(user), ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
        { actionKey: AuditAction.AUTH_PASSWORD_RESET_COMPLETED, entity: { type: "User", id: user.id, label: `${user.firstName} ${user.lastName}`.trim() }, metadata: { sessionsRevoked } },
        { tx },
      );
      if (user.recoveryEmail) notify = { to: user.recoveryEmail, firstName: user.firstName };
      return user.id;
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  }

  await recordAuthEvent({ type: "PASSWORD_RESET_SUCCESS", userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  const recipient = notify as { to: string; firstName: string } | null;
  if (recipient) {
    await sendMail({ to: recipient.to, templateKey: "auth.password_reset_completed", variables: { firstName: recipient.firstName, loginUrl: appLink("/login") }, entity: { type: "User", id: userId } });
  }
  return { ok: true };
}

export type RecoveryEmailStartOutcome = { ok: true; expiresInMinutes: number } | { ok: false; code: "CURRENT_PASSWORD_INCORRECT" | "RECOVERY_EMAIL_UNCHANGED" | "RECOVERY_EMAIL_TAKEN" };

/**
 * Starts replacing the recovery address. Needs the current password — recent
 * proof it is the holder, not an unattended session — and changes nothing
 * until the new address confirms.
 */
export async function startRecoveryEmailChange(userId: string, input: { email: string; currentPassword: string }): Promise<RecoveryEmailStartOutcome> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, firstName: true, passwordHash: true, recoveryEmail: true } });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) return { ok: false, code: "CURRENT_PASSWORD_INCORRECT" };
  if (user.recoveryEmail === email) return { ok: false, code: "RECOVERY_EMAIL_UNCHANGED" };
  if (await prisma.user.count({ where: { recoveryEmail: email, id: { not: user.id } } })) return { ok: false, code: "RECOVERY_EMAIL_TAKEN" };

  const token = newToken();
  const challenge = await prisma.$transaction(async (tx) => {
    await tx.recoveryEmailChallenge.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    return tx.recoveryEmailChallenge.create({
      data: { userId: user.id, email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MINUTES * 60_000) },
      select: { id: true },
    });
  });

  await sendMail({
    to: email,
    templateKey: "auth.recovery_email_verify",
    variables: { firstName: user.firstName, verifyUrl: appLink(`/verify-recovery-email?token=${token}`), expiresInMinutes: String(VERIFY_TTL_MINUTES) },
    idempotencyKey: `recovery-email:${challenge.id}`,
    entity: { type: "RecoveryEmailChallenge", id: challenge.id },
  });
  return { ok: true, expiresInMinutes: VERIFY_TTL_MINUTES };
}

/**
 * Confirms a new recovery address from its link. The previous address is told,
 * so a takeover that swapped the address does not go unnoticed.
 */
export async function confirmRecoveryEmail(token: string, meta: RecoveryRequestMeta = {}): Promise<{ ok: true } | { ok: false; reason: TokenState }> {
  let previous: { to: string; firstName: string } | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const challenge = await tx.recoveryEmailChallenge.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, userId: true, email: true, expiresAt: true, usedAt: true } });
      if (!challenge || challenge.usedAt) throw new Refused("INVALID");
      if (challenge.expiresAt.getTime() <= Date.now()) throw new Refused("EXPIRED");
      const user = await tx.user.findUniqueOrThrow({ where: { id: challenge.userId }, select: { id: true, status: true, firstName: true, lastName: true, recoveryEmail: true } });
      if (user.status !== "ACTIVE") throw new Refused("INVALID");
      const claimed = await tx.recoveryEmailChallenge.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new Refused("INVALID");
      // Somebody else confirmed this address in the meantime.
      if (await tx.user.count({ where: { recoveryEmail: challenge.email, id: { not: user.id } } })) throw new Refused("INVALID");

      await tx.user.update({ where: { id: user.id }, data: { recoveryEmail: challenge.email, recoveryEmailVerifiedAt: new Date() } });
      await recordAuditEvent(
        { companyId: null, actor: actor(user), ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null },
        { actionKey: AuditAction.AUTH_RECOVERY_EMAIL_CHANGED, entity: { type: "User", id: user.id, label: `${user.firstName} ${user.lastName}`.trim() }, before: { recoveryEmail: maskEmail(user.recoveryEmail) }, after: { recoveryEmail: maskEmail(challenge.email) } },
        { tx },
      );
      if (user.recoveryEmail && user.recoveryEmail !== challenge.email) previous = { to: user.recoveryEmail, firstName: user.firstName };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.reason };
    throw error;
  }

  const recipient = previous as { to: string; firstName: string } | null;
  if (recipient) {
    try {
      await sendMail({ to: recipient.to, templateKey: "auth.recovery_email_changed", variables: { firstName: recipient.firstName, loginUrl: appLink("/login") } });
    } catch (error) {
      logger.error("recovery.previous_address_notice_failed", { error: serialiseError(error) });
    }
  }
  return { ok: true };
}
