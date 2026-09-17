import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { versionedActionSchema } from "@/lib/modules/project-structure/unit-publishing.schema";
import { restoreUnit } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — bring an archived unit back to what it held before (E-05D §32). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = versionedActionSchema.parse(await readJson(request));
    return apiOk({ data: await restoreUnit(context, unitId, input) });
  });
}
