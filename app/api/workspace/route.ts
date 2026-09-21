import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { switchWorkspace, switchWorkspaceSchema } from "@/lib/workspace/workspace.service";

/**
 * POST /api/workspace — work in the parent group, or in one company (Workspace
 * Context §78, §80).
 *
 * A POST for the same reason opening a project is one: a prefetch or a crawler
 * must never move somebody's session. The server validates the request against
 * the person's own memberships and standing (§14) and stores the result on the
 * session (§15); a workspace they may not enter answers 403 and keeps the one
 * they are in (§81, §89). Nothing about who they are changes (§11).
 */
export async function POST(request: Request) {
  return withContext(
    async (session) => {
      const body = switchWorkspaceSchema.parse(await readJson(request));
      const result = await switchWorkspace(session, body, {
        ipAddress: clientAddress(request.headers),
        userAgent: userAgentOf(request.headers),
      });
      return apiOk({ data: result });
    },
    { group: "any" },
  );
}
