import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { completePasswordReset, confirmRecoveryEmail, requestPasswordReset, startRecoveryEmailChange } from "@/lib/auth/password-recovery";
import { clearOutbox, readOutbox } from "@/lib/mail";
import { prisma } from "../../helpers";

/**
 * Self-service recovery through a verified recovery email (ADM-01): valid,
 * expired, replayed, concurrent and suspended-account cases.
 */

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = "original-password-1";
const made: string[] = [];

async function account(label: string) {
  const template = await prisma.user.findFirstOrThrow({ where: { username: "engineer-a" }, select: { passwordHash: true } });
  const user = await prisma.user.create({
    data: { username: `recover.${label}.${suffix}`, firstName: "Recover", lastName: label, passwordHash: template.passwordHash },
    select: { id: true, username: true },
  });
  made.push(user.id);
  return user;
}

const tokenIn = (text: string, path: string) => new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? null;
const lastMailTo = (to: string) => [...readOutbox()].reverse().find((mail) => mail.to === to);

/** Gives the account a verified recovery address the way the product does: a challenge, then its link. */
async function verifiedRecovery(user: { id: string }, email: string) {
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  const started = await startRecoveryEmailChange(user.id, { email, currentPassword: PASSWORD });
  expect(started.ok).toBe(true);
  const token = tokenIn(lastMailTo(email)!.text, "/verify-recovery-email");
  expect(await confirmRecoveryEmail(token!)).toEqual({ ok: true });
}

async function resetLinkFor(identifier: string, to: string) {
  clearOutbox();
  await requestPasswordReset(identifier);
  const mail = lastMailTo(to);
  return mail ? tokenIn(mail.text, "/reset-password") : null;
}

beforeEach(() => clearOutbox());

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: made } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: made } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: made } } });
  await prisma.mailDelivery.deleteMany({ where: { recipient: { endsWith: `.${suffix}@example.test` } } });
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  await prisma.$disconnect();
});

describe("password recovery", () => {
  it("sends nothing for an account without a verified recovery email, and answers the same", async () => {
    const user = await account("none");
    await prisma.user.update({ where: { id: user.id }, data: { email: `contact.${suffix}@example.test` } });
    await expect(requestPasswordReset(user.username)).resolves.toBeUndefined();
    await expect(requestPasswordReset(`contact.${suffix}@example.test`)).resolves.toBeUndefined();
    await expect(requestPasswordReset(`nobody.${suffix}`)).resolves.toBeUndefined();
    expect(readOutbox()).toHaveLength(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it("resets through a valid link: new password, every session ended, audited, the address told, no sign-in", async () => {
    const user = await account("valid");
    const email = `valid.${suffix}@example.test`;
    await verifiedRecovery(user, email);
    await prisma.session.create({ data: { sessionToken: `recover-${suffix}-a`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) } });

    const token = await resetLinkFor(email, email);
    expect(token).toBeTruthy();
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id, usedAt: null } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);

    clearOutbox();
    expect(await completePasswordReset(token!, "a-brand-new-password")).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(await verifyPassword("a-brand-new-password", after.passwordHash)).toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, actionKey: "AUTH_PASSWORD_RESET_COMPLETED" } })).toBe(1);
    expect(lastMailTo(email)?.subject).toBe("Your NESTO password was reset");
    expect(lastMailTo(email)?.text).not.toContain("a-brand-new-password");

    // Replayed: the spent link changes nothing.
    expect(await completePasswordReset(token!, "a-third-password-99")).toEqual({ ok: false, reason: "INVALID" });
    const still = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(still.passwordHash).toBe(after.passwordHash);
  });

  it("refuses an expired link and changes nothing", async () => {
    const user = await account("expired");
    const email = `expired.${suffix}@example.test`;
    await verifiedRecovery(user, email);
    const token = await resetLinkFor(user.username, email);
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(await completePasswordReset(token!, "never-applied-password")).toEqual({ ok: false, reason: "EXPIRED" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } })).passwordHash).toBe(before.passwordHash);
  });

  it("lets exactly one of two concurrent submissions of one link win", async () => {
    const user = await account("race");
    const email = `race.${suffix}@example.test`;
    await verifiedRecovery(user, email);
    const token = await resetLinkFor(user.username, email);
    const results = await Promise.all([completePasswordReset(token!, "racer-one-password"), completePasswordReset(token!, "racer-two-password")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("retires the previous link when another is requested", async () => {
    const user = await account("twice");
    const email = `twice.${suffix}@example.test`;
    await verifiedRecovery(user, email);
    const first = await resetLinkFor(user.username, email);
    const second = await resetLinkFor(user.username, email);
    expect(await completePasswordReset(first!, "first-link-password")).toEqual({ ok: false, reason: "INVALID" });
    expect(await completePasswordReset(second!, "second-link-password")).toEqual({ ok: true });
  });

  it("neither sends to nor reactivates a suspended account", async () => {
    const user = await account("suspended");
    const email = `suspended.${suffix}@example.test`;
    await verifiedRecovery(user, email);
    const token = await resetLinkFor(user.username, email);
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    expect(await completePasswordReset(token!, "suspended-new-password")).toEqual({ ok: false, reason: "INVALID" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, status: true } })).toEqual({ passwordHash: before.passwordHash, status: "SUSPENDED" });
    expect(await resetLinkFor(user.username, email)).toBeNull();
  });

  it("changes the recovery email only after the new address confirms, and tells the old one", async () => {
    const user = await account("change");
    const oldEmail = `old.${suffix}@example.test`;
    const newEmail = `new.${suffix}@example.test`;
    await verifiedRecovery(user, oldEmail);

    expect(await startRecoveryEmailChange(user.id, { email: newEmail, currentPassword: "wrong-password" })).toEqual({ ok: false, code: "CURRENT_PASSWORD_INCORRECT" });
    expect(await startRecoveryEmailChange(user.id, { email: newEmail, currentPassword: PASSWORD })).toMatchObject({ ok: true });
    const confirm = tokenIn(lastMailTo(newEmail)?.text ?? "", "/verify-recovery-email");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { recoveryEmail: true } })).recoveryEmail).toBe(oldEmail);
    // Until then, a reset still goes to the verified address only.
    expect(await resetLinkFor(newEmail, newEmail)).toBeNull();

    expect(await confirmRecoveryEmail(confirm!)).toEqual({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { recoveryEmail: true } })).recoveryEmail).toBe(newEmail);
    expect(lastMailTo(oldEmail)?.subject).toBe("Your NESTO recovery email changed");
    expect(await confirmRecoveryEmail(confirm!)).toEqual({ ok: false, reason: "INVALID" });
  });
});
