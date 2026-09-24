import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createProjectSchema } from "@/lib/modules/projects/project.schema";
import { parsePortfolioQuery } from "@/lib/modules/projects/project.query";
import { listPortfolioProjects } from "@/lib/modules/projects/project.portfolio";
import * as projects from "@/lib/modules/projects/project.service";

/**
 * GET  /api/projects — the Projects page's cards: every project this person may
 *      open in the active workspace, optionally searched (`q`), in the page's
 *      fixed order, cursor-paged (Projects Workspace Grid §106-§114). The
 *      workspace and the person come from the session; no parameter chooses a
 *      company (§108).
 * POST /api/projects — create, requiring project.create in the chosen company
 *      (E-05A §39; PRD #10 §114).
 *
 * Both run the same services the Projects page uses, so hiding a button in the
 * interface and refusing the request are never out of step (PRD #5 §102).
 */
export async function GET(request: Request) {
  // `group: "read"`: in the Group workspace this is every company's projects, each
  // authorised by that company's own scope (Workspace Context §30, §83).
  return withContext(
    async (context) => {
      const url = new URL(request.url);
      return apiOk(await listPortfolioProjects(context, parsePortfolioQuery(url.searchParams)));
    },
    { group: "read" },
  );
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const body = await readJson(request);
    const input = createProjectSchema.parse(body);
    const project = await projects.createProject(context, input);
    return apiOk({ data: project }, { status: 201 });
  });
}
