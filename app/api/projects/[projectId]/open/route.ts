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
  return withContext(async (session) => {
    const result = await openPortfolioProject(session, projectId, {
      ipAddress: clientAddress(request.headers),
      userAgent: userAgentOf(request.headers),
    });
    return apiOk({ data: result });
  });
}
