import { apiOk, withContext } from "@/lib/api/respond";
import { projectEngineeringOverview } from "@/lib/modules/engineering/engineering.overview";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's engineering dashboard (PRD #46 §159). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await projectEngineeringOverview(context, projectId) });
  });
}
