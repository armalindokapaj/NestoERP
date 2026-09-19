import { apiOk, withContext } from "@/lib/api/respond";
import { createThreeDViewerGrant } from "@/lib/modules/platform/platform-three-d.viewer";

type Params = { params: Promise<{ projectId: string }> };
export async function POST(_request: Request, { params }: Params) { const { projectId } = await params; return withContext(async (context) => apiOk({ data: await createThreeDViewerGrant(context, projectId) })); }
