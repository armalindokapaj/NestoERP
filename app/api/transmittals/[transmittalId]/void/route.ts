import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { voidSchema } from "@/lib/modules/engineering/engineering.schema";
import { voidTransmittal } from "@/lib/modules/engineering/engineering.transmittals";

type Params = { params: Promise<{ transmittalId: string }> };

/** POST — void it, with a reason; a correction is a new transmittal (PRD #46 §123, §221). */
export async function POST(request: Request, { params }: Params) {
  const { transmittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = voidSchema.parse(await readJson(request));
    return apiOk({ data: await voidTransmittal(context, transmittalId, input) });
  });
}
