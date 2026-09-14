import { apiOk, withContext } from "@/lib/api/respond";
import { projectEngineeringOptions } from "@/lib/modules/engineering/engineering.documents";
import { submittalOptions } from "@/lib/modules/engineering/engineering.submittals";

type Params = { params: Promise<{ projectId: string }> };

/** GET — contractors, work packages and people an engineering record on this project may name (PRD #46 §224). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const kind = new URL(request.url).searchParams.get("for");
    if (kind === "submittal") return apiOk({ data: await submittalOptions(context, projectId) });
    return apiOk({ data: await projectEngineeringOptions(context, projectId, kind === "rfi" ? "rfi.respond" : "engineering_document.review") });
  });
}
