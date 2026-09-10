import { withContext } from "@/lib/api/respond";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

/** The only route out of ARCHIVED (PRD #10 §62). */
export async function POST(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    await projects.restoreProject(context, projectId);
    return new Response(null, { status: 204 });
  });
}
