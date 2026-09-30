import { describe, expect, it } from "vitest";

import { evaluateDeviceCompliance, isBlockedBuild, type ComplianceInput } from "@/lib/core/security/device-compliance";
import { DEFAULT_MOBILE_POLICY, resolveMobilePolicy, type PolicyLevel } from "@/lib/core/security/mobile-policy.schema";
import { compareVersions, parseAppUserAgent } from "@/lib/core/security/app-version";
import { isInstallId } from "@/lib/core/security/install-id";

/** MOB-11 §73-§82 policy inheritance, §63-§66 compliance. */
const level = (scope: PolicyLevel["scope"], settings: PolicyLevel["settings"], extra: Partial<PolicyLevel> = {}): PolicyLevel => ({ scope, id: scope === "PLATFORM" ? null : `${scope}-1`, version: 1, settings, ...extra });

describe("resolveMobilePolicy", () => {
  it("falls back to the documented defaults when nobody sets anything", () => {
    const policy = resolveMobilePolicy([]);
    expect(policy.appLockRequired).toBe(DEFAULT_MOBILE_POLICY.appLockRequired);
    expect(policy.offlineAuthorizationHours).toBe(DEFAULT_MOBILE_POLICY.offlineAuthorizationHours);
  });

  it("the strictest value wins across platform, group and company", () => {
    const policy = resolveMobilePolicy([
      level("PLATFORM", { offlineAuthorizationHours: 72, appLockTimeoutSeconds: 300, documentExportAllowed: true }),
      level("PARENT_GROUP", { offlineAuthorizationHours: 24, appLockRequired: true }),
      level("COMPANY", { appLockTimeoutSeconds: 60, documentExportAllowed: false }, { parentGroupId: "PARENT_GROUP-1" }),
    ]);
    expect(policy.appLockRequired).toBe(true);
    expect(policy.offlineAuthorizationHours).toBe(24);
    expect(policy.appLockTimeoutSeconds).toBe(60);
    expect(policy.documentExportAllowed).toBe(false);
  });

  it("a lower level cannot loosen what a higher one requires", () => {
    const policy = resolveMobilePolicy([level("PARENT_GROUP", { appLockRequired: true, offlineAuthorizationHours: 12 }), level("COMPANY", { appLockRequired: false, offlineAuthorizationHours: 200 }, { parentGroupId: "PARENT_GROUP-1" })]);
    expect(policy.appLockRequired).toBe(true);
    expect(policy.offlineAuthorizationHours).toBe(12);
  });

  it("takes the highest minimum version", () => {
    const policy = resolveMobilePolicy([level("PLATFORM", { minimumAppVersion: "1.2.0" }), level("COMPANY", { minimumAppVersion: "1.4.0" })]);
    expect(policy.minimumAppVersion).toBe("1.4.0");
  });

  it("drops Company levels when the group closes overrides", () => {
    const policy = resolveMobilePolicy([level("PARENT_GROUP", { allowCompanyOverride: false }), level("COMPANY", { appLockRequired: true }, { parentGroupId: "PARENT_GROUP-1" })]);
    expect(policy.appLockRequired).toBe(DEFAULT_MOBILE_POLICY.appLockRequired);
  });
});

const device: ComplianceInput = { platform: "IOS", status: "ACTIVE", appVersion: "1.5.0", appBuild: "150", osVersion: "17.2", reportedRisk: [] };

describe("evaluateDeviceCompliance", () => {
  const policy = resolveMobilePolicy([level("PLATFORM", { minimumAppVersion: "1.2.0", minimumSecureVersion: "1.4.0", recommendedAppVersion: "1.6.0" })]);

  it("allows a current, active device", () => {
    expect(evaluateDeviceCompliance(device, policy).action).toBe("ALLOW");
  });
  it("blocks revoked and blocked devices", () => {
    expect(evaluateDeviceCompliance({ ...device, status: "REVOKED" }, policy).action).toBe("BLOCK");
    expect(evaluateDeviceCompliance({ ...device, status: "BLOCKED" }, policy).action).toBe("BLOCK");
  });
  it("requires an update below the minimum or secure version", () => {
    expect(evaluateDeviceCompliance({ ...device, appVersion: "1.1.0" }, policy).reasons).toContain("APP_VERSION_UNSUPPORTED");
    const secure = evaluateDeviceCompliance({ ...device, appVersion: "1.3.0" }, policy);
    expect(secure.action).toBe("REQUIRE_UPDATE");
    expect(secure.reasons).toContain("SECURITY_UPDATE_REQUIRED");
  });
  it("only recommends an update between the secure and recommended versions", () => {
    const result = evaluateDeviceCompliance(device, policy);
    expect(result.reasons).toContain("UPDATE_RECOMMENDED");
    expect(result.action).toBe("ALLOW");
  });
  it("a blocked build requires an update, by version or by build", () => {
    const blocked = resolveMobilePolicy([level("PLATFORM", { blockedBuilds: ["1.5.0+150"] })]);
    expect(evaluateDeviceCompliance(device, blocked).reasons).toContain("BLOCKED_BUILD");
    expect(evaluateDeviceCompliance({ ...device, appBuild: "151" }, blocked).reasons).not.toContain("BLOCKED_BUILD");
    expect(isBlockedBuild("1.5.0", null, ["1.5.0"])).toBe(true);
  });
  it("a risk signal follows the risk policy", () => {
    const warn = resolveMobilePolicy([level("PLATFORM", { deviceRiskPolicy: "WARN" })]);
    const block = resolveMobilePolicy([level("PLATFORM", { deviceRiskPolicy: "BLOCK" })]);
    const risky = { ...device, reportedRisk: ["ROOTED"] };
    expect(evaluateDeviceCompliance(risky, warn).action).toBe("WARN");
    expect(evaluateDeviceCompliance(risky, block).action).toBe("BLOCK");
  });
});

describe("app version helpers", () => {
  it("compares semantic versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });
  it("parses only the app's own user agent", () => {
    expect(parseAppUserAgent("Mozilla/5.0")).toBeNull();
    expect(parseAppUserAgent(null)).toBeNull();
  });
  it("accepts only well-formed install ids", () => {
    expect(isInstallId("a".repeat(32))).toBe(true);
    expect(isInstallId("short")).toBe(false);
    expect(isInstallId(null)).toBe(false);
  });
});
