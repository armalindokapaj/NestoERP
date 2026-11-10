/**
 * The phone Ribbon's placement of navigation (components/layout/phone-ribbon.tsx).
 *
 * A presentation adapter over the one navigation resolver: it receives the
 * groups `resolveNavigation` already produced for this person and only
 * decides which tabs there are. It never adds a module and never checks a
 * permission. Edge-safe, so it is unit-tested on its own.
 */
import { isNavigationItemActive, type NavigationGroup } from "@/config/navigation";

/** The Ribbon's group tabs for this person: each group they have modules in, and Company always — it holds the account. */
export function phoneTabs(navigation: readonly NavigationGroup[]): NavigationGroup[] {
  const tabs = navigation.filter((group) => group.items.length > 0 && group.group !== "company");
  tabs.push(navigation.find((group) => group.group === "company") ?? { group: "company", label: null, items: [] });
  return tabs;
}

/** The group holding the module the page is in, if any. */
export function groupOf(navigation: readonly NavigationGroup[], pathname: string): NavigationGroup["group"] | null {
  return navigation.find((group) => group.items.some((item) => isNavigationItemActive(item, pathname)))?.group ?? null;
}

/** Paths under /projects that are pages of the module, not a project. */
const NOT_A_PROJECT = new Set(["all", "archived", "milestones", "my-projects", "new", "types", "unit-types"]);

/** The project a path is in, for Units; null outside a project. */
export function projectIdFrom(pathname: string): string | null {
  const id = /^\/projects\/([^/?#]+)/.exec(pathname)?.[1];
  return id && !NOT_A_PROJECT.has(id) ? id : null;
}
