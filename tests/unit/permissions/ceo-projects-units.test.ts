import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "@/config/permissions";
import { roleModuleAccess } from "@/config/role-defaults";

/**
 * The CEO runs the company's projects and units end to end (user, 2026-09-29):
 * editing the project and its structure, and on each unit its files,
 * publication and its Sales, Legal and Finance work.
 */
describe("the CEO's project and unit authority", () => {
  const held = new Set<string>(Object.values(roleModuleAccess.CEO).flatMap((access) => access.permissions));

  it("holds every project and unit permission", () => {
    const missing = (PERMISSIONS as readonly string[]).filter((permission) => permission.startsWith("project.") && !held.has(permission));
    expect(missing).toEqual([]);
  });

  it("manages the Projects module at company scope", () => {
    expect(roleModuleAccess.CEO.projects).toMatchObject({ accessLevel: "MANAGE", scope: "COMPANY" });
  });

  it("still cannot decide their own sale: approval is a separate grant the service guards", () => {
    expect(held.has("project.unit.sale.approve")).toBe(true);
    expect(held.has("project.unit.mark_sold")).toBe(true);
  });
});
