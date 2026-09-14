import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { updateTransmittalSchema } from "@/lib/modules/engineering/engineering.schema";
import { getTransmittal, updateTransmittal } from "@/lib/modules/engineering/engineering.transmittals";

type Params = { params: Promise<{ transmittalId: string }> };

/** GET — one transmittal with the documents and versions it carried (PRD #46 §221). */
export async function GET(_request: Request, { params }: Params) {
  const { transmittalId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await getTransmittal(context, transmittalId) });
  });
}

/** PATCH — change a draft; an issued transmittal never changes (PRD #46 §123). */
export async function PATCH(request: Request, { params }: Params) {
  const { transmittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateTransmittalSchema.parse(await readJson(request));
    return apiOk({ data: await updateTransmittal(context, transmittalId, input) });
  });
}
