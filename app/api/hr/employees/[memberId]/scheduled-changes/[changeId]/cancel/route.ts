import { readJson, withContext } from "@/lib/api/respond";
import { cancelScheduledChange } from "@/lib/modules/hr/employment/employment.change.service";
import { cancelScheduledChangeSchema } from "@/lib/modules/hr/employment/employment.schema";

type Params = { params: Promise<{ memberId: string; changeId: string }> };

/** POST — cancels a scheduled change before it applies; after, history is corrected instead (E-03 §77, §157). */
export async function POST(request: Request, { params }: Params) {
  const { memberId, changeId } = await params;
  return withContext(async (context) => {
    // A reason is optional, and so is a body.
    const input = cancelScheduledChangeSchema.parse(await readJson(request).catch(() => ({})));
    await cancelScheduledChange(context, memberId, changeId, input.reason);
    return new Response(null, { status: 204 });
  });
}
