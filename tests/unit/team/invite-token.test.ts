import { afterEach, describe, expect, it } from "vitest";

import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteUrl,
  isInviteExpired,
  normalizeEmail,
  tokensMatch,
} from "@/lib/modules/team/invitations/invite.token";

/** Invitation token rules (PRD #14 §237–§241, §318). */
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("token generation (PRD #14 §238)", () => {
  it("produces a long URL-safe token", () => {
    const token = generateInviteToken();
    // 32 bytes as base64url: long enough that guessing is not a strategy, and
    // safe to put in a path segment without escaping.
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
    expect(tokens.size).toBe(50);
  });

  it("stores a hash, not the token", () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("hashes deterministically, so a link can be looked up", () => {
    expect(hashInviteToken("same-token")).toBe(hashInviteToken("same-token"));
    expect(hashInviteToken("a")).not.toBe(hashInviteToken("b"));
  });
});

describe("comparison", () => {
  it("matches equal values and rejects different ones", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
    expect(tokensMatch("abc123", "abc124")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the guard has to come
    // first — an exception here would be a 500 instead of a refusal.
    expect(tokensMatch("short", "much-longer-value")).toBe(false);
  });
});

describe("expiry (PRD #14 §68, §236)", () => {
  it("defaults to seven days", () => {
    const now = new Date("2026-03-01T10:00:00.000Z");
    const expires = inviteExpiry(now);
    expect(Math.round((expires.getTime() - now.getTime()) / 86_400_000)).toBe(7);
  });

  it("honours TEAM_INVITE_EXPIRY_DAYS", () => {
    process.env.TEAM_INVITE_EXPIRY_DAYS = "3";
    const now = new Date("2026-03-01T10:00:00.000Z");
    expect(Math.round((inviteExpiry(now).getTime() - now.getTime()) / 86_400_000)).toBe(3);
  });

  it("ignores a nonsense value rather than creating a token that never expires", () => {
    process.env.TEAM_INVITE_EXPIRY_DAYS = "not-a-number";
    const now = new Date("2026-03-01T10:00:00.000Z");
    expect(Math.round((inviteExpiry(now).getTime() - now.getTime()) / 86_400_000)).toBe(7);
  });

  it("treats the expiry instant itself as expired", () => {
    const at = new Date("2026-03-01T10:00:00.000Z");
    expect(isInviteExpired(at, at)).toBe(true);
    expect(isInviteExpired(at, new Date("2026-03-01T09:59:59.000Z"))).toBe(false);
  });
});

describe("invite URL (PRD #14 §241)", () => {
  it("builds the link from the configured origin", () => {
    process.env.APP_URL = "https://app.example.test";
    expect(inviteUrl("abc")).toBe("https://app.example.test/invite/abc");
  });

  it("tolerates a trailing slash on the origin", () => {
    process.env.APP_URL = "https://app.example.test/";
    expect(inviteUrl("abc")).toBe("https://app.example.test/invite/abc");
  });
});

describe("email normalisation (PRD #14 §318)", () => {
  it("lowercases and trims, so case cannot create a second account", () => {
    expect(normalizeEmail("  Person@Example.TEST ")).toBe("person@example.test");
  });
});

describe("invite URL fallback", () => {
  it("falls back to the site origin the rest of the app already uses", () => {
    delete process.env.APP_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "https://nesto.example.test";
    expect(inviteUrl("abc")).toBe("https://nesto.example.test/invite/abc");
  });

  it("never builds a link from nothing", () => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(inviteUrl("abc")).toBe("http://localhost:3000/invite/abc");
  });
});
