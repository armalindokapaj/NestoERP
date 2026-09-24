import { describe, expect, it, vi } from "vitest";

import {
  currentRequestScope,
  invalidateRequestScope,
  invalidatingRequestScope,
  peekScoped,
  runWithRequestScope,
  scoped,
  seedScoped,
} from "@/lib/core/observability/request-scope";

/**
 * The request scope's own contract (NAV-02 CTX-01, CTX-04, C07, C08, C11).
 * The loaders it serves are tested against the database in
 * tests/integration/context/request-scope-reuse.test.ts.
 */
describe("request scope", () => {
  it("loads each key once, and concurrent callers join the first load (C07)", async () => {
    const load = vi.fn(async () => ({ value: 1 }));
    await runWithRequestScope(async () => {
      const [a, b] = await Promise.all([scoped("org:g:u", load), scoped("org:g:u", load)]);
      const c = await scoped("org:g:u", load);
      expect(load).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
      expect(c).toBe(a);
    });
  });

  it("keeps different keys apart: another user, group or company is another answer", async () => {
    const load = vi.fn(async (key: string) => key);
    await runWithRequestScope(async () => {
      expect(await scoped("org:g1:u1", () => load("u1"))).toBe("u1");
      expect(await scoped("org:g1:u2", () => load("u2"))).toBe("u2");
      expect(await scoped("org:g2:u1", () => load("g2"))).toBe("g2");
      expect(load).toHaveBeenCalledTimes(3);
    });
  });

  it("without a scope, every read is a fresh one", async () => {
    const load = vi.fn(async () => 1);
    expect(currentRequestScope()).toBeNull();
    await scoped("org:g:u", load);
    await scoped("org:g:u", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never shares between two concurrent requests (C08)", async () => {
    const load = vi.fn(async (who: string) => ({ who }));
    const [first, second] = await Promise.all([
      runWithRequestScope(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return scoped("user-context", () => load("first"));
      }),
      runWithRequestScope(() => scoped("user-context", () => load("second"))),
    ]);
    expect(first.who).toBe("first");
    expect(second.who).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one failure within a request, and the next request loads again (C11)", async () => {
    const failing = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    await runWithRequestScope(async () => {
      const results = await Promise.allSettled([scoped("org:g:u", failing), scoped("org:g:u", failing)]);
      expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
      expect(failing).toHaveBeenCalledTimes(1);
    });
    const recovered = vi.fn(async () => "ok");
    await runWithRequestScope(async () => {
      expect(await scoped("org:g:u", recovered)).toBe("ok");
    });
  });

  it("forgets after a commit, by prefix or entirely (CTX-04)", async () => {
    await runWithRequestScope(async () => {
      const load = vi.fn(async () => Math.random());
      const before = await scoped("user-context", load);
      await scoped("modules:c1", load);
      invalidateRequestScope("user-context");
      expect(peekScoped("user-context")).toBeUndefined();
      expect(peekScoped("modules:c1")).toBeDefined();
      expect(await scoped("user-context", load)).not.toBe(before);
      await invalidatingRequestScope(Promise.resolve("committed"));
      expect(peekScoped("modules:c1")).toBeUndefined();
    });
  });

  it("does not forget when the commit fails", async () => {
    await runWithRequestScope(async () => {
      await scoped("modules:c1", async () => ["dashboard"]);
      await expect(invalidatingRequestScope(Promise.reject(new Error("rolled back")))).rejects.toThrow("rolled back");
      expect(peekScoped("modules:c1")).toBeDefined();
    });
  });

  it("a seeded answer is what the next reader gets, and never replaces one in flight", async () => {
    await runWithRequestScope(async () => {
      seedScoped("modules:c1", ["dashboard", "tasks"]);
      const load = vi.fn(async () => ["dashboard"]);
      expect(await scoped("modules:c1", load)).toEqual(["dashboard", "tasks"]);
      expect(load).not.toHaveBeenCalled();
      const inFlight = scoped("modules:c2", async () => ["dashboard", "finance"]);
      seedScoped("modules:c2", ["dashboard"]);
      expect(await scoped("modules:c2", load)).toEqual(await inFlight);
    });
  });
});
