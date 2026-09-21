import { apiOk, withContext } from "@/lib/api/respond";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { openPortfolioProject } from "@/lib/modules/projects/project.portfolio";

type Params = { params: Promise<{ projectId: string }> };

/**
 * POST /api/projects/:projectId/open — make the project's company the session's
 * company (E-05A §26, §34).
 *
 * A POST, never a side effect of rendering a page: a link prefetch or a crawler
 * following a URL must not move somebody's session between companies. An
 * unauthorised project answers 404 and moves nothing.
 */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  // `group: "any"`: this is how a project in the Group workspace is entered — the
  // move into its company (Workspace Context §31). The project is authorised
  // through the person's own membership in its company, whatever the workspace.
  return withContext(
    async (session) => {
      const result = await openPortfolioProject(session, projectId, {
        ipAddress: clientAddress(request.headers),
        userAgent: userAgentOf(request.headers),
      });
      return apiOk({ data: result });
    },
    { group: "any" },
  );
}
