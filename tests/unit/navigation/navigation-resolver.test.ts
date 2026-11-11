import { describe, expect, it } from "vitest";

import { MODULE_KEYS, modules, type ModuleKey } from "@/config/modules";
import { activeNavigationKey, findInNavigation, groupOfPath, navigationItems, navigationLayout, resolveNavigation, RIBBON_TABS } from "@/config/navigation";
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
    // With Sales, Clients and Projects (which Units rides on) switched off, the
    // Sales tab must disappear entirely rather than render an empty ribbon.
    const enabled = MODULE_KEYS.filter((key) => key !== "sales" && key !== "clients" && key !== "projects");
    const navigation = resolveNavigation({ permissions: permissionsForRole("OWNER"), enabledModules: enabled });

    for (const groups of [navigation.menu, navigation.ribbon]) {
      expect(groups.map((group) => group.group)).not.toContain("sales");
      for (const group of groups) expect(group.items.length).toBeGreaterThan(0);
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
  const owner = () => resolveNavigation({ permissions: permissionsForRole("OWNER"), enabledModules: [...MODULE_KEYS] });
  const { menu, ribbon } = navigationLayout();

  it("places every navigation module exactly once in the logo's panel", () => {
    const placed = menu.filter((item) => item.labelFrom.kind === "module").map((item) => item.module);
    const expected = MODULE_KEYS.filter((key) => modules[key].inNavigation !== false);
    expect([...placed].sort()).toEqual([...expected].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("has five Ribbon tabs, Work then Company, with Home before them in the panel", () => {
    expect(RIBBON_TABS).toEqual(["work", "company", "sales", "procurement", "finance"]);
    const navigation = owner();
    expect(navigation.menu.map((group) => group.group)).toEqual(["primary", ...RIBBON_TABS]);
    expect(navigation.ribbon.map((group) => group.group)).toEqual([...RIBBON_TABS]);
  });

  it("gives every set three or four buttons, never a group of one or two (Microsoft's ribbon rules)", () => {
    const sets = new Map<string, number>();
    for (const item of ribbon) sets.set(`${item.group}/${item.set}`, (sets.get(`${item.group}/${item.set}`) ?? 0) + 1);
    for (const [set, count] of sets) expect(count, set).toBeGreaterThanOrEqual(3);
    for (const [set, count] of sets) expect(count, set).toBeLessThanOrEqual(4);
  });

  it("keeps each module's buttons in the tab that holds the module, Units in Sales", () => {
    const groupOf = new Map(menu.map((item) => [item.key, item.group]));
    for (const item of ribbon) {
      const expected = item.key.startsWith("units") ? "sales" : groupOf.get(item.module);
      expect(item.group, item.key).toBe(expected);
    }
  });

  it("opens a section at its own route, and hides it from a reader without the section's permission", () => {
    const orders = ribbon.find((item) => item.key === "procurement.orders")!;
    expect(orders.href).toBe("/procurement/orders");
    const sold = ribbon.find((item) => item.key === "units.sold")!;
    expect(sold.href).toBe("/projects/units/sold");
    expect(sold.permissions).toContain("project.unit.sales.view");
  });

  it("opens each tab on the page's own tab", () => {
    const navigation = owner();
    expect(groupOfPath(navigation, "/dashboard")).toBe("primary");
    expect(groupOfPath(navigation, "/projects/p1/units")).toBe("work");
    expect(groupOfPath(navigation, "/projects/units")).toBe("sales");
    expect(groupOfPath(navigation, "/projects/units/sold")).toBe("sales");
    expect(groupOfPath(navigation, "/contracts/review")).toBe("company");
    expect(groupOfPath(navigation, "/hr/leave")).toBe("company");
    expect(groupOfPath(navigation, "/settings/profile")).toBe("company");
    expect(groupOfPath(navigation, "/inventory/items")).toBe("procurement");
    expect(groupOfPath(navigation, "/procurement/orders/o1")).toBe("procurement");
    expect(groupOfPath(navigation, "/access-denied")).toBeNull();
  });

  it("finds a module or a section by name, each once", () => {
    const found = findInNavigation(owner(), "orders").flatMap((group) => group.items.map((item) => item.key));
    expect(found).toContain("procurement.orders");
    expect(new Set(found).size).toBe(found.length);
    expect(findInNavigation(owner(), "units").flatMap((group) => group.items.map((item) => item.key))).toEqual(["units"]);
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
