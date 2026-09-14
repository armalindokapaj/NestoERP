import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createTaskFromRecord } from "@/lib/modules/engineering/engineering.links";
import { createTaskFromRecordSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ submittalId: string }> };

/** POST — raise a task through the task service (PRD #46 §93, §133, §134). */
export async function POST(request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createTaskFromRecordSchema.parse(await readJson(request));
    return apiOk({ data: await createTaskFromRecord(context, "technical_submittal", submittalId, input) }, { status: 201 });
  });
}
