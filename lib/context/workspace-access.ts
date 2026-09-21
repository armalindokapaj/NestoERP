import { cache } from "react";

import { supportsGroupWorkspace } from "@/config/workspace";
import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { groupMemberContextsOf, loadGroupMemberContexts } from "./build-context";
import type { UserContext } from "./types";

/**
 * What the active workspace lets a request read (Workspace Context §57-§60).
 *
 * The session is one operational context. In the Group workspace a page needs
 * more than that: the same person, in each company they may use a module in,
 * asked with that company's own rules. This is the one place that answers
 * "which companies?" — never a list a browser sent (§14, §57):
 *
 *   allowedCompanyIds = resolveAllowedCompanies(user, module, action)     (§58)
 *   assertCompanyAccess(user, activeCompanyId, module, action)            (§59)
 *
 * Each context returned is the person's real context in that company
 * (`assembleContext`), so a group list is the union of exactly the answers the
 * company pages give — the company boundary is never taken off a query. A
 * module they hold in Company A and B but not C aggregates A and B and never C
 * (§60, §92); Group never upgrades a company permission (§62).
 */

export type WorkspaceAccessRequest = {
  module?: ModuleKey;
  /** The action, as a permission: a company where it is not held is left out. */
  permission?: Permission;
};

/** Every company of the group the person may enter, as their own context there. */
export const resolveGroupContexts = cache(async (session: UserContext): Promise<UserContext[]> => {
  return (
    groupMemberContextsOf(session) ??
    (await loadGroupMemberContexts({
      userId: session.userId,
      parentGroupId: session.parentGroupId,
      sessionId: session.sessionId,
    }))
  );
});

function satisfies(context: UserContext, request: WorkspaceAccessRequest): boolean {
  if (request.module && !(isModuleEnabled(context, request.module) && canAccessModule(context, request.module))) return false;
  if (request.permission && !can(context, request.permission)) return false;
  return true;
}

/**
 * The contexts the active workspace reads, for one module and action.
 *
 * Company workspace: the session's own, if it holds them. Group workspace: one
 * per authorised company, and only a module the Group workspace offers
 * (a company-only module reads nothing here, whoever asks).
 */
export async function resolveWorkspaceContexts(
  session: UserContext,
  request: WorkspaceAccessRequest = {},
): Promise<UserContext[]> {
  if (session.workspace.scopeType === "COMPANY") return satisfies(session, request) ? [session] : [];
  if (request.module && !supportsGroupWorkspace(request.module)) return [];
  return (await resolveGroupContexts(session)).filter((context) => satisfies(context, request));
}

/** §58 — the ids behind `WHERE companyId IN (...)`, derived, never accepted. */
export async function resolveAllowedCompanies(session: UserContext, request: WorkspaceAccessRequest = {}): Promise<string[]> {
  return (await resolveWorkspaceContexts(session, request)).map((context) => context.companyId);
}

/**
 * §59 — a write, a form or a company-only record belongs to exactly one
 * company, and the Group workspace has none, so it is refused there. The answer
 * is 409: nothing is wrong with the person or the request, only with where it
 * was made, and choosing a company is the fix.
 */
export function assertCompanyWorkspace(session: UserContext): void {
  if (session.workspace.scopeType !== "COMPANY") {
    throw new AccessError(
      "WORKSPACE_COMPANY_REQUIRED",
      undefined,
      undefined,
      "SCOPE_DENIED",
    );
  }
}
