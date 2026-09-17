import { apiOk, withContext } from "@/lib/api/respond";
import { getUnitPublishing } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — the unit's publishing state: status, current version, readiness, the open request, what the reader may do (E-05D §45, §47, §60). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await getUnitPublishing(context, unitId) }));
}
