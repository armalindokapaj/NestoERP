import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, hashSubject, resetRateLimits } from "@/lib/core/security/rate-limit";

/** Abuse resistance, and the guarantee that it never leaks a credential (PRD #30 §127-§138). */
describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows traffic up to the limit and refuses past it", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimit("AUTH", "subject-a").allowed, `attempt ${i + 1}`).toBe(true);
    }
    const blocked = checkRateLimit("AUTH", "subject-a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each subject separately", () => {
    for (let i = 0; i < 5; i += 1) checkRateLimit("AUTH", "subject-b");
    expect(checkRateLimit("AUTH", "subject-b").allowed).toBe(false);
    expect(checkRateLimit("AUTH", "subject-c").allowed).toBe(true);
  });

  it("keeps categories independent", () => {
    for (let i = 0; i < 5; i += 1) checkRateLimit("AUTH", "subject-d");
    expect(checkRateLimit("AUTH", "subject-d").allowed).toBe(false);
    expect(checkRateLimit("SEARCH", "subject-d").allowed).toBe(true);
  });

  it("hashes a subject rather than storing it", async () => {
    const hashed = await hashSubject("Person@Example.com");
    expect(hashed).not.toContain("@");
    expect(hashed).toMatch(/^[a-f0-9]{24}$/);
    // Case and surrounding whitespace must not create a second bucket.
    expect(await hashSubject("  person@example.com ")).toBe(hashed);
  });
});
