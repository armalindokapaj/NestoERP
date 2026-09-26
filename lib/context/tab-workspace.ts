import { headers } from "next/headers";

import { workspaceKey } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { STALE_WORKSPACE_DIGEST, TAB_WORKSPACE_HEADER } from "@/lib/unsaved/outcome";

export { TAB_WORKSPACE_HEADER };

/**
 * The stale-context guard (AUD-03 §7).
 *
 * A tab renders one workspace. When another tab switches the session to
 * another company, this tab's forms still carry the first company's draft —
 * and a save from it would be executed under the session's *new* workspace,
 * interpreting one company's ids in another company's context. So the browser
 * sends, with every state-changing request, the workspace the tab rendered
 * (`x-nesto-workspace`, added by the unsaved-work host), and the server
 * refuses the request when that is no longer the session's workspace.
 *
 * The header is a claim the server checks against itself, never a credential:
 * it can only make a request fail. A request without it — an API client, a
 * test — is judged exactly as before.
 */
/**
 * Thrown by `requireCompanyContext` in a server action. Its digest survives
 * Next's production error sanitising, so the form can tell this definite
 * refusal from a request whose outcome is unknown.
 */
export class StaleWorkspaceError extends Error {
  readonly digest = STALE_WORKSPACE_DIGEST;

  constructor() {
    super("Your workspace changed in another tab, so nothing was saved.");
    this.name = "StaleWorkspaceError";
  }
}

/** The workspace the requesting tab says it rendered, or null when it did not say. */
export async function submittedWorkspace(): Promise<string | null> {
  try {
    return (await headers()).get(TAB_WORKSPACE_HEADER);
  } catch {
    // Called outside a request: nothing was submitted.
    return null;
  }
}

export function isStaleWorkspace(context: UserContext, submitted: string | null): boolean {
  return Boolean(submitted) && submitted !== workspaceKey(context.workspace);
}

export async function assertTabWorkspace(context: UserContext): Promise<void> {
  if (isStaleWorkspace(context, await submittedWorkspace())) throw new StaleWorkspaceError();
}
