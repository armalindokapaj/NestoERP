import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { isGroupRoute, MODULE_GROUP_SUPPORT } from "@/config/workspace";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { REQUEST_PATH_HEADER } from "@/lib/core/security/request-path";
import { resolveUserContext } from "./resolve-user-context";
import { assertTabWorkspace } from "./tab-workspace";
import { assertCompanyWorkspace, resolveWorkspaceContexts } from "./workspace-access";
import type { ContextFailure, UserContext } from "./types";

/**
 * Page-level entry points to the user context (PRD #6 §87).
 *
 * Server components call these; they never build a context of their own.
 */

export async function getUserContext(): Promise<UserContext | null> {
  const result = await resolveUserContext();
  return result.ok ? result.context : null;
}

/** Where each failure sends the person, so the reason is never guessed at. */
function destinationFor(reason: ContextFailure): string {
  switch (reason) {
    case "UNAUTHENTICATED":
      return "/login";
    case "SESSION_EXPIRED":
      return "/login?reason=session-expired";
    case "USER_INACTIVE":
      return "/login?reason=account-unavailable";
    case "NO_MEMBERSHIP":
      return "/workspace-unavailable";
    case "MEMBERSHIP_INACTIVE":
      return "/workspace-unavailable";
    case "COMPANY_UNAVAILABLE":
      return "/workspace-unavailable?reason=company";
    case "CONFIGURATION_ERROR":
      return "/workspace-unavailable?reason=configuration";
    case "PLATFORM_SESSION":
      // The Platform Admin's own area; business pages are not theirs (E-06 §116, §128).
      return "/admin";
    case "GROUP_SESSION":
      return "/group";
    case "DEVICE_REVOKED":
      return "/device-unavailable?reason=revoked";
    case "DEVICE_BLOCKED":
      return "/device-unavailable?reason=blocked";
    case "UPDATE_REQUIRED":
      return "/device-unavailable?reason=update";
  }
}

/** Any private page: returns the context or sends the visitor somewhere honest. */
export async function requireUserContext(): Promise<UserContext> {
  const result = await resolveUserContext();
  if (!result.ok) redirect(destinationFor(result.reason));
  return result.context;
}

/**
 * Route authorisation. Middleware already blocks module routes, but pages call
 * this too so a route added without a middleware rule fails closed rather than
 * open (PRD #5 §96).
 */
export async function requirePermission(permission: Permission): Promise<UserContext> {
  const context = await requireUserContext();
  if (!can(context, permission)) redirect("/access-denied");
  return context;
}

/**
 * Module authorisation. A module the company switched off is *unavailable*, a
 * different answer from *denied* — the person can do nothing about the first
 * and their administrator can about the second (PRD #7 §58, §59).
 */
export async function requireModule(moduleKey: ModuleKey): Promise<UserContext> {
  const context = await requireUserContext();

  // The Group workspace (Workspace Context §25, §29). A module whose records
  // belong to one company is not opened under a group header: the person is
  // asked which company. A module the workspace offers is usable when at least
  // one company they may enter enables it and lets them open it — the page then
  // asks each of those companies for its own answer.
  if (context.workspace.scopeType === "GROUP" && MODULE_GROUP_SUPPORT[moduleKey] !== "AGNOSTIC") {
    // Only the routes that read across companies are answered here. The path is
    // the middleware's, which a client cannot set; where there is none (a call
    // outside a request) the module's own entry is what is being asked for.
    const path = (await requestPath())?.split("?")[0] ?? null;
    const supported = MODULE_GROUP_SUPPORT[moduleKey] === "AGGREGATED" && (path === null || isGroupRoute(moduleKey, path));
    if (!supported) redirect(companyRequiredHref(moduleKey, path));
    if ((await resolveWorkspaceContexts(context, { module: moduleKey })).length === 0) redirect("/module-unavailable");
    return context;
  }

  if (!isModuleEnabled(context, moduleKey)) redirect("/module-unavailable");
  if (!canAccessModule(context, moduleKey)) redirect("/access-denied");
  return context;
}

async function requestPath(): Promise<string | null> {
  try {
    return (await headers()).get(REQUEST_PATH_HEADER);
  } catch {
    // Called outside a request: there is no path to check.
    return null;
  }
}

/** Where the Group workspace sends a route that works inside one company (§29): choose which, then go on. */
export function companyRequiredHref(moduleKey: ModuleKey, path: string | null): string {
  const query = new URLSearchParams({ module: moduleKey });
  if (path) query.set("next", path);
  return `/workspace/company-required?${query.toString()}`;
}

/**
 * The context for something that belongs to one company: a form, a write, a
 * company-only record (Workspace Context §59). In the Group workspace there is
 * no company to write to, so it is refused with "choose a company" rather than
 * answered from whichever company the session happens to be anchored in.
 */
export async function requireCompanyContext(): Promise<UserContext> {
  const context = await requireUserContext();
  assertCompanyWorkspace(context);
  // A write from a tab still showing another workspace is refused, never
  // applied in the session's new one (AUD-03 §7).
  await assertTabWorkspace(context);
  return context;
}
