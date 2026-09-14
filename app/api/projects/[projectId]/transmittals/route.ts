import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createTransmittalSchema, transmittalListSchema } from "@/lib/modules/engineering/engineering.schema";
import { createTransmittal, listTransmittals } from "@/lib/modules/engineering/engineering.transmittals";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's transmittal register (PRD #46 §124, §221). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const query = transmittalListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listTransmittals(context, { ...query, projectId }) });
  });
}

/** POST — prepare a transmittal (PRD #46 §119, §221). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createTransmittalSchema.parse(await readJson(request));
    return apiOk({ data: await createTransmittal(context, projectId, input) }, { status: 201 });
  });
}
