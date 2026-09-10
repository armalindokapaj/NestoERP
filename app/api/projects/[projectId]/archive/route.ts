import { withContext } from "@/lib/api/respond";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

/** Archive is its own endpoint: it is not a status a PATCH may set. */
export async function POST(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    await projects.archiveProject(context, projectId);
    return new Response(null, { status: 204 });
  });
}
