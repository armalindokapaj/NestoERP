import { describe, expect, it } from "vitest";

import { canAccessModule } from "@/lib/access/can";
import { buildModuleAccess } from "@/lib/context/build-context";
import { ENTITLABLE_MODULES, missingDependencies, resolveCompany, resolveModule } from "@/lib/core/entitlements/entitlement.resolver";

const NOW = new Date("2026-10-15T12:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const plan = new Set(["projects", "documents", "finance"]);

describe("entitlement resolution (Admin Modules PRD #4 §16, §21-§23, §29, §39)", () => {
  it("core is Required, the plan decides the rest", () => {
    expect(resolveModule("dashboard", new Set(), null, NOW)).toMatchObject({ state: "Required", entitled: true });
    expect(resolveModule("finance", plan, null, NOW)).toMatchObject({ state: "Enabled", entitled: true, source: "plan" });
    expect(resolveModule("hr", plan, null, NOW)).toMatchObject({ state: "Disabled", entitled: false });
  });

  it("an override beats the plan both ways", () => {
    expect(resolveModule("finance", plan, { moduleKey: "finance", mode: "DISABLED", startsAt: null, endsAt: null }, NOW)).toMatchObject({ state: "Disabled", entitled: false, inPlan: true });
    expect(resolveModule("hr", plan, { moduleKey: "hr", mode: "ENABLED", startsAt: null, endsAt: null }, NOW)).toMatchObject({ state: "Enabled", entitled: true, source: "override" });
  });

  it("trials run between their dates and expire on their own; a future start is Scheduled", () => {
    const trial = { moduleKey: "hse", mode: "TRIAL" as const, startsAt: day("2026-10-01"), endsAt: day("2026-10-31") };
    expect(resolveModule("hse", plan, trial, day("2026-09-30"))).toMatchObject({ state: "Scheduled", entitled: false });
    expect(resolveModule("hse", plan, trial, NOW)).toMatchObject({ state: "Trial", entitled: true });
    expect(resolveModule("hse", plan, trial, day("2026-11-01"))).toMatchObject({ state: "Expired", entitled: false });
    expect(resolveModule("hr", plan, { moduleKey: "hr", mode: "ENABLED", startsAt: day("2027-01-01"), endsAt: null }, NOW)).toMatchObject({ state: "Scheduled", entitled: false });
  });

  it("a company with no entitlement row keeps everything (the migration's safe default, §86)", () => {
    expect(resolveCompany(null, NOW).filter((row) => row.entitled).length).toBe(ENTITLABLE_MODULES.length + resolveCompany(null, NOW).filter((row) => row.source === "core").length);
  });

  it("finds modules granted without what they need (§6, §20)", () => {
    expect(missingDependencies(new Set(["sales", "clients"]))).toEqual([{ module: "sales", needs: ["projects"] }]);
    expect(missingDependencies(new Set(["documents"]))).toEqual([]);
  });

  it("access needs the entitlement AND the permission (§31, §88)", () => {
    const entitled = ["dashboard", "finance"] as const;
    const withheld = ["dashboard"] as const;
    expect(canAccessModule({ moduleAccess: buildModuleAccess("FINANCE", [...entitled]) } as never, "finance")).toBe(true);
    expect(canAccessModule({ moduleAccess: buildModuleAccess("HSE", [...entitled]) } as never, "finance")).toBe(false);
    expect(canAccessModule({ moduleAccess: buildModuleAccess("FINANCE", [...withheld]) } as never, "finance")).toBe(false);
    expect(canAccessModule({ moduleAccess: buildModuleAccess("HSE", [...withheld]) } as never, "finance")).toBe(false);
  });
});
