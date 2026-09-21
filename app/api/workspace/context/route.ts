import { apiOk, withContext } from "@/lib/api/respond";
import { getWorkspaceContext } from "@/lib/workspace/workspace.service";

/**
 * GET /api/workspace/context — the effective context of the active workspace
 * (Workspace Context §79): which group and company, the companies and modules it
 * reaches, and the roles the person holds there.
 */
export async function GET() {
  return withContext(async (session) => apiOk({ data: await getWorkspaceContext(session) }), { group: "any" });
}
