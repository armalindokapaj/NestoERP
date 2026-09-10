import { apiOk, withContext } from "@/lib/api/respond";
import { paginationSchema } from "@/lib/modules/shared/list-query";
import * as documents from "@/lib/modules/documents/document.service";

type Params = { params: Promise<{ documentId: string }> };

/** History, gated on document.activity.view plus document access (PRD #13 §118). */
export async function GET(request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const { page, limit } = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return apiOk(await documents.listActivity(context, documentId, { page, limit }));
  });
}
