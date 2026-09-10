import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateDocumentSchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";

type Params = { params: Promise<{ documentId: string }> };

/**
 * A document whose parent this caller cannot reach answers 404, so the
 * response cannot be used to discover the file exists (PRD #13 §149).
 */
export async function GET(_request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await documents.getDocument(context, documentId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => {
    // Metadata only: the parent context and the stored object are not editable
    // through here (PRD #13 §107, §109).
    const input = updateDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await documents.updateDocument(context, documentId, input) });
  });
}
