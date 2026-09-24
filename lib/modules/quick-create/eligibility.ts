import { QUICK_CREATE_ACTIONS, type QuickCreateActionDefinition } from "@/config/quick-create";
import type { WorkspaceScopeType } from "@/config/workspace";
import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";

/**
 * Who may create what (Quick Create §7, §88; NAV-01 QC-01).
 *
 *   action visible = workspace supported + module enabled + module access
 *                    + create permission, in at least one candidate company
 *
 * The one predicate behind both the menu (`listAvailableActions`) and the
 * shell's trigger summary, so the button can never promise a menu the server
 * would not draw. Pure: no database, no record context — the shell calls it on
 * contexts it has already resolved.
 */

export function supportedInWorkspace(scopeType: WorkspaceScopeType, action: QuickCreateActionDefinition): boolean {
  return scopeType === "GROUP" ? action.supportsGroupWorkspace : action.supportsCompanyWorkspace;
}

export function mayCreate(context: UserContext, action: QuickCreateActionDefinition): boolean {
  return isModuleEnabled(context, action.moduleKey) && canAccessModule(context, action.moduleKey) && can(context, action.permission);
}

/**
 * The contexts an action may be created in: the company workspace's own, or —
 * in the Group workspace — every company context of the group, so a person who
 * may create only outside their home company still gets the button (QC-01, Q06).
 */
export function quickCreateCandidates(session: UserContext, groupContexts: UserContext[]): UserContext[] {
  return session.workspace.scopeType === "GROUP" ? groupContexts : [session];
}

/** For each candidate company, the action keys the person may create there, in registry order. */
export function eligibleActions(scopeType: WorkspaceScopeType, contexts: UserContext[]): Array<{ companyId: string; membershipId: string; actions: string[] }> {
  return contexts.map((context) => ({
    companyId: context.companyId,
    membershipId: context.membershipId,
    actions: QUICK_CREATE_ACTIONS.filter((action) => supportedInWorkspace(scopeType, action) && mayCreate(context, action)).map((action) => action.key),
  }));
}

export function canOpenQuickCreate(scopeType: WorkspaceScopeType, contexts: UserContext[]): boolean {
  return eligibleActions(scopeType, contexts).some((entry) => entry.actions.length > 0);
}
