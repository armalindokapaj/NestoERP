import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { attachUnitDocument, listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import { attachDocumentSchema } from "@/lib/modules/project-structure/unit-publishing.schema";

type Params = { params: Promise<{ unitId: string }> };

/** GET — the unit's Sales Plan, attached documents and images, as far as the reader may open them (E-05D §63, §88). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await listUnitFiles(context, unitId) }));
}

/** POST — attach a canonical document of the unit or its project; the file is never copied (E-05D §37-§39, §63). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = attachDocumentSchema.parse(await readJson(request));
    return apiOk({ data: await attachUnitDocument(context, unitId, input) }, { status: 201 });
  });
}
