import { withContext } from "@/lib/api/respond";
import { contextForProject } from "@/lib/modules/projects/project.portfolio";
import * as projects from "@/lib/modules/projects/project.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * Archive is its own endpoint: it is not a status a PATCH may set.
 *
 * Reached from the Projects page menu too, so the project is found through the
 * person's membership in its own company and archived with that membership's
 * permission (E-05A §33).
 */
export async function POST(_request: Request, { params }: Params) {
  const { projectId } = await params;
  // `group: "any"`: the card menu in the Group workspace archives in the project's own company.
  return withContext(
    async (session) => {
      const context = await contextForProject(session, projectId);
      await projects.archiveProject(context, projectId);
      return new Response(null, { status: 204 });
    },
    { group: "any" },
  );
}
