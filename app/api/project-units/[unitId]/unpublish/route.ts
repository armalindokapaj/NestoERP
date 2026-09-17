import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { unpublishSchema } from "@/lib/modules/project-structure/unit-publishing.schema";
import { unpublishUnit } from "@/lib/modules/project-structure/unit-publishing.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — take a published unit back to Ready for Publishing, with a reason; its history stays (E-05D §31, §68). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = unpublishSchema.parse(await readJson(request));
    return apiOk({ data: await unpublishUnit(context, unitId, input) });
  });
}
