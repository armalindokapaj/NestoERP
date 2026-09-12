import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { amendmentSignedSchema } from "@/lib/modules/contracts/amendments/amendment.schema";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ amendmentId: string }> };

/** SENT → SIGNED, with the date it was signed (PRD #18 §173). */
export async function POST(request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { amendmentId } = await params;
    const input = amendmentSignedSchema.parse(await readJson(request));
    await amendments.markAmendmentSigned(context, amendmentId, input);
    return apiOk({ data: { ok: true } });
  });
}
