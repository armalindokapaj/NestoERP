import { beforeEach, describe, expect, it } from "vitest";

import {
  accessSignature,
  cacheKey,
  cached,
  clearCache,
  getCached,
  invalidateNamespace,
  setCached,
} from "@/lib/core/cache/cache.service";

/**
 * A cached response must never cross a company, a member or an access change
 * (PRD #31 §95, §333-§337).
 */
describe("cacheKey", () => {
  beforeEach(() => clearCache());

  it("separates companies", () => {
    expect(cacheKey("reports", "company-a", "finance")).not.toBe(
      cacheKey("reports", "company-b", "finance"),
    );
  });

  it("separates access signatures", () => {
    const a = accessSignature({ membershipId: "m1", accessVersion: 1 });
    const b = accessSignature({ membershipId: "m1", accessVersion: 2 });
    expect(a).not.toBe(b);
    expect(cacheKey("reports", "c1", a)).not.toBe(cacheKey("reports", "c1", b));
  });

  it("separates members within a company", () => {
    expect(accessSignature({ membershipId: "m1" })).not.toBe(accessSignature({ membershipId: "m2" }));
  });
});

describe("cache lifecycle", () => {
  beforeEach(() => clearCache());

  it("returns a stored value and then expires it", async () => {
    setCached("k", { v: 1 }, 60);
    expect(getCached("k")).toEqual({ v: 1 });

    setCached("expired", { v: 2 }, -1);
    expect(getCached("expired")).toBeNull();
  });

  it("invalidates a namespace for one company only", () => {
    setCached(cacheKey("reports", "c1", "a"), 1, 60);
    setCached(cacheKey("reports", "c2", "a"), 2, 60);

    expect(invalidateNamespace("reports", "c1")).toBe(1);
    expect(getCached(cacheKey("reports", "c1", "a"))).toBeNull();
    expect(getCached(cacheKey("reports", "c2", "a"))).toBe(2);
  });

  it("falls back to the source rather than failing", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return "value";
    };

    expect(await cached("read-through", 60, load)).toBe("value");
    expect(await cached("read-through", 60, load)).toBe("value");
    // Second call served from cache.
    expect(calls).toBe(1);
  });
});
