import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fallbackParent, returnHref } from "@/config/breadcrumb-routes";
import { dashboards } from "@/config/dashboards";
import { MODULE_KEYS, modules, sectionRoute } from "@/config/modules";
import { activeNavigationKey, navigationItems, resolveNavigation } from "@/config/navigation";
import { quickActions } from "@/config/quick-actions";
import { QUICK_CREATE_ACTIONS } from "@/config/quick-create";
import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS } from "@/config/roles";
import { workspaceRoutePolicy } from "@/config/workspace-routes";

/**
 * AUD-05 §3, §4 — navigation and orientation (UX-02, UX-03, UX-04, UX-09).
 */

const APP = join(process.cwd(), "app", "(nesto)");

/**
 * Whether a route (`/projects/:projectId/daily-logs/new`) has a page: a static
 * segment by its own directory (or inside a route group), a `:param` or a static segment by a sibling
 * `[dynamic]` directory (`/support/help` is `/support/[section]`).
 */
function pageExists(route: string): boolean {
  const parts = route.split("?")[0].split("/").filter(Boolean);
  const walk = (dir: string, index: number): boolean => {
    if (!existsSync(dir)) return false;
    // A route group, `(portfolio)`, adds no segment.
    if (readdirSync(dir).some((name) => name.startsWith("(") && walk(join(dir, name), index))) return true;
    if (index === parts.length) return existsSync(join(dir, "page.tsx"));
    const part = parts[index];
    if (!part.startsWith(":") && walk(join(dir, part), index + 1)) return true;
    return readdirSync(dir).some((name) => name.startsWith("[") && !name.startsWith("[...") && walk(join(dir, name), index + 1));
  };
  return walk(APP, 0);
}

describe("active module (UX-03)", () => {
  it("marks every sidebar module on its own route and below it — by route, not by key", () => {
    for (const item of navigationItems({ permissions: permissionsForRole("OWNER"), enabledModules: [...MODULE_KEYS] })) {
      expect(activeNavigationKey(item.href), item.href).toBe(item.module);
      expect(activeNavigationKey(`${item.href}/some-record`), item.href).toBe(item.module);
    }
  });

  it("marks Daily Logs at /daily-logs, which its key (dailyLogs) never matched", () => {
    expect(activeNavigationKey("/daily-logs")).toBe("dailyLogs");
    expect(activeNavigationKey("/daily-logs/review")).toBe("dailyLogs");
    expect(activeNavigationKey("/daily-logs?status=SUBMITTED")).toBe("dailyLogs");
  });

  it("keeps a project-contained page under Projects, and matches whole segments only", () => {
    expect(activeNavigationKey("/projects/p1/daily-logs/l1")).toBe("projects");
    expect(activeNavigationKey("/tasks-archive")).toBeNull();
    expect(activeNavigationKey("/help/tasks")).toBeNull();
  });
});

describe("one resolver, no empty groups (UX-02)", () => {
  it("never renders a group without items, for any role, with any module off", () => {
    for (const role of ROLE_KEYS) {
      for (const off of MODULE_KEYS) {
        const groups = resolveNavigation({ permissions: permissionsForRole(role), enabledModules: MODULE_KEYS.filter((key) => key !== off) });
        for (const group of groups) expect(group.items.length, `${role} without ${off}: ${group.group}`).toBeGreaterThan(0);
        expect(groups.flatMap((group) => group.items).some((item) => item.module === off)).toBe(false);
      }
    }
  });

  it("lists every module once at most", () => {
    const items = navigationItems({ permissions: permissionsForRole("OWNER"), enabledModules: [...MODULE_KEYS] });
    expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
  });

  it("gives every sidebar module its own page", () => {
    for (const key of MODULE_KEYS) expect(pageExists(modules[key].route), key).toBe(true);
  });

  it("gives every section tab its own page, directly or through the module's [section] route", () => {
    for (const key of MODULE_KEYS) {
      for (const section of modules[key].sections) expect(pageExists(sectionRoute(key, section.key)), `${key}/${section.key}`).toBe(true);
    }
  });
});

describe("shortcuts and Quick Create open real pages (UX-09)", () => {
  it("routes every dashboard shortcut to a page that exists", () => {
    for (const action of Object.values(quickActions)) expect(pageExists(action.href), `${action.key} → ${action.href}`).toBe(true);
  });

  it("routes every Quick Create action to its canonical create page", () => {
    for (const action of QUICK_CREATE_ACTIONS) expect(pageExists(action.route), `${action.key} → ${action.route}`).toBe(true);
  });

  it("offers only shortcuts that are defined, for every role", () => {
    for (const role of ROLE_KEYS) for (const key of dashboards[role].quickActions) expect(quickActions[key], `${role}/${key}`).toBeDefined();
  });

  it("names the Team invitation's second grant, so the shortcut is not a door that refuses", () => {
    expect(quickActions.inviteUser).toMatchObject({ href: "/team/invite", permission: "team.member.invite", alsoRequires: ["team.member.role.assign"] });
  });
});

describe("return to the list (UX-04)", () => {
  const history = [
    { route: "/tasks/all?status=BLOCKED&page=2", workspaceKey: "company:a" },
    { route: "/tasks/t1", workspaceKey: "company:a" },
    { route: "/finance/invoices?q=INV", workspaceKey: "company:b" },
  ];

  it("returns to the list with the search, filters and page it was left with", () => {
    expect(returnHref("/tasks/all", history, "company:a")).toBe("/tasks/all?status=BLOCKED&page=2");
  });

  it("never carries one workspace's query into another", () => {
    expect(returnHref("/finance/invoices", history, "company:a")).toBe("/finance/invoices");
  });

  it("keeps the plain list without history, and never changes the destination", () => {
    expect(returnHref("/tasks/all", [], "company:a")).toBe("/tasks/all");
    expect(returnHref("/tasks/all", history, null)).toBe("/tasks/all");
    expect(returnHref("/tasks/overdue", history, "company:a")).toBe("/tasks/overdue");
    expect(returnHref("/tasks?mine=1", history, "company:a")).toBe("/tasks?mine=1");
  });

  it("falls back to the nearest clickable parent on a deep link", () => {
    const trail = [
      { label: "Group", href: "/dashboard" },
      { label: "Finance", href: "/finance" },
      { label: "Invoices", href: "/finance/invoices" },
      { label: "INV-1" },
    ];
    expect(fallbackParent(trail)?.label).toBe("Invoices");
    expect(fallbackParent([{ label: "Group", disabled: true, href: "/dashboard" }, { label: "Record" }])).toBeNull();
    expect(fallbackParent([{ label: "Finance", href: "/finance" }, { label: "Locked", href: "/x", disabled: true }, { label: "INV-1" }])?.label).toBe("Finance");
  });
});

describe("Help is a page of its own in either workspace (UX-16)", () => {
  it("is a global route, not a module", () => {
    expect(workspaceRoutePolicy("/help").routeType).toBe("GLOBAL");
    expect(workspaceRoutePolicy("/help/daily-logs").routeType).toBe("GLOBAL");
    expect(activeNavigationKey("/help")).toBeNull();
  });
});
