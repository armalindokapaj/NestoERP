import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateProjectMemberSchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string; projectMemberId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { projectId, projectMemberId } = await params;
  return withContext(async (context) => {
    const input = updateProjectMemberSchema.parse(await readJson(request));
    await projects.updateMember(context, projectId, projectMemberId, input);
    return apiOk({ data: await projects.listMembers(context, projectId) });
  });
}

/** DELETE — take a person off the team; the membership is kept as history (PRD #10 §76, E-06 §94). */
export async function DELETE(_request: Request, { params }: Params) {
  const { projectId, projectMemberId } = await params;
  return withContext(async (context) => {
    await projects.removeMember(context, projectId, projectMemberId);
    return apiOk({ data: { ok: true } });
  });
}
