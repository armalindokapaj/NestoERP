import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createSite, listSites } from "@/lib/modules/project-structure/structure.sites";
import { createSiteSchema } from "@/lib/modules/workforce/workforce.schema";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET  /api/projects/:projectId/sites — the project's sites (E-04 §38).
 * POST /api/projects/:projectId/sites — add one (`project.structure.manage`).
 *
 * A project out of the reader's scope answers 404.
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await listSites(context, projectId) }));
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = createSiteSchema.parse(await readJson(request));
    return apiOk({ data: await createSite(context, projectId, input) }, { status: 201 });
  });
}
