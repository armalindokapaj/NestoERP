import { apiOk, withContext } from "@/lib/api/respond";
import { complianceDocumentOptions } from "@/lib/modules/contractors/contractor.compliance";

type Params = { params: Promise<{ contractorId: string }> };

/** GET — documents on the contractor or the item that may serve as evidence (PRD #46 §47). */
export async function GET(request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    const itemId = new URL(request.url).searchParams.get("itemId");
    return apiOk({ data: await complianceDocumentOptions(context, contractorId, itemId) });
  });
}
