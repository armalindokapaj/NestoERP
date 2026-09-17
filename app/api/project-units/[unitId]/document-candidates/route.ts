import { apiOk, withContext } from "@/lib/api/respond";
import { listAttachableDocuments } from "@/lib/modules/project-structure/unit-files.service";
import { candidatesQuerySchema } from "@/lib/modules/project-structure/unit-publishing.schema";

type Params = { params: Promise<{ unitId: string }> };

/** GET — documents or images the reader may attach: filed on this unit or its project (E-05D §63). */
export async function GET(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const url = new URL(request.url);
    const query = candidatesQuerySchema.parse({ q: url.searchParams.get("q") ?? undefined, kind: url.searchParams.get("kind") ?? undefined });
    return apiOk({ data: await listAttachableDocuments(context, unitId, query) });
  });
}
