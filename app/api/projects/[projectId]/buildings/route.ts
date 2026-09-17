import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { createBuildingSchema } from "@/lib/modules/project-structure/structure.schema";
import { getProjectStructure } from "@/lib/modules/project-structure/structure.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's buildings in order, with their floors and counts (E-05B §61). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: (await getProjectStructure(context, projectId)).buildings }));
}

/** POST — add a building at the end of the order (E-05B §35, §61). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createBuildingSchema.parse(await readJson(request));
    return apiOk({ data: await createBuilding(context, projectId, input) }, { status: 201 });
  });
}
