import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reorderPhases } from "@/lib/modules/project-planning/planning.phases";
import { reorderSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ projectId: string }> };

/** POST — the phases' new order, all of them at once (PRD #44 §26, §187). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = reorderSchema.parse(await readJson(request));
    await reorderPhases(context, projectId, input.ids);
    return apiOk({ data: { ok: true } });
  });
}
