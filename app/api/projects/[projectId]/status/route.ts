import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { contextForProject } from "@/lib/modules/projects/project.portfolio";
import { changeProjectStatusSchema } from "@/lib/modules/projects/project.schema";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * PATCH /api/projects/:projectId/status — Pending, Active or Finished
 * (E-05A §40).
 *
 * The project is found through the person's membership in its own company, and
 * the status permission is checked there: a project manager in Company B moves
 * Company B's projects, whichever company the session is in.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { projectId } = await params;
  // `group: "any"`: a card on the Projects page in the Group workspace. The write
  // never runs as the session's own company: the project's company decides it.
  return withContext(
    async (session) => {
      const input = changeProjectStatusSchema.parse(await readJson(request));
      const context = await contextForProject(session, projectId);
      return apiOk({ data: await projects.changeProjectStatus(context, projectId, input) });
    },
    { group: "any" },
  );
}
