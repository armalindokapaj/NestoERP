/**
 * The phone shell's placement of navigation (MOB-02 §63-§65).
 *
 * A presentation adapter over the one navigation resolver. It receives the
 * groups `resolveNavigation` already produced for this person — module switch
 * and permission applied — and only decides *where* each item sits:
 *
 *   primary  the bottom bar, at most three destinations
 *   more     everything else, kept in its existing groups
 *
 * It never adds an item and never checks a permission: an item that is not in
 * its input cannot appear in its output. Which modules are primary is
 * `mobilePriority` in config/modules.ts, not a route list here. Edge-safe.
 */
import { modules } from "@/config/modules";
import type { NavigationGroup, NavigationItem } from "@/config/navigation";

/** The bar holds five slots: these primary destinations, then Create and More. */
export const MAX_PRIMARY_DESTINATIONS = 3;

export type MobileNavigation = {
  primary: NavigationItem[];
  /** Groups holding what is not in the bar; empty groups are dropped. */
  more: NavigationGroup[];
};

export function resolveMobileNavigation(groups: readonly NavigationGroup[]): MobileNavigation {
  const primary = groups
    .flatMap((group) => group.items)
    .filter((item) => modules[item.module]?.mobilePriority === "primary")
    .slice(0, MAX_PRIMARY_DESTINATIONS);
  const inBar = new Set(primary.map((item) => item.key));
  const more = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !inBar.has(item.key)) }))
    .filter((group) => group.items.length > 0);
  return { primary, more };
}

/** Modules searched from More: a case-insensitive match on the visible label. */
export function filterMoreGroups(groups: readonly NavigationGroup[], query: string, labelOf: (item: NavigationItem) => string): NavigationGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...groups];
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => labelOf(item).toLocaleLowerCase().includes(needle)) }))
    .filter((group) => group.items.length > 0);
}

/** How many destinations More must hold before it offers a module search (MOB-02 §21). */
export const MORE_SEARCH_THRESHOLD = 8;
