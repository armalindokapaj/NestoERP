/**
 * The navigation resolver (PRD #3 §44, §48, §98).
 *
 * There is exactly one navigation data source. The desktop sidebar, the tablet
 * drawer and the mobile drawer all render the output of `resolveNavigation` —
 * only the presentation changes with viewport (PRD #3 §99).
 *
 * Resolution order, per PRD #3 §48:
 *
 *   all navigation items
 *     → module enabled for the company?
 *     → user holds the module permission?
 *     → remove empty groups
 *     → render
 *
 * Edge-safe: no database imports, so middleware can resolve navigation too.
 */
import {
  MODULE_GROUPS,
  groupLabels,
  moduleList,
  type ModuleGroup,
  type ModuleKey,
} from "./modules";
import type { Permission } from "./permissions";

export type NavigationItem = {
  key: ModuleKey;
  label: string;
  href: string;
  /** lucide icon name — resolved to a component by the renderer. */
  icon: string;
  module: ModuleKey;
  permission: Permission;
  group: ModuleGroup;
};

export type NavigationGroup = {
  group: ModuleGroup;
  /** `null` for the primary group, which renders without a heading. */
  label: string | null;
  items: NavigationItem[];
};

export type NavigationInput = {
  permissions: readonly string[];
  /** Modules switched on for the current company (PRD #3 §42). */
  enabledModules: readonly ModuleKey[];
};

const ALL_ITEMS: NavigationItem[] = moduleList.filter((definition) => definition.inNavigation !== false).map((definition) => ({
  key: definition.key,
  label: definition.label,
  href: definition.route,
  icon: definition.icon,
  module: definition.key,
  permission: definition.permission,
  group: definition.group,
}));

/**
 * Groups with zero visible modules do not render — the heading never appears
 * over an empty list (PRD #3 §8, §91).
 */
export function resolveNavigation(input: NavigationInput): NavigationGroup[] {
  const permitted = new Set(input.permissions);
  const enabled = new Set(input.enabledModules);

  return MODULE_GROUPS.map((group) => ({
    group,
    label: groupLabels[group],
    items: ALL_ITEMS.filter(
      (item) =>
        item.group === group && enabled.has(item.module) && permitted.has(item.permission),
    ),
  })).filter((navGroup) => navGroup.items.length > 0);
}

/** Flattened navigation, for keyboard order and for tests. */
export function navigationItems(input: NavigationInput): NavigationItem[] {
  return resolveNavigation(input).flatMap((group) => group.items);
}

const ITEMS_BY_ROUTE_LENGTH = ALL_ITEMS.slice().sort((left, right) => right.href.length - left.href.length);

/**
 * Which sidebar item should be highlighted for a pathname.
 *
 * Active state follows the route hierarchy, not an exact URL match, so
 * `/projects/123/documents` keeps Projects active (PRD #3 §13).
 */
export function activeNavigationKey(pathname: string): ModuleKey | null {
  // By route, not by key: Daily Logs is `dailyLogs` at `/daily-logs`, and a
  // key match never marked it (AUD-05 §3, UX-03). The longest route wins.
  const path = pathname.split(/[?#]/)[0];
  const match = ITEMS_BY_ROUTE_LENGTH.find((item) => path === item.href || path.startsWith(`${item.href}/`));
  return match?.module ?? null;
}

export function isNavigationItemActive(item: NavigationItem, pathname: string): boolean {
  return activeNavigationKey(pathname) === item.module;
}
