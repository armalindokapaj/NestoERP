import { apiOk, withContext } from "@/lib/api/respond";
import { engineeringReport } from "@/lib/modules/engineering/engineering.overview";

/** GET — RFI, submittal, document, compliance and contractor reports (PRD #46 §206-§211). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const projectId = new URL(request.url).searchParams.get("projectId");
    return apiOk({ data: await engineeringReport(context, { projectId }) });
  });
}
