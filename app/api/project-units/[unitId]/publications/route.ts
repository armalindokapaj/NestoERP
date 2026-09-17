import { apiOk, withContext } from "@/lib/api/respond";
import { listUnitPublications } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — every published version of the unit, newest first (E-05D §50, §69). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await listUnitPublications(context, unitId) }));
}
