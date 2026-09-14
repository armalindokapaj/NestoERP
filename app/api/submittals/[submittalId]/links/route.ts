import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { linkRecord, listLinks } from "@/lib/modules/engineering/engineering.links";
import { linkSchema } from "@/lib/modules/engineering/engineering.schema";

type Params = { params: Promise<{ submittalId: string }> };

/** GET — the records it points at, as far as this reader can follow them (PRD #46 §133-§155). */
export async function GET(_request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await listLinks(context, "technical_submittal", submittalId) });
  });
}

/** POST — link a record on the same project (PRD #46 §135, §138, §305). */
export async function POST(request: Request, { params }: Params) {
  const { submittalId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = linkSchema.parse(await readJson(request));
    return apiOk({ data: await linkRecord(context, "technical_submittal", submittalId, input) }, { status: 201 });
  });
}
