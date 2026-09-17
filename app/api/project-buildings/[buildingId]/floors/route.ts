import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createFloor, listBuildingFloors } from "@/lib/modules/project-structure/structure.floors";
import { createFloorSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ buildingId: string }> };

/** GET — the building's floors in order, with their unit counts (E-05B §62, §89). */
export async function GET(_request: Request, { params }: Params) {
  const { buildingId } = await params;
  return withContext(async (context) => apiOk({ data: await listBuildingFloors(context, buildingId) }));
}

/** POST — add one floor; it takes its place in the default order (E-05B §15, §36). */
export async function POST(request: Request, { params }: Params) {
  const { buildingId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createFloorSchema.parse(await readJson(request));
    return apiOk({ data: await createFloor(context, buildingId, input) }, { status: 201 });
  });
}
