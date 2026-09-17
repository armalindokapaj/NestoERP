import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { authenticateCredentials } from "@/lib/auth/credentials";
import { SignInRateLimited } from "@/lib/auth/errors";
import {
  clearThrottle,
  clientAddress,
  hitThrottle,
  peekThrottle,
  purgeExpiredThrottles,
  THROTTLES,
} from "@/lib/core/security/throttle";
import { cleanupSessions, prisma } from "../../helpers";

/**
 * Distributed throttles for the account flows (PRD #38 §17, §18, §147).
 *
 * The counters are rows in PostgreSQL, so every assertion here is about what
 * any instance would see.
 */

const PREFIXES = ["AUTH_LOGIN:", "AUTH_RESET_REQUEST:", "INVITE_RESEND:", "INVITE_ACCEPT:"];

async function clearBuckets() {
  await prisma.rateLimitBucket.deleteMany({ where: { OR: PREFIXES.map((prefix) => ({ key: { startsWith: prefix } })) } });
}

beforeEach(clearBuckets);

afterAll(async () => {
  await clearBuckets();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("hitThrottle", () => {
  it("allows up to the limit and refuses past it, with a retry hint", async () => {
    const { limit } = THROTTLES.INVITE_RESEND.invite;
    for (let i = 0; i < limit; i += 1) {
      expect((await hitThrottle("INVITE_RESEND", { invite: "invite-a" })).allowed, `attempt ${i + 1}`).toBe(true);
    }
    const refused = await hitThrottle("INVITE_RESEND", { invite: "invite-a" });
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    // The window ends where the database put it, never later: a hint longer
    // than the window is a window stored in the server's zone rather than UTC.
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(THROTTLES.INVITE_RESEND.invite.windowMs / 1000);
  });

  it("refuses when any one dimension is exhausted", async () => {
    const { limit } = THROTTLES.AUTH_RESET_REQUEST.account;
    for (let i = 0; i < limit; i += 1) {
      await hitThrottle("AUTH_RESET_REQUEST", { account: "someone@example.com", ip: `10.0.0.${i}` });
    }
    // A fresh address does not rescue an exhausted account.
    const result = await hitThrottle("AUTH_RESET_REQUEST", { account: "someone@example.com", ip: "10.0.9.9" });
    expect(result.allowed).toBe(false);
  });

  it("counts exactly under concurrency — no two instances both see room", async () => {
    await Promise.all(Array.from({ length: 20 }, () => hitThrottle("INVITE_ACCEPT", { token: "race-token" })));
    const rows = await prisma.rateLimitBucket.findMany({ where: { key: { startsWith: "INVITE_ACCEPT:token:" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(20);
  });

  it("starts a new window once the old one has ended", async () => {
    for (let i = 0; i < 4; i += 1) await hitThrottle("INVITE_RESEND", { invite: "invite-window" });
    expect((await peekThrottle("INVITE_RESEND", { invite: "invite-window" })).allowed).toBe(false);

    await prisma.rateLimitBucket.updateMany({
      where: { key: { startsWith: "INVITE_RESEND:invite:" } },
      data: { windowEndsAt: new Date(Date.now() - 1000) },
    });

    expect((await peekThrottle("INVITE_RESEND", { invite: "invite-window" })).allowed).toBe(true);
    const next = await hitThrottle("INVITE_RESEND", { invite: "invite-window" });
    expect(next).toMatchObject({ allowed: true, remaining: THROTTLES.INVITE_RESEND.invite.limit - 1 });

    // The purge takes a window that has closed and leaves the one just restarted.
    const [restarted] = await prisma.rateLimitBucket.findMany({ where: { key: { startsWith: "INVITE_RESEND:invite:" } } });
    await hitThrottle("INVITE_RESEND", { invite: "invite-closed" });
    await prisma.rateLimitBucket.updateMany({
      where: { key: { startsWith: "INVITE_RESEND:invite:" }, NOT: { key: restarted.key } },
      data: { windowEndsAt: new Date(Date.now() - 1000) },
    });

    expect(await purgeExpiredThrottles()).toBeGreaterThanOrEqual(1);
    const left = await prisma.rateLimitBucket.findMany({ where: { key: { startsWith: "INVITE_RESEND:invite:" } } });
    expect(left.map((row) => ({ key: row.key, count: row.count }))).toEqual([{ key: restarted.key, count: 1 }]);
  });

  it("never stores the subject itself (PRD #38 §18)", async () => {
    await hitThrottle("AUTH_LOGIN", { account: "private.person@example.com", ip: "203.0.113.7" });
    const keys = (await prisma.rateLimitBucket.findMany({ where: { key: { startsWith: "AUTH_LOGIN:" } } })).map(
      (row) => row.key,
    );
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).not.toContain("private.person");
      expect(key).not.toContain("203.0.113.7");
    }
  });

  it("peek does not count, and clear forgets", async () => {
    await peekThrottle("INVITE_RESEND", { invite: "invite-peek" });
    expect(await prisma.rateLimitBucket.count({ where: { key: { startsWith: "INVITE_RESEND:" } } })).toBe(0);

    await hitThrottle("INVITE_RESEND", { invite: "invite-peek" });
    await clearThrottle("INVITE_RESEND", { invite: "invite-peek" });
    expect(await prisma.rateLimitBucket.count({ where: { key: { startsWith: "INVITE_RESEND:" } } })).toBe(0);
  });
});

describe("clientAddress", () => {
  it("takes the client entry of x-forwarded-for, then x-real-ip", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(new Headers())).toBe("unknown");
  });
});

describe("sign-in throttling (PRD #38 §147)", () => {
  const headers = () => new Headers({ "x-forwarded-for": "192.0.2.44", "user-agent": "vitest" });
  const USERNAME = "architect-a";

  it("locks an account after repeated failures, even for the right password", async () => {
    const { limit } = THROTTLES.AUTH_LOGIN.account;
    for (let i = 0; i < limit; i += 1) {
      expect(await authenticateCredentials({ username: USERNAME, password: "wrong-password" }, headers())).toBeNull();
    }

    await expect(authenticateCredentials({ username: USERNAME, password: "nesto1234" }, headers())).rejects.toBeInstanceOf(
      SignInRateLimited,
    );

    const event = await prisma.authEvent.findFirst({
      where: { type: "LOGIN_RATE_LIMITED", ipAddress: "192.0.2.44" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).not.toBeNull();
  });

  it("counts an address nobody registered the same way, so lockout reveals nothing", async () => {
    const { limit } = THROTTLES.AUTH_LOGIN.account;
    for (let i = 0; i < limit; i += 1) {
      await authenticateCredentials({ username: "nobody.at.all", password: "x" }, headers());
    }
    await expect(
      authenticateCredentials({ username: "nobody.at.all", password: "x" }, headers()),
    ).rejects.toBeInstanceOf(SignInRateLimited);
  });

  it("clears the account's failures on a successful sign-in and records the address", async () => {
    await authenticateCredentials({ username: USERNAME, password: "wrong-password" }, headers());
    const user = await authenticateCredentials({ username: USERNAME, password: "nesto1234" }, headers());
    expect(user).not.toBeNull();

    const session = await prisma.session.findUniqueOrThrow({ where: { id: user!.sessionId } });
    expect(session).toMatchObject({ ipAddress: "192.0.2.44", userAgent: "vitest" });

    const accountBuckets = await prisma.rateLimitBucket.count({ where: { key: { startsWith: "AUTH_LOGIN:account:" } } });
    expect(accountBuckets).toBe(0);
  });
});
