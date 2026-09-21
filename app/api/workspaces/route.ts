import { apiOk, withContext } from "@/lib/api/respond";
import { listWorkspaces } from "@/lib/workspace/workspace.service";

/**
 * GET /api/workspaces — the workspaces this person can work in (Workspace
 * Context §77): the parent group, when they have group-level standing, and the
 * companies they may enter. Derived from their own memberships and access;
 * nothing about a company they cannot enter.
 */
export async function GET() {
  return withContext(async (session) => apiOk({ data: await listWorkspaces(session) }), { group: "any" });
}
