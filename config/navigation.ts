/**
 * The navigation resolver (PRD #3 §44, §48, §98).
 *
 * There is exactly one navigation data source. The top bar's Ribbon, the
 * logo's all-modules panel and the phone's Ribbon all render the output of
 * `resolveNavigation` — only the presentation changes with viewport
 * (PRD #3 §99).
 *
 * Resolution order, per PRD #3 §48:
 *
 *   all navigation items
 *     → module enabled for the company?
 *     → user holds the module permission?
 *     → remove empty groups
 *     → render
 *
 * Where every module lives is `NAVIGATION_LAYOUT` below
 * (docs/ui/UI-04-navigation-layouts.md): Home, the four Ribbon tabs — Work,
 * Sales, Procurement, Finance — and Company, each in captioned sets.
 *
 * Edge-safe: no database imports, so middleware can resolve navigation too.
 */
import { modules, type ModuleKey } from "./modules";
import type { Permission } from "./permissions";

/** The navigation's groups, in order: Home, the four Ribbon tabs, Company. */
export const NAVIGATION_GROUPS = ["primary", "work", "sales", "procurement", "finance", "company"] as const;
export type NavigationGroupKey = (typeof NAVIGATION_GROUPS)[number];

/** The four tabs of the top bar's Ribbon, in the bar's order. Home is the company name; Home and Company also sit in the logo's panel. */
export const RIBBON_TABS = ["work", "sales", "procurement", "finance"] as const satisfies readonly NavigationGroupKey[];
export type RibbonTab = (typeof RIBBON_TABS)[number];

export function isRibbonTab(group: NavigationGroupKey): group is RibbonTab {
  return (RIBBON_TABS as readonly string[]).includes(group);
}

/** The captioned sets the Ribbon draws modules in (`shell.ribbon.sets` names them). */
export type NavigationSet = "home" | "projects" | "site" | "quality" | "files" | "sell" | "legal" | "buy" | "stock" | "money" | "people" | "company";

/**
 * Where every module lives: its group and, inside it, the captioned set the
 * Ribbon draws it in. Order here is order on screen. Every module in the
 * navigation appears exactly once (tests/unit/navigation/navigation-resolver.test.ts).
 */
export const NAVIGATION_LAYOUT: readonly { group: NavigationGroupKey; sets: readonly { key: NavigationSet; modules: readonly ModuleKey[] }[] }[] = [
  { group: "primary", sets: [{ key: "home", modules: ["dashboard", "approvals"] }] },
  {
    group: "work",
    sets: [
      { key: "projects", modules: ["projects", "tasks", "meetings", "calendar"] },
      { key: "site", modules: ["dailyLogs", "workforce", "timesheets", "contractors"] },
      { key: "quality", modules: ["qaqc", "hse"] },
      { key: "files", modules: ["engineering", "documents"] },
    ],
  },
  {
    group: "sales",
    sets: [
      { key: "sell", modules: ["sales", "clients"] },
      { key: "legal", modules: ["contracts"] },
    ],
  },
  {
    group: "procurement",
    sets: [
      { key: "buy", modules: ["procurement"] },
      { key: "stock", modules: ["inventory"] },
    ],
  },
  {
    group: "finance",
    sets: [
      { key: "money", modules: ["finance"] },
      { key: "people", modules: ["hr"] },
    ],
  },
  { group: "company", sets: [{ key: "company", modules: ["people", "team", "organization", "company", "settings", "support"] }] },
];

export type NavigationItem = {
  key: ModuleKey;
  label: string;
  href: string;
  /** Icon name — resolved to a component by the renderer (components/layout/nav-icon.tsx). */
  icon: string;
  module: ModuleKey;
  permission: Permission;
  group: NavigationGroupKey;
  /** The captioned set the Ribbon draws it in (`NAVIGATION_LAYOUT`). */
  set: NavigationSet;
};

export type NavigationGroup = {
  group: NavigationGroupKey;
  items: NavigationItem[];
};

export type NavigationInput = {
  permissions: readonly string[];
  /** Modules switched on for the current company (PRD #3 §42). */
  enabledModules: readonly ModuleKey[];
};

const ALL_ITEMS: NavigationItem[] = NAVIGATION_LAYOUT.flatMap(({ group, sets }) =>
  sets.flatMap(({ key: set, modules: keys }) =>
    keys
      .map((key) => modules[key])
      .filter((definition) => definition.inNavigation !== false)
      .map((definition) => ({
        key: definition.key,
        label: definition.label,
        href: definition.route,
        icon: definition.icon,
        module: definition.key,
        permission: definition.permission,
        group,
        set,
      })),
  ),
);

/**
 * Groups with zero visible modules do not render — no tab or heading ever
 * appears over an empty list (PRD #3 §8, §91).
 */
export function resolveNavigation(input: NavigationInput): NavigationGroup[] {
  const permitted = new Set(input.permissions);
  const enabled = new Set(input.enabledModules);

  return NAVIGATION_GROUPS.map((group) => ({
    group,
    items: ALL_ITEMS.filter((item) => item.group === group && enabled.has(item.module) && permitted.has(item.permission)),
  })).filter((navGroup) => navGroup.items.length > 0);
}

/** Flattened navigation, for keyboard order and for tests. */
export function navigationItems(input: NavigationInput): NavigationItem[] {
  return resolveNavigation(input).flatMap((group) => group.items);
}

/** The modules every group holds, whoever is looking: for tests and documentation. */
export function navigationLayoutItems(): readonly NavigationItem[] {
  return ALL_ITEMS;
}

const ITEMS_BY_ROUTE_LENGTH = ALL_ITEMS.slice().sort((left, right) => right.href.length - left.href.length);

/**
 * Which navigation item should be highlighted for a pathname.
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

/** The group holding the module a path is in, if any. */
export function groupOfPath(navigation: readonly NavigationGroup[], pathname: string): NavigationGroupKey | null {
  const key = activeNavigationKey(pathname);
  return key ? (navigation.find((group) => group.items.some((item) => item.module === key))?.group ?? null) : null;
}
