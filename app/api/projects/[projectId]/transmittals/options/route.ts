import { apiOk, withContext } from "@/lib/api/respond";
import { transmittalDocumentOptions } from "@/lib/modules/engineering/engineering.transmittals";

type Params = { params: Promise<{ projectId: string }> };

/** GET — register documents and revisions that could travel on a transmittal (PRD #46 §122). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await transmittalDocumentOptions(context, projectId) });
  });
}
