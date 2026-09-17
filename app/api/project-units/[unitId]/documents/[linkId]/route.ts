import { apiOk, withContext } from "@/lib/api/respond";
import { detachUnitDocument } from "@/lib/modules/project-structure/unit-files.service";

type Params = { params: Promise<{ unitId: string; linkId: string }> };

/** DELETE — the unit stops pointing at the document; the document itself stays (E-05D §39). */
export async function DELETE(_request: Request, { params }: Params) {
  const { unitId, linkId } = await params;
  return withContext(async (context) => {
    await detachUnitDocument(context, unitId, linkId);
    return apiOk({ data: { removed: true } });
  });
}
