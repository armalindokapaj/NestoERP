import { describe, expect, it } from "vitest";

import { MODULE_KEYS, modules, type ModuleKey } from "@/config/modules";
import { activeNavigationKey, navigationItems, resolveNavigation } from "@/config/navigation";
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
    // Group IT has no Work-group modules beyond Tasks, Meetings, Timesheets
    // and Documents; with those switched off the group must disappear entirely
    // rather than render an empty heading.
    const enabled = MODULE_KEYS.filter((key) => key !== "tasks" && key !== "meetings" && key !== "timesheets" && key !== "documents");
    const groups = resolveNavigation({
      permissions: permissionsForRole("GROUP_IT"),
      enabledModules: enabled,
    });

    expect(groups.map((group) => group.group)).not.toContain("work");
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
