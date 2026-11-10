import { describe, expect, it } from "vitest";

import { levelsBindingPerson, resolveMobilePolicy, type PolicyLevel } from "@/lib/core/security/mobile-policy.schema";
import { ownerProtectionAllows } from "@/lib/core/security/owner-protection";

/**
 * The group owner is protected (the user, 2026-11-10): nobody else in the
 * tenant acts on an Owner's account, devices or sessions, and a company's own
 * mobile policy does not bind them. These are the two rules with the facts
 * already known; the API suites read the facts from the database.
 */

describe("who may act on whom", () => {
  const rule = (actorIsOwner: boolean, targetIsOwner: boolean, same = false) => ownerProtectionAllows({ actorUserId: "actor", targetUserId: same ? "actor" : "target", actorIsOwner, targetIsOwner });

  it("refuses anyone but an Owner on an Owner", () => {
    expect(rule(false, true)).toBe(false);
  });

  it("lets another Owner of the group act on an Owner", () => {
    expect(rule(true, true)).toBe(true);
  });

  it("lets an Owner act on themselves", () => {
    expect(rule(true, true, true)).toBe(true);
  });

  it("leaves everybody else as they were: anyone may act on a person who is not an Owner", () => {
    expect(rule(false, false)).toBe(true);
    expect(rule(true, false)).toBe(true);
    expect(rule(false, false, true)).toBe(true);
  });
});

describe("the levels that bind a person", () => {
  const platform: PolicyLevel = { scope: "PLATFORM", id: null, version: 1, settings: { offlineAuthorizationHours: 72, recentAuthMinutes: 30 } };
  const group: PolicyLevel = { scope: "PARENT_GROUP", id: "group-1", version: 2, settings: { appLockRequired: true, appLockTimeoutSeconds: 300 } };
  const strictCompany: PolicyLevel = {
    scope: "COMPANY",
    id: "company-1",
    parentGroupId: "group-1",
    version: 3,
    settings: { appLockTimeoutSeconds: 0, offlineAuthorizationHours: 1, recentAuthMinutes: 1, documentExportAllowed: false, notificationPreviewPolicy: "HIDDEN", minimumAppVersion: "99.0.0" },
  };
  const otherGroupsCompany: PolicyLevel = { scope: "COMPANY", id: "company-9", parentGroupId: "group-9", version: 1, settings: { offlineAuthorizationHours: 12 } };
  const levels = [platform, group, strictCompany];

  it("holds an Owner to the platform and the group, not to a strict level of one of the group's companies", () => {
    const owner = resolveMobilePolicy(levelsBindingPerson(levels, new Set(["group-1"])));
    expect(owner).toEqual(resolveMobilePolicy([platform, group]));
    expect(owner).toMatchObject({ appLockRequired: true, appLockTimeoutSeconds: 300, offlineAuthorizationHours: 72, recentAuthMinutes: 30, documentExportAllowed: true });
    expect(owner.minimumAppVersion).not.toBe("99.0.0");
  });

  it("still holds an Owner to the group's own level", () => {
    const owner = resolveMobilePolicy(levelsBindingPerson(levels, new Set(["group-1"])));
    expect(owner.appLockRequired).toBe(true);
    expect(resolveMobilePolicy(levelsBindingPerson([platform, strictCompany], new Set(["group-1"]))).appLockRequired).toBe(false);
  });

  it("still holds an Owner to a company of a group they do not own", () => {
    const owner = resolveMobilePolicy(levelsBindingPerson([...levels, otherGroupsCompany], new Set(["group-1"])));
    expect(owner.offlineAuthorizationHours).toBe(12);
  });

  it("leaves a person who owns nothing exactly as before", () => {
    expect(levelsBindingPerson(levels, new Set())).toEqual(levels);
    expect(resolveMobilePolicy(levelsBindingPerson(levels, new Set()))).toEqual(resolveMobilePolicy(levels));
    expect(resolveMobilePolicy(levelsBindingPerson(levels, new Set(["group-9"])))).toEqual(resolveMobilePolicy(levels));
    expect(resolveMobilePolicy(levels)).toMatchObject({ appLockTimeoutSeconds: 0, offlineAuthorizationHours: 1, recentAuthMinutes: 1, documentExportAllowed: false, notificationPreviewPolicy: "HIDDEN" });
  });
});
