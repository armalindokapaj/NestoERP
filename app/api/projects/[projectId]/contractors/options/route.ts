import { apiOk, withContext } from "@/lib/api/respond";
import { assignmentOptions } from "@/lib/modules/contractors/contractor.assignments";

type Params = { params: Promise<{ projectId: string }> };

/** GET — contractors, managers, contacts and contracts this writer could name (PRD #46 §28, §29). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await assignmentOptions(context, projectId) });
  });
}
