import { apiOk, withContext } from "@/lib/api/respond";
import { unlinkRecord } from "@/lib/modules/engineering/engineering.links";

type Params = { params: Promise<{ documentId: string; linkId: string }> };

/** DELETE — remove a link; the other record is untouched (PRD #46 §136). */
export async function DELETE(_request: Request, { params }: Params) {
  const { documentId, linkId } = await params;
  return withContext(async (context) => {
    await unlinkRecord(context, "engineering_document", documentId, linkId);
    return apiOk({ data: { removed: true } });
  });
}
