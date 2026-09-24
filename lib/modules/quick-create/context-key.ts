import { createHash } from "node:crypto";

import { workspaceKey } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
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
};

/** The trigger's summary, from contexts the shell already holds — no query of its own (QC-01). */
export function quickCreateShellSummary(session: UserContext, candidates: UserContext[]): QuickCreateShellDTO {
  return {
    canOpen: canOpenQuickCreate(session.workspace.scopeType, candidates),
    contextKey: quickCreateContextKey(session, candidates),
  };
}
