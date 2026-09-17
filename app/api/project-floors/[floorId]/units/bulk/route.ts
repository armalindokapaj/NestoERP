import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { bulkUnitsSchema } from "@/lib/modules/project-structure/structure.schema";
import { bulkCreateUnits } from "@/lib/modules/project-structure/structure.units";

type Params = { params: Promise<{ floorId: string }> };

/**
 * POST — many units with shared defaults (E-05B §41-§45). With `dryRun` it
 * lists the codes that clash; otherwise the whole batch is created or none of it.
 */
export async function POST(request: Request, { params }: Params) {
  const { floorId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = bulkUnitsSchema.parse(await readJson(request));
    return apiOk({ data: await bulkCreateUnits(context, floorId, input) }, { status: input.dryRun ? 200 : 201 });
  });
}
