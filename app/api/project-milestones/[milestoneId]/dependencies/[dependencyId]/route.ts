import { apiOk, withContext } from "@/lib/api/respond";
import { removeDependency } from "@/lib/modules/project-planning/planning.dependencies";

type Params = { params: Promise<{ milestoneId: string; dependencyId: string }> };

/** DELETE — remove a dependency this milestone is part of (PRD #44 §191). */
export async function DELETE(_request: Request, { params }: Params) {
  const { milestoneId, dependencyId } = await params;
  return withContext(async (context) => {
    await removeDependency(context, milestoneId, dependencyId);
    return apiOk({ data: { removed: true } });
  });
}
