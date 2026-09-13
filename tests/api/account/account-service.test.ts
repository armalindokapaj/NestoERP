import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import * as account from "@/lib/modules/account/account.service";
import { changePasswordSchema, updateProfileSchema } from "@/lib/modules/account/account.schema";
import { cleanupSessions, createRawSession, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Account basics (PRD #38 §20, §142).
 *
 * The seeded Inventory account is borrowed and put back: its name and password
 * are restored after every test.
 */

const EMAIL = "inventory@nesto.test";
const PASSWORD = process.env.NESTO_DEMO_PASSWORD ?? "nesto1234";

let original: { firstName: string; lastName: string; phone: string | null };

beforeAll(async () => {
  original = await prisma.user.findUniqueOrThrow({
    where: { email: EMAIL },
    select: { firstName: true, lastName: true, phone: true },
  });
});

afterEach(async () => {
  await prisma.user.update({
    where: { email: EMAIL },
    data: { ...original, passwordHash: await hashPassword(PASSWORD) },
  });
  await prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "PASSWORD_CHANGE:" } } });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectCode(promise: Promise<unknown>, code: string, message?: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (message) expect((error as AccessError).message).toBe(message);
}

describe("profile", () => {
  it("updates the person's own name and records it", async () => {
    const context = await loginAsEmail(EMAIL);

    const updated = await account.updateProfile(
      context,
      updateProfileSchema.parse({ firstName: "  Renamed ", lastName: "Person", phone: "+355 69 000 0000" }),
    );
    expect(updated).toMatchObject({ firstName: "Renamed", lastName: "Person", phone: "+355 69 000 0000" });

    const audit = await prisma.auditEvent.findFirst({
      where: { actionKey: "USER_PROFILE_UPDATED", entityId: context.userId },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses an empty name", () => {
    const parsed = updateProfileSchema.safeParse({ firstName: " ", lastName: "x" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe("FIRST_NAME_REQUIRED");
  });
});

describe("changing the password", () => {
  it("requires the current password, and throttles wrong guesses", async () => {
    const context = await loginAsEmail(EMAIL);
    const attempt = () =>
      account.changePassword(
        context,
        changePasswordSchema.parse({
          currentPassword: "definitely-wrong",
          newPassword: "a-new-password-1",
          confirmPassword: "a-new-password-1",
        }),
      );

    for (let i = 0; i < 5; i += 1) {
      await expectCode(attempt(), "VALIDATION_ERROR", "CURRENT_PASSWORD_INCORRECT");
    }
    await expectCode(attempt(), "CONFLICT", "RATE_LIMITED");
  });

  it("changes it, ends every other session but this one, and retires reset links", async () => {
    const context = await loginAsEmail(EMAIL);
    const { session: other } = await createRawSession(EMAIL);
    await prisma.passwordResetToken.create({
      data: { userId: context.userId, tokenHash: `account-test-${Date.now()}`, expiresAt: new Date(Date.now() + 60_000) },
    });

    const outcome = await account.changePassword(
      context,
      changePasswordSchema.parse({
        currentPassword: PASSWORD,
        newPassword: "a-brand-new-password",
        confirmPassword: "a-brand-new-password",
      }),
    );
    expect(outcome.revokedSessions).toBeGreaterThanOrEqual(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: context.userId } });
    expect(await verifyPassword("a-brand-new-password", user.passwordHash)).toBe(true);
    expect(await prisma.session.findUnique({ where: { id: other.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: context.sessionId } })).not.toBeNull();
    expect(await prisma.passwordResetToken.count({ where: { userId: context.userId, usedAt: null } })).toBe(0);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { actionKey: "AUTH_PASSWORD_CHANGED", entityId: context.userId },
      orderBy: { occurredAt: "desc" },
    });
    expect(JSON.stringify(audit)).not.toContain("a-brand-new-password");
    await prisma.passwordResetToken.deleteMany({ where: { userId: context.userId } });
  });

  it("refuses a new password equal to the current one", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "same-password-1",
      newPassword: "same-password-1",
      confirmPassword: "same-password-1",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain("PASSWORD_UNCHANGED");
  });
});

describe("sessions", () => {
  it("lists only the person's own live sessions and marks this one", async () => {
    const context = await loginAsEmail(EMAIL);
    const other = await loginAs("VIEWER");

    const sessions = await account.listSessions(context);
    expect(sessions.some((session) => session.id === context.sessionId && session.current)).toBe(true);
    expect(sessions.some((session) => session.id === other.sessionId)).toBe(false);
  });

  it("answers NOT_FOUND for somebody else's session, and leaves it alone", async () => {
    const context = await loginAsEmail(EMAIL);
    const other = await loginAs("VIEWER");

    await expectCode(account.revokeOwnSession(context, other.sessionId), "NOT_FOUND");
    expect(await prisma.session.findUnique({ where: { id: other.sessionId } })).not.toBeNull();
  });

  it("signs out other sessions, then everywhere", async () => {
    const context = await loginAsEmail(EMAIL);
    const { session: second } = await createRawSession(EMAIL);

    expect(await account.revokeOtherSessions(context)).toBeGreaterThanOrEqual(1);
    expect(await prisma.session.findUnique({ where: { id: second.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: context.sessionId } })).not.toBeNull();

    await account.revokeAllSessions(context);
    expect(await prisma.session.count({ where: { userId: context.userId } })).toBe(0);

    const audit = await prisma.auditEvent.findMany({
      where: { actionKey: "AUTH_SESSIONS_REVOKED", entityId: context.userId },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});

describe("describeDevice", () => {
  it("names the browser and system without keeping the whole agent string", () => {
    expect(
      account.describeDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      ),
    ).toBe("Chrome on macOS");
    expect(account.describeDevice(null)).toBe("Unknown device");
  });
});
