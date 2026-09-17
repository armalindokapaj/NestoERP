import { can } from "@/lib/access/can";
import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { addProjectMemberSchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await projects.listMembers(context, projectId) }),
  );
}

export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = addProjectMemberSchema.parse(await readJson(request));
    // A department manager may assign without reading the whole team (E-06 §94).
    const acting = await projects.addMember(context, projectId, input);
    return apiOk({ data: can(acting, "project.member.view") ? await projects.listMembers(acting, projectId).catch(() => []) : [] }, { status: 201 });
  });
}
