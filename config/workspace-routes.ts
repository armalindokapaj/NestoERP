import { moduleList, type ModuleKey } from "./modules";
import type { Permission } from "./permissions";
import { GROUP_ROUTES } from "./workspace";

export const WORKSPACE_ROUTE_TYPES = [
  "GLOBAL",
  "WORKSPACE_COLLECTION",
  "WORKSPACE_RECORD",
  "WORKSPACE_MUTATION",
  "PLATFORM_ONLY",
] as const;

export type WorkspaceRouteType = (typeof WORKSPACE_ROUTE_TYPES)[number];

export type WorkspaceRecordValidatorKey =
  | "PROJECT"
  | "TASK"
  | "DOCUMENT"
  | "INVOICE"
  | "EXPENSE"
  | "BUDGET"
  | "COMMITMENT"
  | "PURCHASE_ORDER"
  | "PURCHASE_REQUEST"
  | "RFQ"
  | "CLIENT"
  | "LEAD"
  | "OPPORTUNITY"
  | "PROPOSAL"
  | "CONTRACT";

export type WorkspaceRoutePolicy = {
  pattern: string;
  routeType: WorkspaceRouteType;
  moduleKey?: ModuleKey;
  parentRoute?: string;
  moduleHome?: string;
  supportsGroupContext?: boolean;
  supportsCompanyContext?: boolean;
  preserveQueryKeys?: readonly string[];
  workspaceBoundQueryKeys?: readonly string[];
  recordValidatorKey?: WorkspaceRecordValidatorKey;
  recordId?: string;
  requiredPermission?: Permission;
};

export const PORTABLE_WORKSPACE_QUERY_KEYS = [
  "status",
  "from",
  "to",
  "dateFrom",
  "dateTo",
  "sort",
  "order",
  "q",
  "search",
  "priority",
  "type",
  "assignedToMe",
  "assignee",
  "view",
  "tab",
] as const;

export const WORKSPACE_BOUND_QUERY_KEYS = [
  "projectId",
  "unitId",
  "clientId",
  "supplierId",
  "contractId",
  "invoiceId",
  "purchaseOrderId",
  "employeeId",
  "memberId",
  "companyId",
] as const;

type RecordPattern = {
  pattern: RegExp;
  label: string;
  moduleKey: ModuleKey;
  parentRoute: string;
  validator: WorkspaceRecordValidatorKey;
  idIndex: number;
};

const RECORD_PATTERNS: readonly RecordPattern[] = [
  { pattern: /^\/projects\/([^/]+)(?:\/.*)?$/, label: "/projects/[projectId]", moduleKey: "projects", parentRoute: "/projects", validator: "PROJECT", idIndex: 1 },
  { pattern: /^\/tasks\/([^/]+)(?:\/.*)?$/, label: "/tasks/[taskId]", moduleKey: "tasks", parentRoute: "/tasks", validator: "TASK", idIndex: 1 },
  { pattern: /^\/documents\/([^/]+)(?:\/.*)?$/, label: "/documents/[documentId]", moduleKey: "documents", parentRoute: "/documents", validator: "DOCUMENT", idIndex: 1 },
  { pattern: /^\/finance\/invoices\/([^/]+)(?:\/.*)?$/, label: "/finance/invoices/[invoiceId]", moduleKey: "finance", parentRoute: "/finance/invoices", validator: "INVOICE", idIndex: 2 },
  { pattern: /^\/finance\/expenses\/([^/]+)(?:\/.*)?$/, label: "/finance/expenses/[expenseId]", moduleKey: "finance", parentRoute: "/finance/expenses", validator: "EXPENSE", idIndex: 2 },
  { pattern: /^\/finance\/budgets\/([^/]+)(?:\/.*)?$/, label: "/finance/budgets/[budgetId]", moduleKey: "finance", parentRoute: "/finance/budgets", validator: "BUDGET", idIndex: 2 },
  { pattern: /^\/finance\/commitments\/([^/]+)(?:\/.*)?$/, label: "/finance/commitments/[commitmentId]", moduleKey: "finance", parentRoute: "/finance/commitments", validator: "COMMITMENT", idIndex: 2 },
  { pattern: /^\/procurement\/orders\/([^/]+)(?:\/.*)?$/, label: "/procurement/orders/[purchaseOrderId]", moduleKey: "procurement", parentRoute: "/procurement/orders", validator: "PURCHASE_ORDER", idIndex: 2 },
  { pattern: /^\/procurement\/requests\/([^/]+)(?:\/.*)?$/, label: "/procurement/requests/[requestId]", moduleKey: "procurement", parentRoute: "/procurement/requests", validator: "PURCHASE_REQUEST", idIndex: 2 },
  { pattern: /^\/procurement\/rfqs\/([^/]+)(?:\/.*)?$/, label: "/procurement/rfqs/[rfqId]", moduleKey: "procurement", parentRoute: "/procurement/rfqs", validator: "RFQ", idIndex: 2 },
  { pattern: /^\/clients\/([^/]+)(?:\/.*)?$/, label: "/clients/[clientId]", moduleKey: "clients", parentRoute: "/clients", validator: "CLIENT", idIndex: 1 },
  { pattern: /^\/sales\/leads\/([^/]+)(?:\/.*)?$/, label: "/sales/leads/[leadId]", moduleKey: "sales", parentRoute: "/sales/leads", validator: "LEAD", idIndex: 2 },
  { pattern: /^\/sales\/opportunities\/([^/]+)(?:\/.*)?$/, label: "/sales/opportunities/[opportunityId]", moduleKey: "sales", parentRoute: "/sales/opportunities", validator: "OPPORTUNITY", idIndex: 2 },
  { pattern: /^\/sales\/proposals\/([^/]+)(?:\/.*)?$/, label: "/sales/proposals/[proposalId]", moduleKey: "sales", parentRoute: "/sales/proposals", validator: "PROPOSAL", idIndex: 2 },
  { pattern: /^\/contracts\/([^/]+)(?:\/.*)?$/, label: "/contracts/[contractId]", moduleKey: "contracts", parentRoute: "/contracts", validator: "CONTRACT", idIndex: 1 },
] as const;

const GLOBAL_ROUTES = [
  "/profile",
  "/preferences",
  "/settings/profile",
  "/settings/appearance",
  "/settings/notifications",
  "/notifications",
  "/favorites",
  "/my-work",
  "/activity",
  // Module Help: open in either workspace; each page answers only for modules the reader can open (AUD-05 §7).
  "/help",
] as const;

const MUTATION_SEGMENTS = new Set(["new", "edit", "revise", "execute", "assess", "close", "control", "investigation"]);

function normalizePathname(pathname: string): string {
  if (!pathname.startsWith("/")) return "/dashboard";
  const clean = pathname.split("?")[0].replace(/\/{2,}/g, "/");
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
}

function moduleForPath(pathname: string): ModuleKey | undefined {
  return moduleList
    .slice()
    .sort((left, right) => right.route.length - left.route.length)
    .find((module) => pathname === module.route || pathname.startsWith(`${module.route}/`))?.key;
}

function collectionBeforeMutation(pathname: string, moduleHome: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const mutationAt = segments.findIndex((segment) => MUTATION_SEGMENTS.has(segment));
  if (mutationAt < 0) return moduleHome;
  const before = segments.slice(0, mutationAt);
  const record = RECORD_PATTERNS.find((candidate) => candidate.pattern.test(`/${before.join("/")}`));
  return record?.parentRoute ?? (`/${before.join("/")}` || moduleHome);
}

function permissionForPath(moduleKey: ModuleKey, pathname: string): Permission | undefined {
  const definition = moduleList.find((module) => module.key === moduleKey);
  if (!definition) return undefined;
  const section = definition.sections.find(({ key }) => pathname === `${definition.route}/${key}` || pathname.startsWith(`${definition.route}/${key}/`));
  return section?.permission;
}

function isRegisteredCollection(moduleKey: ModuleKey, pathname: string): boolean {
  return (GROUP_ROUTES[moduleKey] ?? []).some((pattern) =>
    pattern.endsWith("/*")
      ? pathname === pattern.slice(0, -2) || pathname.startsWith(pattern.slice(0, -1))
      : pathname === pattern,
  );
}

/**
 * The authoritative route classification used by switching and its tests.
 * Record patterns are intentionally explicit; everything else underneath a
 * registered module is a collection/read subsection unless it carries a
 * mutation segment.
 */
export function workspaceRoutePolicy(pathnameInput: string): WorkspaceRoutePolicy {
  const pathname = normalizePathname(pathnameInput);
  if (pathname === "/platform-admin" || pathname.startsWith("/platform-admin/")) {
    return { pattern: "/platform-admin/*", routeType: "PLATFORM_ONLY" };
  }
  if (GLOBAL_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return { pattern: pathname, routeType: "GLOBAL" };
  }

  const moduleKey = moduleForPath(pathname);
  const moduleDefinition = moduleKey ? moduleList.find((module) => module.key === moduleKey)! : undefined;
  const moduleHome = moduleDefinition?.route ?? "/dashboard";
  if (!moduleKey) return { pattern: pathname, routeType: "GLOBAL" };

  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => MUTATION_SEGMENTS.has(segment))) {
    return {
      pattern: pathname,
      routeType: "WORKSPACE_MUTATION",
      moduleKey,
      moduleHome,
      parentRoute: collectionBeforeMutation(pathname, moduleHome),
      supportsCompanyContext: true,
      supportsGroupContext: false,
      preserveQueryKeys: PORTABLE_WORKSPACE_QUERY_KEYS,
      workspaceBoundQueryKeys: WORKSPACE_BOUND_QUERY_KEYS,
      requiredPermission: permissionForPath(moduleKey, pathname),
    };
  }

  const knownCollection = pathname === moduleHome
    || moduleDefinition?.sections.some((section) => pathname === `${moduleHome}/${section.key}`)
    || isRegisteredCollection(moduleKey, pathname);
  const record = knownCollection ? undefined : RECORD_PATTERNS.find((candidate) => candidate.pattern.test(pathname));
  if (record) {
    return {
      pattern: record.label,
      routeType: "WORKSPACE_RECORD",
      moduleKey: record.moduleKey,
      moduleHome,
      parentRoute: record.parentRoute,
      supportsCompanyContext: true,
      supportsGroupContext: false,
      preserveQueryKeys: PORTABLE_WORKSPACE_QUERY_KEYS,
      workspaceBoundQueryKeys: WORKSPACE_BOUND_QUERY_KEYS,
      recordValidatorKey: record.validator,
      recordId: segments[record.idIndex],
      requiredPermission: permissionForPath(record.moduleKey, record.parentRoute),
    };
  }

  return {
    pattern: pathname === moduleHome ? moduleHome : `${moduleHome}/*`,
    routeType: "WORKSPACE_COLLECTION",
    moduleKey,
    moduleHome,
    supportsCompanyContext: true,
    supportsGroupContext: true,
    preserveQueryKeys: PORTABLE_WORKSPACE_QUERY_KEYS,
    workspaceBoundQueryKeys: WORKSPACE_BOUND_QUERY_KEYS,
    requiredPermission: permissionForPath(moduleKey, pathname),
  };
}

export function normalizeWorkspaceSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of WORKSPACE_BOUND_QUERY_KEYS) params.delete(key);
  if (params.has("page")) params.set("page", "1");
  const value = params.toString();
  return value ? `?${value}` : "";
}
