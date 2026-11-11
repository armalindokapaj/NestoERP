/**
 * The phone Ribbon's placement of navigation (components/layout/phone-ribbon.tsx).
 *
 * A presentation adapter over the one navigation resolver: it receives the
 * groups `resolveNavigation` already produced for this person and only
 * decides which tabs there are. It never adds a module and never checks a
 * permission. Edge-safe, so it is unit-tested on its own.
 */
import type { Navigation, NavigationGroup } from "@/config/navigation";

/** The phone's tabs: the Ribbon's five — Work, Company, Sales, Procurement, Finance — that this person has buttons in. Home is in the logo's panel. */
export function phoneTabs(navigation: Navigation): NavigationGroup[] {
  return navigation.ribbon.filter((group) => group.items.length > 0);
}

/** Paths under /projects that are pages of the module, not a project. */
const NOT_A_PROJECT = new Set(["all", "archived", "milestones", "my-projects", "new", "types", "unit-types", "units"]);

/** The project a path is in, for Units; null outside a project. */
export function projectIdFrom(pathname: string): string | null {
  const id = /^\/projects\/([^/?#]+)/.exec(pathname)?.[1];
  return id && !NOT_A_PROJECT.has(id) ? id : null;
}
