import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createProjectSchema } from "@/lib/modules/projects/project.schema";
import { parseProjectListQuery } from "@/lib/modules/projects/project.query";
import * as projects from "@/lib/modules/projects/project.service";

/**
 * GET  /api/projects — scoped, filtered, paginated list (PRD #10 §105, §108).
 * POST /api/projects — create, requiring project.create (PRD #10 §114).
 *
 * Both run the same service the UI uses, so hiding a button in the interface
 * and refusing the request are never out of step (PRD #5 §102).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const query = parseProjectListQuery(url.searchParams);
    return apiOk(await projects.listProjects(context, query));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const body = await readJson(request);
    const input = createProjectSchema.parse(body);
    const project = await projects.createProject(context, input);
    return apiOk({ data: project }, { status: 201 });
  });
}
