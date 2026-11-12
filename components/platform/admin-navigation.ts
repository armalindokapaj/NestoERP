import type { PlatformPermission } from "@/config/platform";
import { itemForPath } from "@/config/navigation";

/**
 * The Admin Console's navigation (docs/ui/UI-09-admin-console.md): every page
 * once, by what it is for, laid out as the company app lays out its modules.
 *
 *   Home        Overview · Help · What's new — the logo's panel and the phone's Menu
 *   Customers   Organizations, Projects · Entitlements, Plans, Pricing
 *   People      Accounts, People, Memberships · Roles, Permissions, Grants, Inspector · Sessions, Devices
 *   Product     Catalog, Templates, Feature flags · Experiences, Models, Publishing, 3D diagnostics
 *   Operations  Health, Jobs, Storage, Data diagnostics · Email, Notifications, Integrations · Maintenance, Recovery, Support, Settings
 *   Security    Audit log, Security events, Access changes, Failed sign-ins · Authentication, Security policy, Mobile policy
 *
 * The five after Home are the Ribbon's tabs in the top bar; each tab's pages
 * stand in captioned sets under it (components/layout/ribbon.tsx). A page is
 * offered only to somebody who holds its permission, and a tab with no page
 * left is not drawn.
 *
 * Labels here are English; the shell puts each in the reader's language
 * (`admin.nav.page.<key>`, `nav.area.<area>`, `nav.set.<set>`). Icons are
 * names for `getIcon` (components/layout/nav-icon.tsx).
 */

export const ADMIN_HOME = "/admin";

/** The areas in order: Home, then the Ribbon's five tabs. */
export const ADMIN_AREAS = ["home", "customers", "people", "product", "operations", "security"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];
export const ADMIN_TABS = ["customers", "people", "product", "operations", "security"] as const satisfies readonly AdminArea[];

export type AdminPage = { key: string; label: string; href: string; icon: string; area: AdminArea; set: string; permission: PlatformPermission };

const page = (area: AdminArea, set: string, key: string, label: string, href: string, icon: string, permission: PlatformPermission): AdminPage => ({ key, label, href, icon, area, set, permission });

export const ADMIN_PAGES: AdminPage[] = [
  page("home", "home", "overview", "Overview", "/admin", "LayoutDashboard", "platform.dashboard.view"),
  page("home", "home", "help", "Help", "/admin/help", "CircleHelp", "platform.dashboard.view"),
  page("home", "home", "whatsNew", "What's new", "/admin/whats-new", "Megaphone", "platform.dashboard.view"),

  page("customers", "organizations", "organizations", "Organizations", "/admin/organizations", "Building2", "platform.group.view"),
  page("customers", "organizations", "projects", "Projects", "/admin/projects", "FolderKanban", "platform.project.view"),
  page("customers", "subscriptions", "entitlements", "Entitlements", "/admin/modules", "Boxes", "platform.module.view"),
  page("customers", "subscriptions", "plans", "Plans", "/admin/modules/plans", "Layers3", "platform.module.view"),
  page("customers", "subscriptions", "pricing", "Pricing", "/admin/modules/pricing", "CreditCard", "platform.pricing.view"),

  page("people", "accounts", "accounts", "Accounts", "/admin/users", "Users", "platform.user.view"),
  page("people", "accounts", "people", "People", "/admin/users/people", "UsersRound", "platform.people.view"),
  page("people", "accounts", "memberships", "Memberships", "/admin/users/memberships", "IdCard", "platform.membership.view"),
  page("people", "access", "roles", "Roles", "/admin/users/roles", "UserRoundCog", "platform.user.view"),
  page("people", "access", "permissions", "Permissions", "/admin/users/permissions", "ListChecks", "platform.user.view"),
  page("people", "access", "grants", "Access grants", "/admin/users/grants", "BadgeCheck", "platform.membership.view"),
  page("people", "access", "inspector", "Access inspector", "/admin/users/inspector", "Eye", "platform.access.inspect"),
  page("people", "signins", "sessions", "Sessions", "/admin/users/sessions", "Laptop", "platform.session.view"),
  page("people", "signins", "devices", "Mobile devices", "/admin/users/devices", "Smartphone", "platform.device.view"),

  page("product", "modules", "catalog", "Catalog", "/admin/modules/catalog", "Package", "platform.module.view"),
  page("product", "modules", "templates", "Templates", "/admin/modules/templates", "FileStack", "platform.module.view"),
  page("product", "modules", "featureFlags", "Feature flags", "/admin/system/feature-flags", "ToggleRight", "platform.feature_flag.view"),
  page("product", "threeD", "experiences", "Experiences", "/admin/3d", "Orbit", "platform.3d.view"),
  page("product", "threeD", "models", "Model library", "/admin/3d/models", "Boxes", "platform.3d.view"),
  page("product", "threeD", "publishing", "Publishing", "/admin/3d/publishing", "Send", "platform.3d.view"),
  page("product", "threeD", "threeDDiagnostics", "3D diagnostics", "/admin/3d/diagnostics", "Gauge", "platform.3d.view"),

  page("operations", "health", "health", "Health", "/admin/system/health", "Gauge", "platform.operations.view"),
  page("operations", "health", "jobs", "Jobs", "/admin/system/jobs", "RefreshCw", "platform.operations.view"),
  page("operations", "health", "storage", "Storage", "/admin/system/storage", "HardDrive", "platform.operations.view"),
  page("operations", "health", "diagnostics", "Data diagnostics", "/admin/system/diagnostics", "Database", "platform.operations.view"),
  page("operations", "messages", "email", "Email", "/admin/system/email", "Send", "platform.settings.view"),
  page("operations", "messages", "notifications", "Notifications", "/admin/system/notifications", "BellRing", "platform.operations.view"),
  page("operations", "messages", "integrations", "Integrations", "/admin/system/integrations", "Network", "platform.settings.view"),
  page("operations", "care", "maintenance", "Maintenance", "/admin/system/maintenance", "Wrench", "platform.maintenance.manage"),
  page("operations", "care", "recovery", "Recovery", "/admin/system/recovery", "RotateCcw", "platform.recovery.view"),
  page("operations", "care", "support", "Support", "/admin/system/support", "LifeBuoy", "platform.support.view"),
  page("operations", "care", "settings", "Settings", "/admin/system", "Settings", "platform.settings.view"),

  page("security", "audit", "audit", "Audit log", "/admin/audit", "History", "platform.audit.view"),
  page("security", "audit", "securityEvents", "Security events", "/admin/audit/security", "ShieldCheck", "platform.security.view"),
  page("security", "audit", "accessChanges", "Access changes", "/admin/audit/access-changes", "ArrowLeftRight", "platform.security.view"),
  page("security", "audit", "failedLogins", "Failed sign-ins", "/admin/audit/failed-logins", "Ban", "platform.security.view"),
  page("security", "policy", "authentication", "Authentication", "/admin/system/authentication", "UserCheck", "platform.settings.view"),
  page("security", "policy", "securityPolicy", "Security policy", "/admin/system/security", "Gavel", "platform.security.view"),
  page("security", "policy", "mobilePolicy", "Mobile policy", "/admin/system/mobile-policy", "MonitorSmartphone", "platform.security.view"),
];

/** The pages this person may open, in order. */
export function adminPagesFor(permissions: readonly string[]): AdminPage[] {
  return ADMIN_PAGES.filter((item) => permissions.includes(item.permission));
}

/** The page a path is under, by hierarchy: `/admin/organizations/x/departments` is Organizations. */
export function adminPageFor(pathname: string, pages: readonly AdminPage[] = ADMIN_PAGES): AdminPage | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  // Overview is the console's root: only the root itself, never everything under it.
  if (path === ADMIN_HOME) return pages.find((item) => item.href === ADMIN_HOME) ?? null;
  return itemForPath(pages.filter((item) => item.href !== ADMIN_HOME), path);
}

/** Menu, the phone bar's last place: every area, and you. */
export const ADMIN_MENU = "/admin/menu";

/** The phone bar's places (docs/ui/UI-09-admin-console.md §Phone). */
export type AdminPlace = "home" | "customers" | "people" | "menu";

/** Which of the phone bar's places a path is in: Home is the Overview alone; Customers and People their areas; anything else is reached from Menu. */
export function adminPlaceOf(pathname: string, pages: readonly AdminPage[] = ADMIN_PAGES): AdminPlace {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === ADMIN_HOME) return "home";
  const area = adminPageFor(path, pages)?.area;
  return area === "customers" || area === "people" ? area : "menu";
}

/**
 * Where the phone's Back goes from a path: nowhere from a page of the
 * navigation or Menu, which are first pages; from deeper (an organization, a
 * user) up to the page it is under; from anywhere else (Account) to Menu.
 */
export function adminUp(pathname: string, pages: readonly AdminPage[] = ADMIN_PAGES): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === ADMIN_HOME || path === ADMIN_MENU || pages.some((item) => item.href === path)) return null;
  return adminPageFor(path, pages)?.href ?? ADMIN_MENU;
}
