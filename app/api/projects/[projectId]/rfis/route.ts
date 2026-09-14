import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createRfi, listRfis } from "@/lib/modules/engineering/engineering.rfis";
import { createRfiSchema, rfiListSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's RFI register (PRD #46 §167, §219). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const query = rfiListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listRfis(context, { ...query, projectId }) });
  });
}

/** POST — raise an RFI, as a draft or opened straight away (PRD #46 §83, §219). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createRfiSchema.parse(await readJson(request));
    return apiOk({ data: await createRfi(context, projectId, input) }, { status: 201 });
  });
}
