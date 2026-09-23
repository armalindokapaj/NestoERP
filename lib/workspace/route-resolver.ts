import { modules, type ModuleKey } from "@/config/modules";
import {
  normalizeWorkspaceSearch,
  workspaceRoutePolicy,
  type WorkspaceRecordValidatorKey,
  type WorkspaceRoutePolicy,
} from "@/config/workspace-routes";
import { isGroupRoute } from "@/config/workspace";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere, buildTaskScopeWhere } from "@/lib/access/scope";
import { resolveGroupContexts } from "@/lib/context/workspace-access";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { buildContractScopeWhere } from "@/lib/modules/contracts/contract.scope";
import { buildDocumentAccessWhere } from "@/lib/modules/documents/document.parent-access";
import {
  buildBudgetScopeWhere,
  buildCommitmentScopeWhere,
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
} from "@/lib/modules/finance/finance.scope";
import {
  buildOrderScopeWhere,
  buildRequestScopeWhere,
  buildRfqScopeWhere,
} from "@/lib/modules/procurement/procurement.scope";
import {
  buildLeadScopeWhere,
  buildOpportunityScopeWhere,
  buildProposalScopeWhere,
} from "@/lib/modules/sales/sales.scope";

export const WORKSPACE_NAVIGATION_RESOLUTIONS = ["KEEP_EXACT", "KEEP_PARENT", "MODULE_HOME", "DASHBOARD"] as const;
export type WorkspaceNavigationResolution = (typeof WORKSPACE_NAVIGATION_RESOLUTIONS)[number];

export const WORKSPACE_NAVIGATION_REASONS = [
  "VALID",
  "RECORD_NOT_AVAILABLE",
  "MODULE_DISABLED",
  "MODULE_FORBIDDEN",
  "GROUP_SCOPE_UNSUPPORTED",
  "COMPANY_SCOPE_UNSUPPORTED",
  "MUTATION_ROUTE_UNSUPPORTED",
] as const;
export type WorkspaceNavigationReason = (typeof WORKSPACE_NAVIGATION_REASONS)[number];

export type WorkspaceNavigationResult = {
  resolution: WorkspaceNavigationResolution;
  destinationPath: string;
  destinationSearchParams: string;
  destination: string;
  reason: WorkspaceNavigationReason;
  routePolicy: Pick<WorkspaceRoutePolicy, "routeType" | "moduleKey" | "pattern">;
};

type ModuleCapability = { enabled: boolean; canAccess: boolean };

async function moduleCapability(context: UserContext, moduleKey: ModuleKey, permission?: Parameters<typeof can>[1]): Promise<ModuleCapability> {
  if (context.workspace.scopeType === "COMPANY") {
    return { enabled: isModuleEnabled(context, moduleKey), canAccess: canAccessModule(context, moduleKey) && (!permission || can(context, permission)) };
  }
  const contexts = await resolveGroupContexts(context);
  return {
    enabled: contexts.some((candidate) => isModuleEnabled(candidate, moduleKey)),
    canAccess: contexts.some((candidate) => isModuleEnabled(candidate, moduleKey) && canAccessModule(candidate, moduleKey) && (!permission || can(candidate, permission))),
  };
}

async function recordIsAvailable(context: UserContext, validator: WorkspaceRecordValidatorKey, id: string): Promise<boolean> {
  if (context.workspace.scopeType !== "COMPANY") return false;
  switch (validator) {
    case "PROJECT":
      return Boolean(await prisma.project.findFirst({ where: { AND: [buildProjectScopeWhere(context), { id }] }, select: { id: true } }));
    case "TASK":
      return Boolean(await prisma.task.findFirst({ where: { AND: [buildTaskScopeWhere(context), { id }] }, select: { id: true } }));
    case "DOCUMENT":
      return Boolean(await prisma.document.findFirst({ where: { AND: [await buildDocumentAccessWhere(context), { id }] }, select: { id: true } }));
    case "INVOICE":
      return Boolean(await prisma.invoice.findFirst({ where: { AND: [buildInvoiceScopeWhere(context), { id }] }, select: { id: true } }));
    case "EXPENSE":
      return Boolean(await prisma.expense.findFirst({ where: { AND: [buildExpenseScopeWhere(context), { id }] }, select: { id: true } }));
    case "BUDGET":
      return Boolean(await prisma.projectBudget.findFirst({ where: { AND: [buildBudgetScopeWhere(context), { id }] }, select: { id: true } }));
    case "COMMITMENT":
      return Boolean(await prisma.commitment.findFirst({ where: { AND: [buildCommitmentScopeWhere(context), { id }] }, select: { id: true } }));
    case "PURCHASE_ORDER":
      return Boolean(await prisma.purchaseOrder.findFirst({ where: { AND: [buildOrderScopeWhere(context), { id }] }, select: { id: true } }));
    case "PURCHASE_REQUEST":
      return Boolean(await prisma.purchaseRequest.findFirst({ where: { AND: [buildRequestScopeWhere(context), { id }] }, select: { id: true } }));
    case "RFQ":
      return Boolean(await prisma.rFQ.findFirst({ where: { AND: [buildRfqScopeWhere(context), { id }] }, select: { id: true } }));
    case "CLIENT":
      return Boolean(await prisma.client.findFirst({ where: { AND: [buildClientScopeWhere(context), { id }] }, select: { id: true } }));
    case "LEAD":
      return Boolean(await prisma.lead.findFirst({ where: { AND: [buildLeadScopeWhere(context), { id }] }, select: { id: true } }));
    case "OPPORTUNITY":
      return Boolean(await prisma.opportunity.findFirst({ where: { AND: [buildOpportunityScopeWhere(context), { id }] }, select: { id: true } }));
    case "PROPOSAL":
      return Boolean(await prisma.proposal.findFirst({ where: { AND: [buildProposalScopeWhere(context), { id }] }, select: { id: true } }));
    case "CONTRACT":
      return Boolean(await prisma.contract.findFirst({ where: { AND: [buildContractScopeWhere(context), { id }] }, select: { id: true } }));
  }
}

function result(
  policy: WorkspaceRoutePolicy,
  resolution: WorkspaceNavigationResolution,
  destinationPath: string,
  search: string,
  reason: WorkspaceNavigationReason,
): WorkspaceNavigationResult {
  return {
    resolution,
    destinationPath,
    destinationSearchParams: search,
    destination: `${destinationPath}${search}`,
    reason,
    routePolicy: { routeType: policy.routeType, moduleKey: policy.moduleKey, pattern: policy.pattern },
  };
}

function groupFallback(policy: WorkspaceRoutePolicy, search: string, reason: WorkspaceNavigationReason): WorkspaceNavigationResult {
  if (policy.moduleKey && policy.parentRoute && isGroupRoute(policy.moduleKey, policy.parentRoute)) {
    return result(policy, "KEEP_PARENT", policy.parentRoute, search, reason);
  }
  if (policy.moduleKey && policy.moduleHome && isGroupRoute(policy.moduleKey, policy.moduleHome)) {
    return result(policy, "MODULE_HOME", policy.moduleHome, search, reason);
  }
  return result(policy, "DASHBOARD", "/dashboard", "", reason);
}

/** Resolves the deepest safe destination after the server has validated and committed a workspace. */
export async function resolveWorkspaceRoute(input: {
  context: UserContext;
  currentPathname: string;
  currentSearch?: string;
}): Promise<WorkspaceNavigationResult> {
  const pathname = input.currentPathname.startsWith("/") ? input.currentPathname.split("?")[0] : "/dashboard";
  const search = normalizeWorkspaceSearch(input.currentSearch ?? "");
  const policy = workspaceRoutePolicy(pathname);

  if (policy.routeType === "GLOBAL" || policy.routeType === "PLATFORM_ONLY") {
    return result(policy, "KEEP_EXACT", pathname, search, "VALID");
  }

  const moduleKey = policy.moduleKey;
  if (!moduleKey) return result(policy, "DASHBOARD", "/dashboard", "", "MODULE_FORBIDDEN");
  const capability = await moduleCapability(input.context, moduleKey, policy.requiredPermission);
  if (!capability.enabled) return result(policy, "DASHBOARD", "/dashboard", "", "MODULE_DISABLED");
  if (!capability.canAccess) return result(policy, "DASHBOARD", "/dashboard", "", "MODULE_FORBIDDEN");

  if (input.context.workspace.scopeType === "GROUP") {
    if (policy.routeType === "WORKSPACE_MUTATION") return groupFallback(policy, search, "MUTATION_ROUTE_UNSUPPORTED");
    if (!isGroupRoute(moduleKey, pathname)) return groupFallback(policy, search, "GROUP_SCOPE_UNSUPPORTED");
    return result(policy, "KEEP_EXACT", pathname, search, "VALID");
  }

  if (policy.supportsCompanyContext === false) {
    return result(policy, "DASHBOARD", "/dashboard", "", "COMPANY_SCOPE_UNSUPPORTED");
  }
  if (policy.routeType === "WORKSPACE_MUTATION") {
    const writePermission = modules[moduleKey].writePermission;
    if (writePermission && !can(input.context, writePermission)) {
      return result(policy, "KEEP_PARENT", policy.parentRoute ?? policy.moduleHome ?? "/dashboard", search, "MUTATION_ROUTE_UNSUPPORTED");
    }
  }
  if (policy.routeType === "WORKSPACE_RECORD" && policy.recordValidatorKey && policy.recordId) {
    const started = performance.now();
    const valid = await recordIsAvailable(input.context, policy.recordValidatorKey, policy.recordId).catch(() => false);
    incrementCounter(
      Metric.WORKSPACE_SWITCH_RECORD_VALIDATION_MS,
      { validator: policy.recordValidatorKey },
      Math.max(0, performance.now() - started),
    );
    if (!valid) return result(policy, "KEEP_PARENT", policy.parentRoute ?? policy.moduleHome ?? "/dashboard", search, "RECORD_NOT_AVAILABLE");
  }
  return result(policy, "KEEP_EXACT", pathname, search, "VALID");
}
