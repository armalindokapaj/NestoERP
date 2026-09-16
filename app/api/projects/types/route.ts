import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createProjectTypeSchema } from "@/lib/modules/projects/project.schema";
import { createProjectType, listProjectTypes } from "@/lib/modules/projects/project-type.service";

/**
 * GET  /api/projects/types — the company's project types, with how many
 *      projects use each (E-05A §62).
 * POST /api/projects/types — add one.
 *
 * Both work in the session's company and need `project.type.manage`. The
 * project forms read the types in use through their own pages, not here.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listProjectTypes(context) }));
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createProjectTypeSchema.parse(await readJson(request));
    return apiOk({ data: await createProjectType(context, input) }, { status: 201 });
  });
}
