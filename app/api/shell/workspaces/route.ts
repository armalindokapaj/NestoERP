import { apiError, apiOk, withContext } from "@/lib/api/respond";
import { resolveShellCore } from "@/lib/workspace/shell-core";
import { settleSlot } from "@/lib/workspace/shell-slots";
import { listWorkspaces } from "@/lib/workspace/workspace.service";

/**
 * GET /api/shell/workspaces — the workspace chooser's data again, for its Retry
 * only (NAV-02 API-02, SHELL-02). The shell streams it on first render; this
 * is never fetched on mount, per route or on a timer.
 *
 * It takes no input: the caller's own session decides whose workspaces these
 * are, and a user or company named in the query is ignored (V03). The context
 * key lets the shell discard an answer meant for a context it has left. Group
 * reads are allowed — the chooser is how a person leaves the Group view.
 */
export async function GET() {
  return withContext(
    async (session) => {
      const [core, workspaces] = await Promise.all([resolveShellCore(session), settleSlot("workspaces", () => listWorkspaces(session), "retry")]);
      if (!workspaces.ok) return apiError("INTERNAL_ERROR");
      const response = apiOk({ data: { contextKey: core.contextKey, workspaces: workspaces.data } });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
    { group: "any" },
  );
}
