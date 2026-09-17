import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { bulkCreateFloors } from "@/lib/modules/project-structure/structure.floors";
import { bulkFloorsSchema } from "@/lib/modules/project-structure/structure.schema";

type Params = { params: Promise<{ buildingId: string }> };

/**
 * POST — many floors at once (E-05B §37-§39, §45). With `dryRun` it only
 * answers which would clash; otherwise all are created or none, and more than
 * fifty need `confirmLarge`.
 */
export async function POST(request: Request, { params }: Params) {
  const { buildingId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = bulkFloorsSchema.parse(await readJson(request));
    return apiOk({ data: await bulkCreateFloors(context, buildingId, input) }, { status: input.dryRun ? 200 : 201 });
  });
}
