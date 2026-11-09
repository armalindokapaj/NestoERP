import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { bulkCreateFloors } from "@/lib/modules/project-structure/structure.floors";
import { bulkFloorsSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ buildingId: string }> };

/**
 * POST — many floors at once (E-05B §37-§39, §45). With `dryRun` it only
 * answers which floors the building already has and what would stop the
 * batch. Otherwise the new floors are created and the existing ones it names
 * renamed or made active again — all or none; floors it leaves out stay as
 * they are, and more than fifty new floors need `confirmLarge`.
 */
export async function POST(request: Request, { params }: Params) {
  const { buildingId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = bulkFloorsSchema.parse(await readJson(request));
    return apiOk({ data: await bulkCreateFloors(context, buildingId, input) }, { status: input.dryRun ? 200 : 201 });
  });
}
