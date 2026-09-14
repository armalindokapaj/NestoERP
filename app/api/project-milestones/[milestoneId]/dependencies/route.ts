import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addDependency } from "@/lib/modules/project-planning/planning.dependencies";
import { dependencySchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — this milestone waits on another of the same project (PRD #44 §36, §37, §191). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = dependencySchema.parse(await readJson(request));
    return apiOk({ data: await addDependency(context, milestoneId, input) }, { status: 201 });
  });
}
