import { apiOk, withContext } from "@/lib/api/respond";
import { unlinkRecord } from "@/lib/modules/engineering/engineering.links";

type Params = { params: Promise<{ submittalId: string; linkId: string }> };

/** DELETE — remove a link; the other record is untouched (PRD #46 §136). */
export async function DELETE(_request: Request, { params }: Params) {
  const { submittalId, linkId } = await params;
  return withContext(async (context) => {
    await unlinkRecord(context, "technical_submittal", submittalId, linkId);
    return apiOk({ data: { removed: true } });
  });
}
