import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import { createUnit } from "@/lib/modules/project-structure/structure.units";

type Params = { params: Promise<{ floorId: string }> };

/** POST — add a unit to this floor; the floor is the context, never re-chosen (E-05B §40, §63). */
export async function POST(request: Request, { params }: Params) {
  const { floorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createUnitSchema.parse(await readJson(request));
    return apiOk({ data: await createUnit(context, floorId, input) }, { status: 201 });
  });
}
