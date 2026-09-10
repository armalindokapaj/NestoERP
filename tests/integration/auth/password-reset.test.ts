import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  checkResetToken,
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth/password-reset";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearOutbox, readOutbox } from "@/lib/mail/transport";
import { cleanupSessions, createRawSession, prisma } from "../../helpers";

/**
 * Password reset tests (PRD #9 §225).
 *
 * The test transport captures the message, so the link can be read without any
 * mail ever leaving the machine (PRD #9 §224).
 */
const EMAIL = "architect@nesto.test";

function linkToken(): string {
  const message = readOutbox().at(-1);
  if (!message) throw new Error("No reset message was captured.");
  const match = message.body.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error("No token in the reset message.");
  return match[1];
}

beforeEach(async () => {
  clearOutbox();
  await prisma.passwordResetToken.deleteMany({ where: { user: { email: EMAIL } } });
});

afterAll(async () => {
  // Restore the seeded password so the rest of the suite still signs in.
  await prisma.user.update({
    where: { email: EMAIL },
    data: { passwordHash: await hashPassword("nesto1234") },
  });
  await prisma.passwordResetToken.deleteMany({ where: { user: { email: EMAIL } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("requesting a reset", () => {
  it("stores only a hash of the token, never the token itself", async () => {
    await requestPasswordReset(EMAIL);
    const token = linkToken();

    const rows = await prisma.passwordResetToken.findMany({
      where: { user: { email: EMAIL } },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toHaveLength(64);
  });

  it("says nothing about an unknown address (PRD #6 §55)", async () => {
    await expect(requestPasswordReset("nobody@nesto.test")).resolves.toBeUndefined();
    expect(readOutbox()).toHaveLength(0);
  });

  it("sends nothing for an inactive account", async () => {
    await requestPasswordReset("inactive-user@nesto.test");
    expect(readOutbox()).toHaveLength(0);
  });

  it("records the request as an authentication event (PRD #6 §101)", async () => {
    await requestPasswordReset(EMAIL);

    const event = await prisma.authEvent.findFirst({
      where: { type: "PASSWORD_RESET_REQUEST", user: { email: EMAIL } },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
  });
});

describe("using a reset link (PRD #6 §57)", () => {
  it("accepts a valid token exactly once", async () => {
    await requestPasswordReset(EMAIL);
    const token = linkToken();

    expect(await checkResetToken(token)).toBe("VALID");

    const first = await resetPassword(token, "a-brand-new-password");
    expect(first.ok).toBe(true);

    const second = await resetPassword(token, "another-password-entirely");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("INVALID");
  });

  it("actually changes the stored password", async () => {
    await requestPasswordReset(EMAIL);
    await resetPassword(linkToken(), "a-brand-new-password");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword("a-brand-new-password", user.passwordHash)).toBe(true);
    expect(await verifyPassword("nesto1234", user.passwordHash)).toBe(false);
  });

  it("refuses an expired token", async () => {
    await requestPasswordReset(EMAIL);
    const token = linkToken();

    await prisma.passwordResetToken.updateMany({
      where: { user: { email: EMAIL } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await checkResetToken(token)).toBe("EXPIRED");
    const result = await resetPassword(token, "does-not-matter-here");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("EXPIRED");
  });

  it("refuses a token that was never issued", async () => {
    expect(await checkResetToken("not-a-real-token")).toBe("INVALID");
  });

  it("signs out existing sessions (PRD #6 §58)", async () => {
    const { session } = await createRawSession(EMAIL);
    await requestPasswordReset(EMAIL);
    await resetPassword(linkToken(), "a-brand-new-password");

    const after = await prisma.session.findUnique({ where: { id: session.id } });
    expect(after).toBeNull();
  });

  it("retires every other outstanding token for that user", async () => {
    await requestPasswordReset(EMAIL);
    const first = linkToken();
    await requestPasswordReset(EMAIL);
    const second = linkToken();

    await resetPassword(second, "a-brand-new-password");

    expect(await checkResetToken(first)).toBe("INVALID");
  });
});
