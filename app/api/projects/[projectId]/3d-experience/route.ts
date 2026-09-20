import { apiOk, withContext } from "@/lib/api/respond";
import { getProject3DAvailability } from "@/lib/modules/project-3d/project-3d.viewer";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return withContext(async (context) => apiOk({ data: await getProject3DAvailability(context, projectId) }));
}
