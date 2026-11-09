import { apiOk, withContext } from "@/lib/api/respond";
import { parseUnitListQuery } from "@/lib/modules/project-structure/structure.schema";
import { listProjectUnits, listProjectUnitSelection } from "@/lib/modules/project-structure/structure.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET — a page of the project's units (E-05B §47-§50, §66, §109):
 * `q`, `buildingId`, `floorId`, `unitTypeId`, `orientation`, `bedrooms`,
 * `bathrooms`, area and price ranges, `publicationStatus`, `sort`, `page`,
 * `limit` (50, at most 100). With `select=all`, every unit the same filters
 * match instead of a page — their ids and versions, at most 500 — for "Select
 * all N matching", "Select this floor" and Fill in, which adds `missing`
 * (2026-11-09).
 */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  const search = new URL(request.url).searchParams;
  return withContext(async (context) => {
    const query = parseUnitListQuery(search);
    return apiOk({ data: search.get("select") === "all" ? await listProjectUnitSelection(context, projectId, query) : await listProjectUnits(context, projectId, query) });
  });
}
