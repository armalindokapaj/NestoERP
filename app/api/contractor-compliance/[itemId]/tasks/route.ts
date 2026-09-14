import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createTaskFromRecord } from "@/lib/modules/engineering/engineering.links";
import { createTaskFromRecordSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ itemId: string }> };

/** POST — raise a task from a compliance item, through the task service (PRD #46 §133, §134). */
export async function POST(request: Request, { params }: Params) {
  const { itemId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createTaskFromRecordSchema.parse(await readJson(request));
    return apiOk({ data: await createTaskFromRecord(context, "contractor_compliance", itemId, input) }, { status: 201 });
  });
}
