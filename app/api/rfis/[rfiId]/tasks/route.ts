import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createTaskFromRecord } from "@/lib/modules/engineering/engineering.links";
import { createTaskFromRecordSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ rfiId: string }> };

/** POST — raise a follow-up task through the task service (PRD #46 §93). */
export async function POST(request: Request, { params }: Params) {
  const { rfiId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createTaskFromRecordSchema.parse(await readJson(request));
    return apiOk({ data: await createTaskFromRecord(context, "rfi", rfiId, input) }, { status: 201 });
  });
}
