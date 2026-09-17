import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { copyUnitsSchema } from "@/lib/modules/project-structure/structure.schema";
import { copyUnits } from "@/lib/modules/project-structure/structure.units";

type Params = { params: Promise<{ floorId: string }> };

/** POST — new units on this floor copied from another floor's, under the codes confirmed (E-05B §98). */
export async function POST(request: Request, { params }: Params) {
  const { floorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = copyUnitsSchema.parse(await readJson(request));
    return apiOk({ data: await copyUnits(context, floorId, input) }, { status: input.dryRun ? 200 : 201 });
  });
}
