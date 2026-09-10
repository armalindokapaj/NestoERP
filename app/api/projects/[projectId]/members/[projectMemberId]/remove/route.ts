import { withContext } from "@/lib/api/respond";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string; projectMemberId: string }> };

/**
 * Removal marks the membership inactive rather than deleting it: project
 * history stays intact (PRD #10 §76).
 */
export async function POST(_request: Request, { params }: Params) {
  const { projectId, projectMemberId } = await params;
  return withContext(async (context) => {
    await projects.removeMember(context, projectId, projectMemberId);
    return new Response(null, { status: 204 });
  });
}
