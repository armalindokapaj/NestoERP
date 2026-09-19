import { describe, expect, it } from "vitest";

import { isProject3DEntitlementActive } from "@/lib/modules/project-3d/project-3d.entitlement";

const now = new Date("2026-09-19T12:00:00.000Z");

describe("Project 3D entitlement gate", () => {
  it("accepts an active, enabled entitlement inside its time window", () => {
    expect(isProject3DEntitlementActive({
      status: "ACTIVE",
      viewerEnabled: true,
      activatedAt: new Date("2026-09-01T00:00:00.000Z"),
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
    }, now)).toBe(true);
  });

  it.each(["INACTIVE", "SUSPENDED", "EXPIRED"] as const)("rejects %s", (status) => {
    expect(isProject3DEntitlementActive({ status, viewerEnabled: true, activatedAt: null, expiresAt: null }, now)).toBe(false);
  });

  it("rejects disabled, not-yet-active, and expired entitlements", () => {
    expect(isProject3DEntitlementActive({ status: "ACTIVE", viewerEnabled: false, activatedAt: null, expiresAt: null }, now)).toBe(false);
    expect(isProject3DEntitlementActive({ status: "ACTIVE", viewerEnabled: true, activatedAt: new Date("2026-09-20T00:00:00.000Z"), expiresAt: null }, now)).toBe(false);
    expect(isProject3DEntitlementActive({ status: "ACTIVE", viewerEnabled: true, activatedAt: null, expiresAt: now }, now)).toBe(false);
  });
});
