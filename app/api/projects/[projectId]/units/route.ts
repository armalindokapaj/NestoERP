import { apiOk, withContext } from "@/lib/api/respond";
import { parseUnitListQuery } from "@/lib/modules/project-structure/structure.schema";
import { listProjectUnits } from "@/lib/modules/project-structure/structure.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET — a page of the project's units (E-05B §47-§50, §66, §109):
 * `q`, `buildingId`, `floorId`, `unitTypeId`, `orientation`, `position`,
 * `bedrooms`, `bathrooms`, area ranges, `sort`, `page`, `limit` (50, at most 100).
 */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await listProjectUnits(context, projectId, parseUnitListQuery(new URL(request.url).searchParams)) }));
}
