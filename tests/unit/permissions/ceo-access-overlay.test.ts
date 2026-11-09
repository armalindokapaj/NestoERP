import { describe, expect, it } from "vitest";

import { MODULE_KEYS } from "@/config/modules";
import { isMutatingPermission } from "@/config/permissions";
import { permissionsForRole } from "@/config/role-defaults";
import { buildModuleAccess, holdsCeoAccess } from "@/lib/context/build-context";

/**
 * CEO access (2026-11): the CEO's rights laid over a member's own role, module
 * by module — nothing of the role lost, everything of the CEO's gained.
 */

const ALL = [...MODULE_KEYS];
const CEO = { role: "CEO" as const, position: "MEMBER" as const };
const held = (access: ReturnType<typeof buildModuleAccess>) => new Set(Object.values(access).flatMap((module) => module.permissions));

describe("the CEO overlay", () => {
  it("keeps every permission of the member's role and adds every one of the CEO's", () => {
    for (const role of ["FINANCE", "PROJECT_MANAGER", "SALES", "HR", "ENGINEER", "ARCHITECT"] as const) {
      const permissions = held(buildModuleAccess(role, ALL, "MEMBER", [], CEO));
      for (const permission of permissionsForRole(role)) expect(permissions.has(permission), `${role} keeps ${permission}`).toBe(true);
      for (const permission of permissionsForRole("CEO")) expect(permissions.has(permission), `${role} gains ${permission}`).toBe(true);
      expect(permissions.has("team.ceo_access.manage")).toBe(true);
    }
  });

  it("gives nothing beyond the two roles' permissions", () => {
    const permissions = held(buildModuleAccess("FINANCE", ALL, "MEMBER", [], CEO));
    const union = new Set([...permissionsForRole("FINANCE"), ...permissionsForRole("CEO")]);
    expect([...permissions].filter((permission) => !union.has(permission))).toEqual([]);
  });

  it("raises each module to the higher level and the wider reach", () => {
    const own = buildModuleAccess("FINANCE", ALL);
    const ceo = buildModuleAccess("CEO", ALL);
    const both = buildModuleAccess("FINANCE", ALL, "MEMBER", [], CEO);
    // Projects: Finance reads, the CEO manages.
    expect(own.projects.accessLevel).not.toBe("MANAGE");
    expect(both.projects).toMatchObject({ accessLevel: ceo.projects.accessLevel, scope: "COMPANY" });
    // Finance: Finance manages it already; the CEO approves. The higher stays.
    expect(both.finance.accessLevel).toBe(own.finance.accessLevel);
  });

  it("lifts a read-only role", () => {
    const viewer = held(buildModuleAccess("VIEWER", ALL));
    expect([...viewer].some(isMutatingPermission)).toBe(false);
    const lifted = held(buildModuleAccess("VIEWER", ALL, "MEMBER", [], CEO));
    for (const permission of permissionsForRole("CEO")) expect(lifted.has(permission)).toBe(true);
  });

  it("is unchanged without it, and a disabled module stays shut", () => {
    expect(buildModuleAccess("FINANCE", ALL)).toEqual(buildModuleAccess("FINANCE", ALL, "MEMBER", [], undefined));
    const withoutSales = buildModuleAccess("FINANCE", ALL.filter((key) => key !== "sales"), "MEMBER", [], CEO);
    expect(withoutSales.sales).toMatchObject({ accessLevel: "NONE", permissions: [] });
  });

  it("is carried only by a direct membership whose role is not already the CEO's or an Owner's", () => {
    expect(holdsCeoAccess({ ceoAccess: true, groupDerived: false }, "FINANCE")).toBe(true);
    expect(holdsCeoAccess({ ceoAccess: false, groupDerived: false }, "FINANCE")).toBe(false);
    expect(holdsCeoAccess({ ceoAccess: true, groupDerived: true }, "FINANCE")).toBe(false);
    expect(holdsCeoAccess({ ceoAccess: true, groupDerived: false }, "CEO")).toBe(false);
    expect(holdsCeoAccess({ ceoAccess: true, groupDerived: false }, "OWNER")).toBe(false);
  });
});
