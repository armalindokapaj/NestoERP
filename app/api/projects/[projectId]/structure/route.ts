import { apiOk, withContext } from "@/lib/api/respond";
import { getProjectStructure } from "@/lib/modules/project-structure/structure.service";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET — the project's buildings and floors with their unit counts, the
 * company's unit types and what the reader may change (E-05B §65, §108). Never
 * the units themselves: those load a floor or a filter at a time.
 */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await getProjectStructure(context, projectId) }));
}
