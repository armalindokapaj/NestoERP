import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { issueTransmittalSchema } from "@/lib/modules/engineering/engineering.schema";
import { issueTransmittal } from "@/lib/modules/engineering/engineering.transmittals";

type Params = { params: Promise<{ transmittalId: string }> };

/** POST — issue it: contents and file versions are fixed from here (PRD #46 §123, §228). */
export async function POST(request: Request, { params }: Params) {
  const { transmittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = issueTransmittalSchema.parse(await readJson(request));
    return apiOk({ data: await issueTransmittal(context, transmittalId, input) });
  });
}
