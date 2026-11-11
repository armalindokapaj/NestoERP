import { describe, expect, it } from "vitest";

import { MODULE_KEYS, modules, type ModuleKey } from "@/config/modules";
import { activeNavigationKey, groupOfPath, navigationItems, navigationLayoutItems, resolveNavigation, RIBBON_TABS } from "@/config/navigation";
import { accessibleModules, permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";

/**
 * Navigation resolver tests (PRD #9 §121).
 *
 * For every role: resolve context → resolve navigation → compare module keys.
 * No unauthorised item may be present (PRD #3 §48).
 */
function navigationFor(role: (typeof ROLE_KEYS)[number], enabled: ModuleKey[] = [...MODULE_KEYS]) {
  return navigationItems({ permissions: permissionsForRole(role), enabledModules: enabled });
}

describe("resolveNavigation", () => {
  it("shows a role exactly the modules it can open", () => {
    for (const role of ROLE_KEYS) {
      const rendered = navigationFor(role).map((item) => item.module).sort();
      // A module reached another way (Announcements, through the Activity Center bell) is not a sidebar item.
      const expected = accessibleModules(role).filter((key) => modules[key].inNavigation !== false).sort();
      expect(rendered, role).toEqual(expected);
    }
  });

  it("never renders a module the role cannot open", () => {
    for (const role of ROLE_KEYS) {
      const allowed = new Set(accessibleModules(role));
      for (const item of navigationFor(role)) {
        expect(allowed.has(item.module), `${role} sees ${item.module}`).toBe(true);
      }
    }
  });

  it("hides a module the company has switched off (PRD #3 §42)", () => {
    const enabled = MODULE_KEYS.filter((key) => key !== "finance");
    const rendered = navigationFor("OWNER", enabled).map((item) => item.module);

    expect(rendered).not.toContain("finance");
    expect(rendered).toContain("projects");
  });

  it("drops a group once it has no visible modules (PRD #3 §91)", () => {
    // With Sales, Clients and Contracts switched off the Sales tab must
    // disappear entirely rather than render an empty ribbon.
    const enabled = MODULE_KEYS.filter((key) => key !== "sales" && key !== "clients" && key !== "contracts");
    const groups = resolveNavigation({
      permissions: permissionsForRole("OWNER"),
      enabledModules: enabled,
    });

    expect(groups.map((group) => group.group)).not.toContain("sales");
    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("gives every role at least the dashboard", () => {
    for (const role of ROLE_KEYS) {
      expect(navigationFor(role).map((item) => item.module), role).toContain("dashboard");
    }
  });

  it("links every item at its module's own route", () => {
    for (const item of navigationFor("OWNER")) {
      expect(item.href).toBe(modules[item.module].route);
    }
  });
});

describe("where every module lives (docs/ui/UI-04-navigation-layouts.md)", () => {
  it("places every navigation module exactly once", () => {
    const placed = navigationLayoutItems().map((item) => item.module);
    const expected = MODULE_KEYS.filter((key) => modules[key].inNavigation !== false);
    expect([...placed].sort()).toEqual([...expected].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("has four Ribbon tabs, Work first, with Home before them and Company after", () => {
    expect(RIBBON_TABS).toEqual(["work", "sales", "procurement", "finance"]);
    const groups = resolveNavigation({ permissions: permissionsForRole("OWNER"), enabledModules: [...MODULE_KEYS] }).map((group) => group.group);
    expect(groups).toEqual(["primary", "work", "sales", "procurement", "finance", "company"]);
  });

  it("puts each module in its tab", () => {
    const navigation = resolveNavigation({ permissions: permissionsForRole("OWNER"), enabledModules: [...MODULE_KEYS] });
    expect(groupOfPath(navigation, "/dashboard")).toBe("primary");
    expect(groupOfPath(navigation, "/projects/p1/units")).toBe("work");
    expect(groupOfPath(navigation, "/contracts/review")).toBe("sales");
    expect(groupOfPath(navigation, "/inventory/items")).toBe("procurement");
    expect(groupOfPath(navigation, "/hr/leave")).toBe("finance");
    expect(groupOfPath(navigation, "/settings/profile")).toBe("company");
    expect(groupOfPath(navigation, "/access-denied")).toBeNull();
  });
});

describe("active navigation state (PRD #3 §13)", () => {
  it("keeps the parent module active on a nested route", () => {
    expect(activeNavigationKey("/projects")).toBe("projects");
    expect(activeNavigationKey("/projects/all")).toBe("projects");
    expect(activeNavigationKey("/projects/project_a")).toBe("projects");
    expect(activeNavigationKey("/projects/project_a/team")).toBe("projects");
    expect(activeNavigationKey("/projects/project_a/edit")).toBe("projects");
  });

  it("returns nothing for a route outside any module", () => {
    expect(activeNavigationKey("/")).toBeNull();
    expect(activeNavigationKey("/access-denied")).toBeNull();
  });
});
