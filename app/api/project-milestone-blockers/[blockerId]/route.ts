import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateBlocker } from "@/lib/modules/project-planning/planning.blockers";
import { updateBlockerSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ blockerId: string }> };

/** PATCH — an open blocker's title, severity, owner and due date (PRD #44 §192). */
export async function PATCH(request: Request, { params }: Params) {
  const { blockerId } = await params;
  return withContext(async (context) => {
    const input = updateBlockerSchema.parse(await readJson(request));
    await updateBlocker(context, blockerId, input);
    return apiOk({ data: { ok: true } });
  });
}
