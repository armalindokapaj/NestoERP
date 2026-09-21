import { apiOk, withContext } from "@/lib/api/respond";
import { addFavorite, removeFavorite } from "@/lib/modules/productivity/favorites.service";
import { contextForProject } from "@/lib/modules/projects/project.portfolio";

type Params = { params: Promise<{ projectId: string }> };

/**
 * POST / DELETE /api/projects/:projectId/favorite — star or unstar a project
 * (E-05A §13, §38).
 *
 * A favorite belongs to the person's membership in the project's company, the
 * same row PRD #45's star writes, so the star on the Projects page and the star
 * on the project header are one favorite. Both are idempotent. Neither changes
 * what anybody may open.
 */
export async function POST(_request: Request, { params }: Params) {
  const { projectId } = await params;
  // `group: "any"`: the star on a card in the Group workspace is written in the project's own company.
  return withContext(
    async (session) => {
      const context = await contextForProject(session, projectId);
      await addFavorite(context, { entityType: "project", entityId: projectId });
      return apiOk({ data: { isFavorite: true } });
    },
    { group: "any" },
  );
}

export async function DELETE(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(
    async (session) => {
      const context = await contextForProject(session, projectId);
      await removeFavorite(context, { entityType: "project", entityId: projectId });
      return apiOk({ data: { isFavorite: false } });
    },
    { group: "any" },
  );
}
