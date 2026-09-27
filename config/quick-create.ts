/**
 * The Quick Create action registry (Quick Create PRD §29-§35, §43, §57, §126-§128).
 *
 * One definition per action, read by every surface that offers "create": the
 * top-bar `+ Create` today, a command palette or a mobile FAB later. It
 * declares what an action needs; it decides nothing — the authorization
 * service decides whether a person holds `permission` in a company (§32), and
 * the module's own create page validates every prefilled id again (§62).
 *
 * Every `route` is the module's canonical create flow: Quick Create has no form
 * of its own (§3). An action whose flow is not stable is not registered (§36):
 * a purchase order is raised from a request or an RFQ (§108), a daily log only
 * under a project, so it is offered only where one is known or chosen (§111).
 *
 * Labels are the record nouns of docs/ux/glossary.md, in sentence case, the
 * same as favorites, search and approvals call them (AUD-05 §4, UX-07):
 * "Purchase request", not "Purchase Request".
 *
 * Client-safe: no server imports.
 */
import type { ModuleKey } from "./modules";
import type { Permission } from "./permissions";

export const QUICK_CREATE_GROUPS = ["GENERAL", "PROJECTS", "SALES", "FINANCE", "PROCUREMENT", "DOCUMENTS", "QAQC", "HSE"] as const;
export type QuickCreateGroup = (typeof QUICK_CREATE_GROUPS)[number];

export const QUICK_CREATE_GROUP_LABELS: Record<QuickCreateGroup, string> = {
  GENERAL: "General",
  PROJECTS: "Projects",
  SALES: "Sales",
  FINANCE: "Finance",
  PROCUREMENT: "Procurement",
  DOCUMENTS: "Documents",
  QAQC: "QA/QC",
  HSE: "HSE",
};

/** The context fields a create flow can take, and the query parameter it reads each one from (§57, §59, §60). */
export type QuickCreateContextField = "project" | "client" | "relatedRecord" | "attachedRecord";

export type QuickCreateActionDefinition = {
  key: string;
  label: string;
  moduleKey: ModuleKey;
  /** The record type it creates, as the record registry names it. */
  recordType: string;
  permission: Permission;
  group: QuickCreateGroup;
  /** The canonical create route; `:projectId` when the flow lives under a project. */
  route: string;
  icon: string;
  keywords: string[];
  supportsGroupWorkspace: boolean;
  supportsCompanyWorkspace: boolean;
  /** Who owns the new record — a Group is never a company (§14, §15). */
  ownership: "COMPANY" | "PROJECT";
  /** Context it can consume, mapped to the create page's own parameter names (§57). */
  context: Partial<Record<QuickCreateContextField, string>>;
};

export const QUICK_CREATE_ACTIONS: QuickCreateActionDefinition[] = [
  // A task can be raised against almost any record, and linked to it (§102, §120).
  { key: "tasks.task.create", label: "Task", moduleKey: "tasks", recordType: "task", permission: "task.create", group: "GENERAL", route: "/tasks/new", icon: "SquareCheckBig", keywords: ["todo", "work", "assign"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { project: "projectId", relatedRecord: "parentType|parentId" } },
  { key: "meetings.meeting.create", label: "Meeting", moduleKey: "meetings", recordType: "meeting", permission: "meeting.create", group: "GENERAL", route: "/meetings/new", icon: "Presentation", keywords: ["schedule", "agenda", "minutes"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { project: "projectId" } },
  { key: "documents.document.create", label: "Document", moduleKey: "documents", recordType: "document", permission: "document.create", group: "DOCUMENTS", route: "/documents/new", icon: "FileText", keywords: ["upload", "file", "attach"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { project: "projectId", client: "clientId", attachedRecord: "entityType|entityId" } },
  { key: "projects.project.create", label: "Project", moduleKey: "projects", recordType: "project", permission: "project.create", group: "PROJECTS", route: "/projects/new", icon: "FolderKanban", keywords: ["site", "development", "building"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { client: "clientId" } },
  { key: "projects.daily_log.create", label: "Daily log", moduleKey: "dailyLogs", recordType: "daily_log", permission: "daily_log.create", group: "PROJECTS", route: "/projects/:projectId/daily-logs/new", icon: "NotebookPen", keywords: ["site diary", "diary", "log"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "PROJECT", context: { project: ":projectId" } },
  { key: "clients.client.create", label: "Client", moduleKey: "clients", recordType: "client", permission: "client.create", group: "SALES", route: "/clients/new", icon: "Building2", keywords: ["customer", "buyer", "crm"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: {} },
  { key: "sales.opportunity.create", label: "Opportunity", moduleKey: "sales", recordType: "opportunity", permission: "sales.opportunity.create", group: "SALES", route: "/sales/opportunities/new", icon: "Target", keywords: ["deal", "lead", "pipeline"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: {} },
  { key: "finance.invoice.create", label: "Invoice", moduleKey: "finance", recordType: "invoice", permission: "finance.invoice.create", group: "FINANCE", route: "/finance/invoices/new", icon: "ReceiptText", keywords: ["bill", "billing", "finance"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { project: "projectId", client: "clientId" } },
  { key: "finance.expense.create", label: "Expense", moduleKey: "finance", recordType: "expense", permission: "finance.expense.create", group: "FINANCE", route: "/finance/expenses/new", icon: "Wallet", keywords: ["cost", "spend", "receipt"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { project: "projectId" } },
  { key: "procurement.purchase_request.create", label: "Purchase request", moduleKey: "procurement", recordType: "purchase_request", permission: "procurement.request.create", group: "PROCUREMENT", route: "/procurement/requests/new", icon: "ShoppingCart", keywords: ["pr", "buy", "requisition", "materials"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { project: "projectId" } },
  { key: "qaqc.ncr.create", label: "NCR", moduleKey: "qaqc", recordType: "non_conformance_report", permission: "qaqc.ncr.create", group: "QAQC", route: "/qaqc/ncrs/new", icon: "ClipboardCheck", keywords: ["non-conformance", "quality", "defect"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: { project: "projectId" } },
  { key: "hse.incident.create", label: "HSE incident", moduleKey: "hse", recordType: "incident", permission: "hse.incident.create", group: "HSE", route: "/hse/incidents/new", icon: "HardHat", keywords: ["safety", "accident", "injury", "near miss"], supportsGroupWorkspace: true, supportsCompanyWorkspace: true, ownership: "COMPANY", context: {} },
];

export const QUICK_CREATE_BY_KEY = new Map(QUICK_CREATE_ACTIONS.map((action) => [action.key, action]));

/**
 * Detail routes whose record is safe context for a create flow (§21, §51, §56).
 * The id is only a candidate: the server reads the record again through the
 * record registry, in the reader's own scope, before anything is prefilled.
 */
export const QUICK_CREATE_CONTEXT_ROUTES: Array<{ pattern: RegExp; recordType: string }> = [
  { pattern: /^\/projects\/([^/]+)\/units\/([^/]+)/, recordType: "project_unit" },
  { pattern: /^\/projects\/([^/]+)(?:\/|$)/, recordType: "project" },
  { pattern: /^\/clients\/([^/]+)(?:\/|$)/, recordType: "client" },
  { pattern: /^\/tasks\/([^/]+)(?:\/|$)/, recordType: "task" },
  { pattern: /^\/meetings\/([^/]+)(?:\/|$)/, recordType: "meeting" },
  { pattern: /^\/contracts\/([^/]+)(?:\/|$)/, recordType: "contract" },
  { pattern: /^\/procurement\/orders\/([^/]+)(?:\/|$)/, recordType: "purchase_order" },
  { pattern: /^\/procurement\/requests\/([^/]+)(?:\/|$)/, recordType: "purchase_request" },
  { pattern: /^\/finance\/invoices\/([^/]+)(?:\/|$)/, recordType: "invoice" },
  { pattern: /^\/qaqc\/inspections\/([^/]+)(?:\/|$)/, recordType: "quality_inspection" },
  { pattern: /^\/qaqc\/ncrs\/([^/]+)(?:\/|$)/, recordType: "non_conformance_report" },
  { pattern: /^\/hse\/incidents\/([^/]+)(?:\/|$)/, recordType: "incident" },
];

/** Path segments that are pages, not ids. */
const NOT_IDS = new Set(["new", "all", "portfolio", "mine", "my", "overview", "list", "board", "calendar", "reports", "settings"]);

/** The record a pathname is showing, if it is one of the context routes — never trusted, only a candidate (§62). */
export function contextCandidate(pathname: string): { recordType: string; recordId: string } | null {
  for (const route of QUICK_CREATE_CONTEXT_ROUTES) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const id = match[match.length - 1];
    if (!id || NOT_IDS.has(id) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;
    return { recordType: route.recordType, recordId: id };
  }
  return null;
}
