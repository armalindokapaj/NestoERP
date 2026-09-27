import type { DemoRole } from "../fixtures";

/**
 * AUD-07 §2 route manifest: what is measured, as whom, and what "usable"
 * means for each route (PS-01, PS-02). Usable is not a heading, a skeleton or
 * a URL change (§4): the browser is at the route's own path, nothing in the
 * main region is busy, at least `min` of the route's own records are visible,
 * hydrated (React has attached their handlers, so a click on one works) and
 * not left over from the page the navigation started on, and — where the page
 * has one — its primary control (`control`) is visible, enabled and hydrated.
 * An empty or failed page is a failed sample, never a fast one, so no
 * `records` selector matches an empty state.
 *
 * Records are chosen for both layouts: a desktop table row's link and a
 * phone's DataTable card link (`[data-record-card]`, AUD-04/08), and a record
 * id is never part of a selector, so D1 and D10 cohorts share the manifest.
 *
 * `core` routes are measured in every mode and profile (§3: 30 samples after 5
 * warm-ups); the rest once per enabled module, document entry only.
 * `link` is how a person reaches the route in-app for the warm and uncached
 * modes: a sidebar entry (the drawer on a phone), or a link inside the origin
 * page. The origin is always another page, so the measurement is a real
 * navigation.
 *
 * docs/perf/route-manifest.md is the human-readable manifest (PS-01); keep the two in step.
 */
export type AudRoute = {
  id: string;
  module: string;
  path: string;
  role: DemoRole;
  scope: "COMPANY" | "GROUP";
  /** Visible elements that are this route's records. */
  records: string;
  min: number;
  /** The page's primary interaction, when it has one (a list's search field): must be usable too. */
  control?: string;
  core: boolean;
  /** For warm/uncached navigation: the page it starts from and the link clicked there. */
  origin?: string;
  link?: string;
};

/** A DataTable list's record links: table rows on desktop, record cards on a phone. */
// A Group list's card has no whole-card link: its title carries the record's company instead.
const list = (prefix: string) => `#nesto-main table tbody tr a[href^="${prefix}"], #nesto-main [data-record-card] a[data-card-link][href^="${prefix}"], #nesto-main [data-record-card] a[data-company-id][href^="${prefix}"]`;
/** The AUD-08 list toolbar's search field. */
const SEARCH = '#nesto-main form[role="search"] input';

export const AUD07_ROUTES: AudRoute[] = [
  // Core, Company scope (§2 deep tests).
  { id: "dashboard", module: "dashboard", path: "/dashboard", role: "OWNER", scope: "COMPANY", records: '#nesto-main a[href^="/"]:not([href="/dashboard"])', min: 5, core: true, origin: "/projects", link: 'nav a[href="/dashboard"]' },
  { id: "projects", module: "projects", path: "/projects", role: "OWNER", scope: "COMPANY", records: '#nesto-main [data-testid="project-card-link"]', min: 1, core: true, origin: "/dashboard", link: 'nav a[href="/projects"]' },
  { id: "project-units", module: "projects", path: "/projects/project_a/units", role: "PROJECT_MANAGER", scope: "COMPANY", records: '#nesto-main [data-testid="unit-row"], #nesto-main [data-testid="unit-card"]', min: 1, core: true, origin: "/projects/project_a", link: '#nesto-main a[href="/projects/project_a/units"]' },
  // The sidebar's Tasks entry opens the overview (/tasks); the list is its "All" tab.
  { id: "tasks", module: "tasks", path: "/tasks/all", role: "OWNER", scope: "COMPANY", records: list("/tasks/"), min: 5, control: SEARCH, core: true, origin: "/tasks", link: '#nesto-main a[href="/tasks/all"]' },
  { id: "invoices", module: "finance", path: "/finance/invoices", role: "FINANCE", scope: "COMPANY", records: list("/finance/invoices/"), min: 3, control: SEARCH, core: true, origin: "/finance", link: '#nesto-main a[href="/finance/invoices"], nav a[href="/finance/invoices"]' },
  { id: "expenses", module: "finance", path: "/finance/expenses", role: "FINANCE", scope: "COMPANY", records: list("/finance/expenses/"), min: 3, control: SEARCH, core: true, origin: "/finance", link: '#nesto-main a[href="/finance/expenses"], nav a[href="/finance/expenses"]' },
  // The sidebar's Documents entry opens the overview; the register is its "All" tab.
  { id: "documents", module: "documents", path: "/documents/all", role: "OWNER", scope: "COMPANY", records: list("/documents/"), min: 3, control: SEARCH, core: true, origin: "/documents", link: '#nesto-main a[href="/documents/all"]' },
  { id: "approvals", module: "approvals", path: "/approvals", role: "OWNER", scope: "COMPANY", records: '#nesto-main [data-testid="approval-row"]', min: 1, core: true, origin: "/dashboard", link: 'nav a[href^="/approvals"]' },
  { id: "daily-logs", module: "daily-logs", path: "/daily-logs", role: "PROJECT_MANAGER", scope: "COMPANY", records: '#nesto-main [data-testid="daily-log-row"]', min: 1, control: SEARCH, core: true, origin: "/dashboard", link: 'nav a[href^="/daily-logs"]' },
  // Core, Group scope: the same people in the Group workspace.
  { id: "group-dashboard", module: "dashboard", path: "/dashboard", role: "OWNER", scope: "GROUP", records: '#nesto-main a[href^="/"]:not([href="/dashboard"])', min: 5, core: true, origin: "/projects", link: 'nav a[href="/dashboard"]' },
  { id: "group-projects", module: "projects", path: "/projects", role: "OWNER", scope: "GROUP", records: '#nesto-main [data-testid="project-card-link"]', min: 3, core: true, origin: "/dashboard", link: 'nav a[href="/projects"]' },
  { id: "group-tasks", module: "tasks", path: "/tasks/all", role: "OWNER", scope: "GROUP", records: list("/tasks/"), min: 5, control: SEARCH, core: true, origin: "/tasks", link: '#nesto-main a[href="/tasks/all"]' },
  { id: "group-invoices", module: "finance", path: "/finance/invoices", role: "FINANCE", scope: "GROUP", records: list("/finance/invoices/"), min: 3, control: SEARCH, core: true, origin: "/finance", link: '#nesto-main a[href="/finance/invoices"], nav a[href="/finance/invoices"]' },
  { id: "group-approvals", module: "approvals", path: "/approvals", role: "OWNER", scope: "GROUP", records: '#nesto-main [data-testid="approval-row"]', min: 1, core: true, origin: "/dashboard", link: 'nav a[href^="/approvals"]' },
  // Every other enabled module, once (§2).
  { id: "clients", module: "clients", path: "/clients/all", role: "SALES", scope: "COMPANY", records: list("/clients/"), min: 2, control: SEARCH, core: false },
  { id: "sales", module: "sales", path: "/sales", role: "SALES", scope: "COMPANY", records: '#nesto-main a[href^="/sales/"]', min: 1, core: false },
  { id: "contracts", module: "contracts", path: "/contracts", role: "LEGAL", scope: "COMPANY", records: '#nesto-main a[href^="/contracts/"]', min: 1, core: false },
  { id: "procurement", module: "procurement", path: "/procurement", role: "PROCUREMENT", scope: "COMPANY", records: '#nesto-main a[href^="/procurement/"]', min: 1, core: false },
  { id: "inventory", module: "inventory", path: "/inventory", role: "INVENTORY", scope: "COMPANY", records: '#nesto-main a[href^="/inventory/"]', min: 1, core: false },
  { id: "hse", module: "hse", path: "/hse", role: "HSE", scope: "COMPANY", records: '#nesto-main a[href^="/hse/"]', min: 1, core: false },
  { id: "qaqc", module: "qaqc", path: "/qaqc", role: "QAQC", scope: "COMPANY", records: '#nesto-main a[href^="/qaqc/"]', min: 1, core: false },
  { id: "hr", module: "hr", path: "/hr", role: "HR", scope: "COMPANY", records: '#nesto-main a[href^="/hr/"]', min: 1, core: false },
  { id: "meetings", module: "meetings", path: "/meetings", role: "PROJECT_MANAGER", scope: "COMPANY", records: '#nesto-main a[href^="/meetings/"]', min: 1, core: false },
  { id: "calendar", module: "calendar", path: "/calendar", role: "PROJECT_MANAGER", scope: "COMPANY", records: '#nesto-main [data-testid^="calendar-"]', min: 1, core: false },
  { id: "timesheets", module: "timesheets", path: "/timesheets", role: "PROJECT_MANAGER", scope: "COMPANY", records: '#nesto-main [data-testid^="timesheet"]', min: 1, core: false },
  { id: "engineering", module: "engineering", path: "/engineering", role: "ENGINEER", scope: "COMPANY", records: '#nesto-main a[href*="/engineering/"]', min: 1, core: false },
  { id: "contractors", module: "contractors", path: "/contractors", role: "PROJECT_MANAGER", scope: "COMPANY", records: '#nesto-main a[href^="/contractors/"]', min: 1, core: false },
  { id: "workforce", module: "workforce", path: "/workforce", role: "HR", scope: "COMPANY", records: '#nesto-main a[href^="/workforce/"]', min: 1, core: false },
  { id: "people", module: "people", path: "/people", role: "OWNER", scope: "COMPANY", records: '#nesto-main a[href^="/people/"]', min: 3, core: false },
  // Company administration and support: selectors confirmed by the discover pass before timing (docs/perf/route-manifest.md).
  // The overview's summary cards; the member list is /team/people.
  { id: "team", module: "team", path: "/team", role: "OWNER", scope: "COMPANY", records: '#nesto-main a[href^="/team/"]', min: 2, core: false },
  { id: "organization", module: "organization", path: "/organization", role: "OWNER", scope: "COMPANY", records: '#nesto-main [data-testid="department-metric"]', min: 1, core: false },
  { id: "company", module: "company", path: "/company", role: "OWNER", scope: "COMPANY", records: '#nesto-main a[href^="/company/"]', min: 1, core: false },
  { id: "settings", module: "settings", path: "/settings", role: "OWNER", scope: "COMPANY", records: '#nesto-main a[href^="/settings/"]', min: 3, core: false },
  { id: "support", module: "support", path: "/support", role: "OWNER", scope: "COMPANY", records: '#nesto-main a[href^="/support/"]', min: 1, core: false },
  { id: "announcements", module: "announcements", path: "/announcements?tab=manage", role: "OWNER", scope: "COMPANY", records: '#nesto-main a[href^="/announcements/"]:not([href="/announcements/new"])', min: 1, core: false },
  { id: "activity", module: "announcements", path: "/activity", role: "OWNER", scope: "COMPANY", records: '#nesto-main [data-testid="activity-row"]', min: 3, core: false },
];
