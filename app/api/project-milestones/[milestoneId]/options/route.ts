import { apiOk, withContext } from "@/lib/api/respond";
import { milestoneOptions } from "@/lib/modules/project-planning/planning.links";

type Params = { params: Promise<{ milestoneId: string }> };

/** GET — people, milestones, tasks, meetings and logs this writer could use on the milestone. */
export async function GET(_request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => apiOk({ data: await milestoneOptions(context, milestoneId) }));
}
