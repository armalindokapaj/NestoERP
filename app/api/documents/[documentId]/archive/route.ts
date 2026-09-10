import { withContext } from "@/lib/api/respond";
import * as documents from "@/lib/modules/documents/document.service";

type Params = { params: Promise<{ documentId: string }> };

/** Archiving keeps the stored object; it is a lifecycle state (PRD #13 §112). */
export async function POST(_request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => {
    await documents.archiveDocument(context, documentId);
    return new Response(null, { status: 204 });
  });
}
