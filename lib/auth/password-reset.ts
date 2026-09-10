import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/database/prisma";
import { sendMail } from "@/lib/mail/transport";
import { recordAuthEvent } from "./events";
import { hashPassword } from "./password";
import { revokeSessionsForUser } from "./session-store";

/**
 * Password reset (PRD #6 §55–§58).
 *
 * The raw token exists only in the emailed link; the database stores its hash,
 * so a leaked table cannot be used to reset anyone's password (PRD #6 §57).
 * Tokens expire, and a used token is retired on the spot.
 */
const TOKEN_TTL_MS = 1000 * 60 * 60; // one hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Always resolves the same way, whether or not the address exists — the caller
 * shows one generic message so the form cannot enumerate accounts (PRD #6 §55).
 */
export async function requestPasswordReset(
  email: string,
  options: { appUrl?: string } = {},
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, status: true, firstName: true, email: true },
  });

  await recordAuthEvent({ type: "PASSWORD_RESET_REQUEST", userId: user?.id ?? null });

  if (!user || user.status !== "ACTIVE") return;

  const token = randomBytes(32).toString("hex");

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const base = options.appUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  await sendMail({
    to: user.email,
    subject: "Reset your NESTO password",
    body: [
      `Hello ${user.firstName},`,
      "",
      "Use the link below to choose a new password. It expires in one hour and can only be used once.",
      "",
      `${base}/reset-password?token=${token}`,
      "",
      "If you didn't ask for this, you can ignore this message.",
    ].join("\n"),
  });
}

export type ResetTokenState = "VALID" | "EXPIRED" | "INVALID";

export async function checkResetToken(token: string): Promise<ResetTokenState> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt) return "INVALID";
  if (record.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  return "VALID";
}

export type ResetOutcome = { ok: true } | { ok: false; reason: ResetTokenState };

export async function resetPassword(token: string, newPassword: string): Promise<ResetOutcome> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt) return { ok: false, reason: "INVALID" };
  if (record.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "EXPIRED" };

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    // Any other token for this user is now meaningless.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  });

  // Existing sessions are invalidated: a reset should end access anyone else
  // obtained with the old password (PRD #6 §58).
  await revokeSessionsForUser(record.userId);

  await recordAuthEvent({ type: "PASSWORD_RESET_SUCCESS", userId: record.userId });

  return { ok: true };
}
