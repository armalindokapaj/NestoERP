import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { resolveBlocker } from "@/lib/modules/project-planning/planning.blockers";
import { resolveBlockerSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ blockerId: string }> };

/** POST — resolve it, with an optional note (PRD #44 §156, §192). */
export async function POST(request: Request, { params }: Params) {
  const { blockerId } = await params;
  return withContext(async (context) => {
    const input = resolveBlockerSchema.parse(await readJson(request));
    await resolveBlocker(context, blockerId, input);
    return apiOk({ data: { resolved: true } });
  });
}
