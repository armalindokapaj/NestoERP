import { cache } from "react";

import { supportsGroupWorkspace } from "@/config/workspace";
import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { groupMemberContextsOf, loadGroupMemberContexts } from "./build-context";
import { scoped } from "@/lib/core/observability/request-scope";
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

/**
 * Every company of the group the person may enter, as their own context there.
 *
 * One set per request (NAV-02 QUERY-03): Group navigation, the workspace
 * chooser, + Create's summary, the bell and search all read the same contexts.
 * A Group-workspace session already carries them; otherwise they are loaded
 * once per group, person and session, reusing the organization access and
 * modules the session resolver read.
 */
export const resolveGroupContexts = cache(async (session: UserContext): Promise<UserContext[]> => {
  const carried = groupMemberContextsOf(session);
  if (carried) return carried;
  return scoped(`group-contexts:${session.parentGroupId}:${session.userId}:${session.sessionId}`, () =>
    loadGroupMemberContexts({
      userId: session.userId,
      parentGroupId: session.parentGroupId,
      sessionId: session.sessionId,
    }),
  );
});

/**
 * Everything personal and user-global — the bell, favorites, recent work, My
 * Work (Activity Center §31, §78; Fast Re-entry §38): every company of the
 * person's group they may use, as their own context there, whatever the active
 * workspace. Never another group's (Fast Re-entry §191). The session's own
 * company comes first.
 */
export async function resolvePersonalContexts(session: UserContext): Promise<UserContext[]> {
  const contexts = await resolveGroupContexts(session);
  const own = contexts.find((context) => context.companyId === session.companyId);
  if (!own) return contexts.length > 0 ? contexts : [session];
  return [own, ...contexts.filter((context) => context !== own)];
}

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
