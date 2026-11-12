import { createHash } from "node:crypto";

import { workspaceKey } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { dialActions } from "@/config/create-dial";
import { canOpenQuickCreate, eligibleActions } from "@/lib/modules/quick-create/eligibility";

/**
 * The Quick Create context key (NAV-01 QC-02).
 *
 * An opaque digest of who is signed in and what they may create here: the
 * session, the user, the group, the active workspace, the candidate
 * memberships and each one's eligible actions, in a stable order. The shell
 * and the menu endpoint compute it with this one function, so a menu drawn for
 * another identity, workspace or permission set never matches.
 *
 * It is a UI cache namespace and nothing else — no endpoint accepts it as
 * proof of anything — and it never carries the session id itself.
 */
export function quickCreateContextKey(session: UserContext, candidates: UserContext[]): string {
  const scope = session.workspace.scopeType;
  const signature = {
    v: 1,
    session: session.sessionId,
    user: session.userId,
    group: session.parentGroupId,
    workspace: workspaceKey(session.workspace),
    candidates: eligibleActions(scope, candidates)
      .map((entry) => `${entry.companyId}:${entry.membershipId}:${entry.actions.join(",")}`)
      .sort(),
  };
  return createHash("sha256").update(JSON.stringify(signature)).digest("base64url").slice(0, 32);
}

export type QuickCreateShellDTO = {
  canOpen: boolean;
  /** Opaque UI cache namespace; never an access credential. */
  contextKey: string;
  /**
   * The desktop Create dial's actions, nearest the + first: this person's role's
   * five they may create here (config/create-dial.ts). Drawn at once; launching
   * one asks the server again, as every Quick Create launch does.
   */
  dial: string[];
};

/** The trigger's summary, from contexts the shell already holds — no query of its own (QC-01). */
export function quickCreateShellSummary(session: UserContext, candidates: UserContext[]): QuickCreateShellDTO {
  // In the Group workspace an action counts when any company of the group allows it, as the menu's does.
  const eligible = [...new Set(eligibleActions(session.workspace.scopeType, candidates).flatMap((entry) => entry.actions))];
  return {
    canOpen: canOpenQuickCreate(session.workspace.scopeType, candidates),
    contextKey: quickCreateContextKey(session, candidates),
    dial: dialActions(session.role, eligible),
  };
}
