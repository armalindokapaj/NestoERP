import { describe, expect, it } from "vitest";

import { modules, MODULE_KEYS, type ModuleKey } from "@/config/modules";
import { navigationItems, resolveNavigation } from "@/config/navigation";
import { filterMoreGroups, MAX_PRIMARY_DESTINATIONS, resolveMobileNavigation } from "@/lib/navigation/mobile";
import { emitNavigationEvent, NAVIGATION_EVENT } from "@/lib/navigation/analytics";

const allPermissions = MODULE_KEYS.map((key) => modules[key].permission);
const resolve = (enabled: readonly ModuleKey[], permissions: readonly string[] = allPermissions) => resolveNavigation({ enabledModules: enabled, permissions });

describe("resolveMobileNavigation (MOB-02 §63-§65)", () => {
  it("places dashboard, projects and tasks in the bar for a fully permitted person", () => {
    const { primary } = resolveMobileNavigation(resolve(MODULE_KEYS));
    expect(primary.map((item) => item.key)).toEqual(["dashboard", "projects", "tasks"]);
    expect(primary.length).toBeLessThanOrEqual(MAX_PRIMARY_DESTINATIONS);
  });

  it("never adds an item the resolver did not produce", () => {
    const groups = resolve(["dashboard", "projects", "documents", "settings"], ["dashboard.view", "projects.view", "documents.view", "settings.view"].filter((permission) => allPermissions.includes(permission as never)));
    const allowed = new Set(groups.flatMap((group) => group.items.map((item) => item.key)));
    const { primary, more } = resolveMobileNavigation(groups);
    for (const item of [...primary, ...more.flatMap((group) => group.items)]) expect(allowed.has(item.key)).toBe(true);
  });

  it("drops a primary destination the person cannot open instead of leaving a dead slot", () => {
    const withoutTasks = MODULE_KEYS.filter((key) => key !== "tasks");
    const { primary } = resolveMobileNavigation(resolve(withoutTasks));
    expect(primary.map((item) => item.key)).toEqual(["dashboard", "projects"]);
  });

  it("a restricted person with no primary destination still gets a More list", () => {
    const groups = resolve(["settings", "support"]);
    const { primary, more } = resolveMobileNavigation(groups);
    expect(primary).toEqual([]);
    expect(more.flatMap((group) => group.items).length).toBeGreaterThan(0);
  });

  it("every navigable item appears exactly once, in the bar or in More", () => {
    const groups = resolve(MODULE_KEYS);
    const { primary, more } = resolveMobileNavigation(groups);
    const placed = [...primary, ...more.flatMap((group) => group.items)].map((item) => item.key).sort();
    expect(placed).toEqual(navigationItems({ enabledModules: MODULE_KEYS, permissions: allPermissions }).map((item) => item.key).sort());
  });

  it("More keeps the existing groups and drops the empty ones", () => {
    const { more } = resolveMobileNavigation(resolve(MODULE_KEYS));
    expect(more.every((group) => group.items.length > 0)).toBe(true);
    expect(more.map((group) => group.group)).toEqual([...new Set(more.map((group) => group.group))]);
  });

  it("primary is metadata on the module registry, not a route list", () => {
    const flagged = MODULE_KEYS.filter((key) => modules[key].mobilePriority === "primary");
    expect(flagged).toEqual(["dashboard", "projects", "tasks"]);
  });
});

describe("filterMoreGroups (MOB-02 §21)", () => {
  const groups = resolveMobileNavigation(resolve(MODULE_KEYS)).more;
  const label = (item: { label: string }) => item.label;

  it("returns everything for an empty query", () => {
    expect(filterMoreGroups(groups, "  ", label)).toEqual(groups);
  });

  it("matches module names only, case-insensitively", () => {
    const found = filterMoreGroups(groups, "CALEN", label).flatMap((group) => group.items.map((item) => item.key));
    expect(found).toEqual(["calendar"]);
  });

  it("returns no groups when nothing matches", () => {
    expect(filterMoreGroups(groups, "zzzz", label)).toEqual([]);
  });
});

describe("navigation events (MOB-02 §76)", () => {
  it("dispatches a window CustomEvent when a window exists, and is a no-op on the server", () => {
    expect(() => emitNavigationEvent("more_opened")).not.toThrow();
    const seen: unknown[] = [];
    const listeners = new Map<string, (event: Event) => void>();
    const fake = {
      dispatchEvent: (event: Event) => (seen.push((event as CustomEvent).detail), true),
      addEventListener: (name: string, fn: (event: Event) => void) => listeners.set(name, fn),
    };
    (globalThis as unknown as { window: unknown }).window = fake;
    try {
      emitNavigationEvent("navigation_destination_opened", { module: "projects" });
      expect(seen).toEqual([{ name: "navigation_destination_opened", data: { module: "projects" } }]);
      expect(NAVIGATION_EVENT).toBe("nesto:navigation-event");
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
