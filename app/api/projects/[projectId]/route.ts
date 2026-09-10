import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateProjectSchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * A project outside the caller's scope answers 404 rather than 403, so the
 * response cannot be used to discover that it exists (PRD #10 §113).
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await projects.getProject(context, projectId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const body = await readJson(request);
    // companyId, createdBy and archivedAt are absent from the schema, so they
    // cannot be set from a request body (PRD #10 §111, §158).
    const input = updateProjectSchema.parse(body);
    return apiOk({ data: await projects.updateProject(context, projectId, input) });
  });
}
