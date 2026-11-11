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
 *     → user holds the module's permission, and the section's?
 *     → remove empty groups
 *     → render
 *
 * Two layouts (docs/ui/UI-04-navigation-layouts.md):
 *
 * - `MENU`: every module once, by group — Home, the five Ribbon tabs —
 *   for the logo's panel. Units is listed as a module of its own.
 * - `RIBBON`: the five tabs — Work, Company, Sales, Procurement,
 *   Finance — each in captioned sets of three or four buttons. A button opens a
 *   module, or one of its sections (Orders, Drawings, Leads), so the modules
 *   spread evenly across the tabs (Microsoft's ribbon rules: no group of one).
 *
 * Labels here are English; the server puts each in the reader's language
 * (lib/workspace/navigation.ts). Edge-safe: no database imports.
 */
import { modules, type ModuleKey } from "./modules";
import type { Permission } from "./permissions";

/** The navigation's groups, in order: Home, then the five Ribbon tabs. */
export const NAVIGATION_GROUPS = ["primary", "work", "company", "sales", "procurement", "finance"] as const;
export type NavigationGroupKey = (typeof NAVIGATION_GROUPS)[number];

/** The five tabs of the top bar's Ribbon, in the bar's order. Home is the company name, and in the logo's panel. */
export const RIBBON_TABS = ["work", "company", "sales", "procurement", "finance"] as const satisfies readonly NavigationGroupKey[];
export type RibbonTab = (typeof RIBBON_TABS)[number];

export function isRibbonTab(group: NavigationGroupKey): group is RibbonTab {
  return (RIBBON_TABS as readonly string[]).includes(group);
}

/** The captioned sets the Ribbon draws its buttons in (`shell.ribbon.sets` names them). */
export type NavigationSet =
  | "menu"
  | "plan"
  | "site"
  | "design"
  | "quality"
  | "people"
  | "organization"
  | "records"
  | "admin"
  | "units"
  | "pipeline"
  | "buyers"
  | "buy"
  | "supply"
  | "stock"
  | "money"
  | "control";

/** Labels that are neither a module's nor a section's: `shell.nav`. */
export type NavigationLabelKey = "units" | "forSale" | "reserved" | "sold";

export type NavigationItem = {
  /** Unique: the module's key, `module.section`, or one of Units' own. */
  key: string;
  module: ModuleKey;
  href: string;
  /** Icon name — resolved to a component by the renderer (components/layout/nav-icon.tsx). */
  icon: string;
  /** English here; the server puts the reader's language in (lib/workspace/navigation.ts). */
  label: string;
  /** Where the label's translation comes from. */
  labelFrom: { kind: "module" } | { kind: "section"; section: string } | { kind: "shell"; key: NavigationLabelKey };
  /** Every one of these must be held: the module's view permission, and the section's. */
  permissions: Permission[];
  /** A section's second door, for somebody who reaches only their own records (PRD #16 §11). */
  selfPermission?: Permission;
  group: NavigationGroupKey;
  set: NavigationSet;
};

export type NavigationGroup = {
  group: NavigationGroupKey;
  items: NavigationItem[];
};

/** What one person sees: the logo's panel and the Ribbon's tabs. */
export type Navigation = {
  menu: NavigationGroup[];
  ribbon: NavigationGroup[];
};

export type NavigationInput = {
  permissions: readonly string[];
  /** Modules switched on for the current company (PRD #3 §42). */
  enabledModules: readonly ModuleKey[];
};

type Place = { group: NavigationGroupKey; set: NavigationSet };

/** A module, at its own route. */
function moduleItem(key: ModuleKey, place: Place): NavigationItem {
  const definition = modules[key];
  return {
    key,
    module: key,
    href: definition.route,
    icon: definition.icon,
    label: definition.label,
    labelFrom: { kind: "module" },
    permissions: [definition.permission],
    ...place,
  };
}

/** One of a module's sections (config/modules.ts), with its permission and its label. */
function sectionItem(key: ModuleKey, sectionKey: string, icon: string, place: Place): NavigationItem {
  const definition = modules[key];
  const section = definition.sections.find((candidate) => candidate.key === sectionKey);
  if (!section) throw new Error(`No section "${sectionKey}" in module "${key}".`);
  return {
    key: `${key}.${sectionKey}`,
    module: key,
    href: sectionKey === definition.defaultSection ? definition.route : `${definition.route}/${sectionKey}`,
    icon,
    label: section.label,
    labelFrom: { kind: "section", section: sectionKey },
    permissions: section.permission ? [definition.permission, section.permission] : [definition.permission],
    selfPermission: section.selfPermission,
    ...place,
  };
}

/**
 * Units: every unit across the projects this person can open, at
 * /projects/units. It rides on the Projects module's switch and its structure
 * permission, so everyone who may see a project's units may see them all here;
 * its status views also need the units' sales view.
 */
const UNITS_ROUTE = "/projects/units";
const UNITS_LABELS: Record<NavigationLabelKey, string> = { units: "Units", forSale: "For sale", reserved: "Reserved", sold: "Sold" };
export const UNITS_STATUS_PATHS = { forSale: "for-sale", reserved: "reserved", sold: "sold" } as const;

function unitsItem(key: NavigationLabelKey, icon: string, place: Place): NavigationItem {
  const status = key === "units" ? null : UNITS_STATUS_PATHS[key];
  return {
    key: key === "units" ? "units" : `units.${status}`,
    module: "projects",
    href: status ? `${UNITS_ROUTE}/${status}` : UNITS_ROUTE,
    icon,
    label: UNITS_LABELS[key],
    labelFrom: { kind: "shell", key },
    permissions: status ? ["project.view", "project.structure.view", "project.unit.sales.view"] : ["project.view", "project.structure.view"],
    ...place,
  };
}

const UNITS_ICON = "Layers3";

/** Every module once, by group, for the logo's panel. Order here is order on screen. */
const MENU: readonly NavigationItem[] = (() => {
  const at = (group: NavigationGroupKey): Place => ({ group, set: "menu" });
  const list = (group: NavigationGroupKey, keys: readonly ModuleKey[]) => keys.map((key) => moduleItem(key, at(group)));
  return [
    ...list("primary", ["dashboard", "approvals", "support"]),
    ...list("work", ["projects", "tasks", "meetings", "calendar", "dailyLogs", "workforce", "timesheets", "engineering", "qaqc", "hse"]),
    ...list("company", ["people", "team", "hr", "organization", "documents", "contracts", "company", "settings"]),
    unitsItem("units", UNITS_ICON, at("sales")),
    ...list("sales", ["sales", "clients"]),
    ...list("procurement", ["procurement", "contractors", "inventory"]),
    ...list("finance", ["finance"]),
  ];
})();

/** The five tabs, each in captioned sets of three or four. Order here is order on screen. */
const RIBBON: readonly NavigationItem[] = (() => {
  const m = (group: RibbonTab, set: NavigationSet, key: ModuleKey) => moduleItem(key, { group, set });
  const s = (group: RibbonTab, set: NavigationSet, key: ModuleKey, section: string, icon: string) => sectionItem(key, section, icon, { group, set });
  const u = (set: NavigationSet, key: NavigationLabelKey, icon: string) => unitsItem(key, icon, { group: "sales", set });
  return [
    // Work: the project, day to day — the tab that opens first.
    m("work", "plan", "projects"),
    m("work", "plan", "tasks"),
    m("work", "plan", "meetings"),
    m("work", "plan", "calendar"),
    m("work", "site", "dailyLogs"),
    m("work", "site", "workforce"),
    m("work", "site", "timesheets"),
    s("work", "design", "engineering", "drawings", "PencilRuler"),
    s("work", "design", "engineering", "rfis", "MessageCircleQuestionMark"),
    s("work", "design", "engineering", "submittals", "FileStack"),
    m("work", "quality", "qaqc"),
    s("work", "quality", "qaqc", "defects", "Flag"),
    m("work", "quality", "hse"),
    s("work", "quality", "hse", "incidents", "TriangleAlert"),
    // Company: the company, across projects.
    m("company", "people", "people"),
    m("company", "people", "team"),
    m("company", "people", "hr"),
    s("company", "people", "hr", "recruitment", "UserPlus"),
    m("company", "organization", "organization"),
    s("company", "organization", "organization", "departments", "FolderKanban"),
    s("company", "organization", "organization", "companies", "Landmark"),
    m("company", "records", "documents"),
    m("company", "records", "contracts"),
    s("company", "records", "contracts", "expiring", "CalendarClock"),
    m("company", "admin", "company"),
    s("company", "admin", "company", "modules", "ToggleRight"),
    s("company", "admin", "organization", "access", "IdCard"),
    m("company", "admin", "settings"),
    // Sales: the units, and the people who buy them.
    u("units", "units", UNITS_ICON),
    u("units", "forSale", "Target"),
    u("units", "reserved", "CalendarCheck"),
    u("units", "sold", "BadgeCheck"),
    s("sales", "pipeline", "sales", "leads", "UserPlus"),
    s("sales", "pipeline", "sales", "opportunities", "TrendingUp"),
    s("sales", "pipeline", "sales", "pipeline", "ChartNoAxesCombined"),
    s("sales", "pipeline", "sales", "proposals", "FileSignal"),
    m("sales", "buyers", "clients"),
    s("sales", "buyers", "sales", "tasks", "ListChecks"),
    s("sales", "buyers", "sales", "reports", "ChartPie"),
    // Procurement: buying, subcontracting and stock.
    s("procurement", "buy", "procurement", "requests", "ClipboardList"),
    s("procurement", "buy", "procurement", "rfqs", "Send"),
    s("procurement", "buy", "procurement", "orders", "ShoppingCart"),
    s("procurement", "buy", "procurement", "approvals", "Stamp"),
    s("procurement", "supply", "procurement", "suppliers", "Handshake"),
    m("procurement", "supply", "contractors"),
    s("procurement", "supply", "contractors", "work-packages", "Package"),
    s("procurement", "supply", "contractors", "compliance", "FileBadge"),
    s("procurement", "stock", "inventory", "items", "NestoInventory"),
    s("procurement", "stock", "inventory", "receipts", "PackageCheck"),
    s("procurement", "stock", "inventory", "movements", "ArrowLeftRight"),
    s("procurement", "stock", "inventory", "low-stock", "PackageMinus"),
    // Finance: money and control.
    m("finance", "money", "finance"),
    s("finance", "money", "finance", "invoices", "ReceiptText"),
    s("finance", "money", "finance", "payments", "CreditCard"),
    s("finance", "money", "finance", "expenses", "Wallet"),
    s("finance", "control", "finance", "budgets", "Gauge"),
    s("finance", "control", "finance", "commitments", "FileText"),
    s("finance", "control", "finance", "approvals", "Stamp"),
    s("finance", "control", "finance", "reports", "ChartPie"),
  ];
})();

function visible(input: NavigationInput) {
  const permitted = new Set(input.permissions);
  const enabled = new Set(input.enabledModules);
  return (item: NavigationItem) =>
    enabled.has(item.module) &&
    (item.permissions.every((permission) => permitted.has(permission)) ||
      // The self-service door: the module's own permission and the section's second one (PRD #16 §11).
      Boolean(item.selfPermission && permitted.has(item.permissions[0]!) && permitted.has(item.selfPermission)));
}

function grouped(items: readonly NavigationItem[], groups: readonly NavigationGroupKey[]): NavigationGroup[] {
  return groups.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter((navGroup) => navGroup.items.length > 0);
}

/**
 * What this person sees. Groups with nothing visible do not render — no tab or
 * heading ever appears over an empty list (PRD #3 §8, §91).
 */
export function resolveNavigation(input: NavigationInput): Navigation {
  const shows = visible(input);
  return {
    menu: grouped(MENU.filter(shows), NAVIGATION_GROUPS),
    ribbon: grouped(RIBBON.filter(shows), RIBBON_TABS),
  };
}

/** Both layouts kept to the given items, in layout order: the Group workspace's union of its companies. */
export function navigationOf(keys: ReadonlySet<string>): Navigation {
  const kept = (item: NavigationItem) => keys.has(item.key);
  return { menu: grouped(MENU.filter(kept), NAVIGATION_GROUPS), ribbon: grouped(RIBBON.filter(kept), RIBBON_TABS) };
}

/** The panel's modules, flattened — Units, a view of Projects, aside. */
export function navigationItems(input: NavigationInput): NavigationItem[] {
  return resolveNavigation(input)
    .menu.flatMap((group) => group.items)
    .filter((item) => item.labelFrom.kind === "module");
}

/** Both layouts in full, whoever is looking: for tests and documentation. */
export function navigationLayout(): { menu: readonly NavigationItem[]; ribbon: readonly NavigationItem[] } {
  return { menu: MENU, ribbon: RIBBON };
}

/** The item whose route the path is in — the longest route wins, so `/procurement/orders/12` is Orders. */
export function itemForPath<T extends Pick<NavigationItem, "href">>(items: readonly T[], pathname: string): T | null {
  const path = pathname.split(/[?#]/)[0]!;
  let best: T | null = null;
  for (const item of items) {
    if ((path === item.href || path.startsWith(`${item.href}/`)) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

const MODULE_ITEMS = MENU.filter((item) => item.labelFrom.kind === "module");

/**
 * Which module a pathname is in. Active state follows the route hierarchy,
 * not an exact URL match, so `/projects/123/documents` keeps Projects active
 * (PRD #3 §13); Daily Logs is `dailyLogs` at `/daily-logs` (AUD-05 §3).
 */
export function activeNavigationKey(pathname: string): ModuleKey | null {
  return itemForPath(MODULE_ITEMS, pathname)?.module ?? null;
}

export function isNavigationItemActive(item: NavigationItem, pathname: string, among: readonly NavigationItem[]): boolean {
  return itemForPath(among, pathname)?.key === item.key;
}

/** What a search across the navigation finds: every entry once — the panel's modules, then the Ribbon's sections — whose name holds the text, by group. */
export function findInNavigation(navigation: Navigation, text: string): NavigationGroup[] {
  const needle = text.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  const found = [...navigation.menu, ...navigation.ribbon]
    .flatMap((group) => group.items)
    .filter((item) => {
      if (seen.has(item.key) || !item.label.toLocaleLowerCase().includes(needle)) return false;
      seen.add(item.key);
      return true;
    });
  return grouped(found, NAVIGATION_GROUPS);
}

/** The group a path is in: the Ribbon's finer buttons first (Units is Sales, though it lives under Projects), then the panel's modules. */
export function groupOfPath(navigation: Navigation, pathname: string): NavigationGroupKey | null {
  const all = [...navigation.ribbon.flatMap((group) => group.items), ...navigation.menu.flatMap((group) => group.items)];
  return itemForPath(all, pathname)?.group ?? null;
}
