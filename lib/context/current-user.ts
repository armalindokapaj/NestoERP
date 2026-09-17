import { redirect } from "next/navigation";

import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { resolveUserContext } from "./resolve-user-context";
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
      return "/platform-admin";
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
  if (!isModuleEnabled(context, moduleKey)) redirect("/module-unavailable");
  if (!canAccessModule(context, moduleKey)) redirect("/access-denied");
  return context;
}
