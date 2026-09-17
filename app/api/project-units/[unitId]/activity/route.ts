import { apiOk, withContext } from "@/lib/api/respond";
import { listUnitActivity } from "@/lib/modules/project-structure/structure.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — what happened to the unit, newest first (E-05D §48). */
export async function GET(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const page = Math.max(1, Number(new URL(request.url).searchParams.get("page")) || 1);
    return apiOk({ data: await listUnitActivity(context, unitId, { page }) });
  });
}
