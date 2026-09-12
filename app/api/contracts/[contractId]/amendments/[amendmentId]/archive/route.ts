import { apiOk, withContext } from "@/lib/api/respond";
import * as amendments from "@/lib/modules/contracts/amendments/amendment.service";

type Params = { params: Promise<{ amendmentId: string }> };

/** Hides a draft, rejected or cancelled amendment (PRD #18 §180). */
export async function POST(_request: Request, { params }: Params) {
  return withContext(async (context) => {
    const { amendmentId } = await params;
    await amendments.archiveAmendment(context, amendmentId);
    return apiOk({ data: { ok: true } });
  });
}
