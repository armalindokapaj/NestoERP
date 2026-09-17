import { apiOk, withContext } from "@/lib/api/respond";
import { getUnitPublication } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string; publicationId: string }> };

/** GET — one published version as it was approved: snapshot, Sales Plan version, primary image (E-05D §51, §70). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId, publicationId } = await params;
  return withContext(async (context) => apiOk({ data: await getUnitPublication(context, unitId, publicationId) }));
}
