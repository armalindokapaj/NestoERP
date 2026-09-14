import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createBlocker } from "@/lib/modules/project-planning/planning.blockers";
import { createBlockerSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — record a blocker, optionally raising a task for it (PRD #44 §154, §155, §192). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = createBlockerSchema.parse(await readJson(request));
    return apiOk({ data: await createBlocker(context, milestoneId, input) }, { status: 201 });
  });
}
