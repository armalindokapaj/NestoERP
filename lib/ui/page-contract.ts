/**
 * The page contract registry (UI-02 §5, §26.3; acceptance UI02-01, UI02-16).
 *
 * Every route has one contract: which template it is, which element is its
 * scroll region, and whether the Architectural Scroll Ruler may ever appear on
 * it. A page that mounts `PageSections` (components/layout/page-sections.tsx)
 * states the first and the last itself; this file is where they are decided,
 * for all routes at once, so the route register and the pages cannot drift
 * apart:
 *
 *   scripts/ui/route-register.ts          writes docs/ui/UI-02-route-register.json from these rules
 *   tests/unit/ui/route-register.test.ts  holds the register, the pages and these rules to each other
 *
 * The decisions were made by reading the pages. A rule covers a path shape
 * (`…/new` is a form, `…/[id]` a record); `TEMPLATE` names the routes a rule
 * would get wrong. The ruler's remaining conditions — width, pointer, page
 * length, three sections — are checked where the page runs
 * (`rulerMode`, lib/ui/ruler-math.ts).
 */

export const PAGE_TEMPLATES = [
  "overview",
  "directory",
  "record",
  "form",
  "review",
  "explorer",
  "calendar",
  "board",
  "timeline",
  "report",
  "settings",
  "viewer",
  "admin-canvas",
  "system",
] as const;

export type PageTemplate = (typeof PAGE_TEMPLATES)[number];
export type RulerPolicy = "eligible" | "never";

export const PAGE_SURFACES = ["platform", "group", "company", "personal", "project", "portal", "system", "public"] as const;
export type PageSurface = (typeof PAGE_SURFACES)[number];

/** The main region of all three shells, and of the component catalog: the element a ruler says it controls. */
export const PAGE_SCROLL_REGION = "nesto-main";

/** What the decisions are made from: the route's pattern, its page file, and whether the page only redirects. */
export type PageRoute = { pattern: string; file: string; redirectOnly: boolean };

export type PageContract = {
  surface: PageSurface;
  template: PageTemplate;
  /** `null` outside the shells: a viewer, the sign-in panel, the public site scroll themselves and never carry a ruler. */
  scrollRegionId: string | null;
  rulerPolicy: RulerPolicy;
  rulerReason: string;
};

const PERSONAL = /^\/(my-day|my-work|favorites|activity|notifications|search|approvals|calendar|whats-new|help|people\/me)(\/|$)|^\/settings\/(profile|appearance|notifications|security)$|^\/tasks\/my-tasks$|^\/meetings\/mine$/;
const SYSTEM_IN_SHELL = /^\/(access-denied|module-unavailable|workspace\/company-required)$/;

export function pageSurface(route: PageRoute): PageSurface {
  const p = route.pattern;
  const f = route.file;
  if (f.startsWith("app/admin/") || f.startsWith("app/(experience-editor)/") || f.startsWith("app/(platform-viewer)/")) return "platform";
  if (f.startsWith("app/group/")) return "group";
  if (f.startsWith("app/(public)/(site)/")) return "public";
  if (f.startsWith("app/(public-viewer)/")) return "public";
  if (f.startsWith("app/(public)/")) return "system";
  if (f.startsWith("app/(offline)/") || /^app\/(device-unavailable|maintenance|workspace-unavailable|dev)\//.test(f)) return "system";
  if (SYSTEM_IN_SHELL.test(p)) return "system";
  if (p.startsWith("/projects/[projectId]")) return "project";
  if (PERSONAL.test(p)) return "personal";
  return "company";
}

/** A path that ends in one of these is a form, whatever it hangs under. */
const FORM_LEAVES = new Set(["new", "edit", "revise", "convert", "won", "lost", "assess", "close", "control", "escalate", "reinspect", "invite", "import", "investigation", "execute", "task", "quotes"]);

/** Decided by reading the page (what it renders), not by its path. */
const TEMPLATE: Record<string, PageTemplate> = {
  // Overviews: a module landing made of figures, attention panels and previews.
  "/dashboard": "overview", "/my-day": "overview", "/my-work": "overview", "/clients": "overview", "/contracts": "overview", "/documents": "overview",
  "/engineering": "overview", "/finance": "overview", "/hr": "overview", "/hse": "overview", "/inventory": "overview", "/procurement": "overview",
  "/qaqc": "overview", "/sales": "overview", "/tasks": "overview", "/team": "overview", "/organization": "overview", "/admin": "overview", "/group": "overview", "/admin/system": "overview",
  "/projects/[projectId]": "overview", "/projects/[projectId]/contractors": "overview", "/projects/[projectId]/engineering": "overview",
  "/projects/[projectId]/finance": "overview", "/projects/[projectId]/hse": "overview", "/projects/[projectId]/inventory": "overview", "/projects/[projectId]/qaqc": "overview",
  // Review queues and decisions.
  "/approvals": "review", "/finance/approvals": "review", "/hse/approvals": "review", "/qaqc/approvals": "review", "/contracts/approvals": "review",
  "/procurement/approvals": "review", "/contracts/review": "review", "/contracts/requests": "review", "/daily-logs/review": "review",
  "/timesheets/team": "review", "/timesheets/[timesheetId]": "review", "/procurement/rfqs/[rfqId]/comparison": "review",
  // Specialist canvases.
  "/calendar": "calendar", "/projects/[projectId]/calendar": "calendar", "/projects/[projectId]/planning": "timeline", "/sales/pipeline": "board",
  "/documents/all": "explorer", "/documents/recent": "explorer", "/documents/archived": "explorer", "/hr/documents": "explorer",
  "/projects/[projectId]/documents": "explorer", "/projects/[projectId]/media": "explorer",
  "/projects/[projectId]/3d": "viewer", "/admin/3d/projects/[projectId]/viewer": "viewer", "/view/3d/[publicId]": "viewer",
  "/admin/3d/projects/[projectId]/editor": "admin-canvas",
  // Reports that do not sit under /reports.
  "/timesheets/projects": "report", "/projects/milestones": "report",
  // Structured entry grids.
  "/timesheets": "form", "/workforce/attendance": "form",
  // Configuration.
  "/procurement/approvals/limits": "settings", "/projects/types": "settings", "/projects/unit-types": "settings", "/workforce/trades": "settings",
  "/group/account": "settings", "/admin/account": "settings", "/admin/3d/diagnostics": "settings", "/organization/access": "settings",
  "/admin/modules/catalog": "settings", "/admin/modules/plans": "settings", "/admin/modules/pricing": "settings", "/admin/modules/templates": "settings",
  "/admin/users/roles": "settings", "/admin/users/permissions": "settings", "/group/roles": "settings",
  // Outcome and help pages inside a shell.
  "/help": "system", "/help/[module]": "system", "/whats-new": "system", "/admin/help": "system", "/admin/whats-new": "system", "/group/help": "system",
  "/group/whats-new": "system", "/notifications/[notificationId]/open": "system", "/projects/[projectId]/open": "system",
  // Record-shaped pages whose path ends in a word.
  "/admin/3d/projects/[projectId]/bindings": "record", "/admin/3d/projects/[projectId]/models": "record", "/admin/3d/projects/[projectId]/releases": "record",
  "/admin/3d/projects/[projectId]/structure": "record", "/company": "record", "/company/[section]": "record",
  // A list scoped to one organisation, and forms and editors whose path does not say so.
  "/admin/organizations/[organizationId]/departments": "directory", "/group/companies/[companyId]/users": "directory",
  "/sales/opportunities/[opportunityId]/project": "form", "/admin/modules/[companyId]": "settings", "/admin/users/inspector": "settings",
  // Directories under a project.
  "/projects/[projectId]/activity": "directory", "/projects/[projectId]/contracts": "directory", "/projects/[projectId]/daily-logs": "directory",
  "/projects/[projectId]/meetings": "directory", "/projects/[projectId]/tasks": "directory", "/projects/[projectId]/work-packages": "directory",
  "/projects/[projectId]/workforce": "directory", "/projects/[projectId]/team": "directory", "/projects/[projectId]/sales": "directory",
  "/projects/[projectId]/units": "directory", "/projects/[projectId]/finance/units": "directory",
  "/projects/[projectId]/engineering/documents": "directory", "/projects/[projectId]/engineering/drawings": "directory",
  "/projects/[projectId]/engineering/material-submittals": "directory", "/projects/[projectId]/engineering/method-statements": "directory",
  "/projects/[projectId]/engineering/rfis": "directory", "/projects/[projectId]/engineering/submittals": "directory",
  "/projects/[projectId]/engineering/transmittals": "directory",
};

export function pageTemplate(route: PageRoute, surface: PageSurface = pageSurface(route)): PageTemplate {
  const p = route.pattern;
  if (route.redirectOnly) return "system";
  if (TEMPLATE[p]) return TEMPLATE[p];
  if (surface === "system" || surface === "public") return "system";
  const segs = p.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? "";
  if (last === "reports" || last === "print") return "report";
  if (FORM_LEAVES.has(last)) return "form";
  if (p.startsWith("/settings") || last === "settings" || p.startsWith("/admin/system/")) return "settings";
  if (last.startsWith("[")) return "record";
  if (segs.slice(0, -1).some((seg) => seg.startsWith("["))) return "record";
  return "directory";
}

/** Whether the ruler may ever appear on the route, and the sentence of §8.1 that says so. */
export function pageRuler(route: PageRoute, template: PageTemplate = pageTemplate(route)): [RulerPolicy, string] {
  const p = route.pattern;
  if (p === "/dev/ui") return ["eligible", "the catalog page is itself the ruler specimen"];
  if (route.redirectOnly) return ["never", "redirect only, renders nothing"];
  switch (template) {
    case "overview":
      return ["eligible", "finite overview of sections (§8.1 overview pages)"];
    case "report":
      if (p.endsWith("/print")) return ["never", "print view: §21 removes the ruler from print"];
      return ["eligible", "finite report (§8.1)"];
    case "record": {
      const last = p.split("/").filter(Boolean).pop() ?? "";
      if (p === "/company") return ["eligible", "the company's own profile: a record detail (§8.1, §18.1)"];
      if (p === "/company/[section]") return ["never", "one section of the company profile: a single panel"];
      if (last.startsWith("[")) return ["eligible", "record detail: a long standard profile when it has three or more sections (§8.1, §18.1)"];
      return ["never", "one tab of a record: a single list or panel, fewer than three sections"];
    }
    case "directory":
      return ["never", "directory: a data grid or paged list is the primary scroll surface (§8.1)"];
    case "explorer":
      return ["never", "document explorer: its own list or grid navigation (§8.1)"];
    case "review":
      return ["never", "review queue: a paged list with a decision panel (§8.1)"];
    case "form":
      return ["never", "form: §8.1 names dashboards, details and reports; a long form uses its error summary and sections (§13.1)"];
    case "calendar":
      return ["never", "scheduling surface (§8.1, §20.1)"];
    case "board":
      return ["never", "kanban canvas scrolls inside its own viewport (§8.1, §20.2)"];
    case "timeline":
      return ["never", "timeline canvas: its time axis is the navigation (§8.1, §20.3)"];
    case "viewer":
      return ["never", "3D viewer: its own navigation tools (§8.1, §22.5)"];
    case "admin-canvas":
      return ["never", "3D authoring canvas (§8.1, §22.5)"];
    case "settings":
      return ["never", "settings page: short, not one of the page kinds §8.1 names"];
    default:
      return ["never", "system, help or outcome page (§7.5)"];
  }
}

/** The shells whose page content sits in `#nesto-main`, by where their pages are filed. */
function inShell(file: string): boolean {
  return file.startsWith("app/(nesto)/") || file.startsWith("app/admin/") || file.startsWith("app/group/") || file.startsWith("app/dev/");
}

/** The whole contract of one route. */
export function pageContract(route: PageRoute): PageContract {
  const surface = pageSurface(route);
  const template = pageTemplate(route, surface);
  const [rulerPolicy, rulerReason] = pageRuler(route, template);
  return { surface, template, scrollRegionId: inShell(route.file) ? PAGE_SCROLL_REGION : null, rulerPolicy, rulerReason };
}
