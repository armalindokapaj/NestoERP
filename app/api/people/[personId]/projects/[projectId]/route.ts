import { apiOk, withContext } from "@/lib/api/respond";
import { unassignPersonFromProject } from "@/lib/modules/people/person.projects";

type Params = { params: Promise<{ personId: string; projectId: string }> };

/** DELETE /api/people/:personId/projects/:projectId — takes them off it, through the project's own team door (E-08 §64). */
export async function DELETE(_request: Request, { params }: Params) {
  const { personId, projectId } = await params;
  return withContext(async (context) => {
    await unassignPersonFromProject(context, personId, projectId);
    return apiOk({ data: { removed: true } });
  });
}
