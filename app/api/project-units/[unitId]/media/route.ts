import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addUnitMedia, listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import { addMediaSchema } from "@/lib/modules/project-structure/unit-publishing.schema";

type Params = { params: Promise<{ unitId: string }> };

/** GET — the unit's images in order, the primary one marked (E-05D §40-§43, §64). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: (await listUnitFiles(context, unitId)).media }));
}

/** POST — add a canonical image of the unit or its project; the first becomes primary (E-05D §42, §64). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = addMediaSchema.parse(await readJson(request));
    return apiOk({ data: await addUnitMedia(context, unitId, input) }, { status: 201 });
  });
}
