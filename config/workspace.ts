/**
 * The workspace a person works in (Workspace Context PRD §3, §4, §55).
 *
 * A workspace is runtime state, never an organization model: the group and its
 * companies are `ParentGroup` and `Company` (§48, §108). The session points at
 * one — the whole group, or one company — and everything downstream reads it:
 * the dashboard, the navigation, the module lists, search, activity.
 *
 * Edge-safe and pure, like the rest of `config/`: navigation and the request
 * gates read it without touching the database.
 */
import type { ModuleKey } from "./modules";

export const WORKSPACE_SCOPE_TYPES = ["GROUP", "COMPANY"] as const;
export type WorkspaceScopeType = (typeof WORKSPACE_SCOPE_TYPES)[number];

/** §4. Group carries no company; a company workspace always names its company. */
export type WorkspaceContext = {
  parentGroupId: string;
  scopeType: WorkspaceScopeType;
  companyId: string | null;
};

/** The central event a workspace change publishes, in the browser and in the audit trail (§67). */
export const WORKSPACE_CHANGED = "WORKSPACE_CHANGED";

export type WorkspaceChange = {
  previousScopeType: WorkspaceScopeType;
  previousCompanyId: string | null;
  nextScopeType: WorkspaceScopeType;
  nextCompanyId: string | null;
  parentGroupId: string;
  workspaceKey: string;
  workspaceVersion: number;
};

export function workspaceKey(workspace: Pick<WorkspaceContext, "parentGroupId" | "scopeType" | "companyId">): string {
  return workspace.scopeType === "GROUP"
    ? `GROUP:${workspace.parentGroupId}`
    : `COMPANY:${workspace.companyId ?? "unavailable"}`;
}

/**
 * What a module does when the Group workspace is active (§25, §39, §75).
 *
 * - `AGGREGATED` — its lists and figures are the union of what the person may
 *   read in each authorised company, every row carrying its company.
 * - `AGNOSTIC` — the module is about the group itself or about the person, not
 *   about one company's records, so it reads the same in either workspace.
 * - `COMPANY_ONLY` — its records belong to one company and are worked on inside
 *   it. The Group sidebar does not offer it and its routes answer with the
 *   "choose a company" screen, so a Group header never sits over one company's
 *   data (§29).
 *
 * Every module is classified here, and a test fails when a new one is not: no
 * module implements a Company switch of its own (§39).
 */
export type GroupSupport = "AGGREGATED" | "AGNOSTIC" | "COMPANY_ONLY";

export const MODULE_GROUP_SUPPORT: Record<ModuleKey, GroupSupport> = {
  dashboard: "AGGREGATED",
  calendar: "COMPANY_ONLY",
  approvals: "AGGREGATED",
  announcements: "COMPANY_ONLY",
  projects: "AGGREGATED",
  tasks: "AGGREGATED",
  meetings: "AGGREGATED",
  timesheets: "COMPANY_ONLY",
  dailyLogs: "COMPANY_ONLY",
  workforce: "COMPANY_ONLY",
  contractors: "COMPANY_ONLY",
  engineering: "COMPANY_ONLY",
  clients: "COMPANY_ONLY",
  documents: "AGGREGATED",
  finance: "AGGREGATED",
  hr: "COMPANY_ONLY",
  sales: "AGGREGATED",
  contracts: "COMPANY_ONLY",
  procurement: "AGGREGATED",
  inventory: "COMPANY_ONLY",
  qaqc: "COMPANY_ONLY",
  hse: "COMPANY_ONLY",
  people: "AGGREGATED",
  team: "COMPANY_ONLY",
  organization: "AGNOSTIC",
  company: "COMPANY_ONLY",
  settings: "COMPANY_ONLY",
  support: "COMPANY_ONLY",
};

/**
 * The routes of an `AGGREGATED` module that read across companies in the Group
 * workspace (§25, §85). Routes stay where they are and the workspace controls
 * their data scope — but only the *list* pages have a group answer. A record's
 * own page, a form or a section nobody has aggregated belongs to one company:
 * opened from the Group workspace it asks which company (§29), so a group header
 * never sits over one company's data.
 *
 * A pattern is an exact path, or a prefix ending in `/*`. Adding a route here is
 * the claim that its page answers from `resolveWorkspaceContexts`; a test holds
 * every entry to a route that exists.
 */
export const GROUP_ROUTES: Partial<Record<ModuleKey, readonly string[]>> = {
  dashboard: ["/dashboard"],
  approvals: ["/approvals"],
  // The portfolio and the two bookmarks that redirect into it; Archived, Milestones and a project itself work inside one company.
  projects: ["/projects", "/projects/all", "/projects/my-projects"],
  tasks: ["/tasks", "/tasks/all", "/tasks/my-tasks", "/tasks/overdue", "/tasks/completed"],
  meetings: ["/meetings", "/meetings/mine", "/meetings/past", "/meetings/actions"],
  documents: ["/documents", "/documents/all", "/documents/recent"],
  finance: ["/finance", "/finance/invoices", "/finance/expenses", "/finance/budgets", "/finance/reports"],
  sales: ["/sales", "/sales/opportunities", "/sales/leads", "/sales/pipeline", "/sales/reports"],
  procurement: ["/procurement", "/procurement/requests", "/procurement/orders", "/procurement/suppliers", "/procurement/reports"],
  // The directory and every profile are group-wide by design (E-01 §103).
  people: ["/people", "/people/*"],
};

/** Whether a request path is one the Group workspace answers for this module (§25, §29). */
export function isGroupRoute(moduleKey: ModuleKey, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (GROUP_ROUTES[moduleKey] ?? []).some((pattern) =>
    pattern.endsWith("/*") ? path === pattern.slice(0, -2) || path.startsWith(`${pattern.slice(0, -1)}`) : path === pattern,
  );
}

/** Whether the Group workspace offers a module at all (§25). */
export function supportsGroupWorkspace(moduleKey: ModuleKey): boolean {
  return MODULE_GROUP_SUPPORT[moduleKey] !== "COMPANY_ONLY";
}

/** A company workspace, narrowed so its company id is known to be present. */
export function isWorkspaceCompany(workspace: WorkspaceContext): workspace is WorkspaceContext & { scopeType: "COMPANY"; companyId: string } {
  return workspace.scopeType === "COMPANY" && workspace.companyId !== null;
}

/** Whether a request is working in the Group workspace: every row then names its company (§45). */
export function inGroupWorkspace(context: { workspace: WorkspaceContext }): boolean {
  return context.workspace.scopeType === "GROUP";
}
