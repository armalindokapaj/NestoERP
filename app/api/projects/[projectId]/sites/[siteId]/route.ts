import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateSite } from "@/lib/modules/project-structure/structure.sites";
import { updateSiteSchema } from "@/lib/modules/workforce/workforce.schema";

type Params = { params: Promise<{ projectId: string; siteId: string }> };

/** PATCH /api/projects/:projectId/sites/:siteId — rename, re-address, archive or bring back a site (E-04 §38). */
export async function PATCH(request: Request, { params }: Params) {
  const { projectId, siteId } = await params;
  return withContext(async (context) => {
    const input = updateSiteSchema.parse(await readJson(request));
    return apiOk({ data: await updateSite(context, projectId, siteId, input) });
  });
}
