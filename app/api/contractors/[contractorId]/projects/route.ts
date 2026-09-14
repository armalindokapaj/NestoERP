import { apiOk, withContext } from "@/lib/api/respond";
import { listContractorAssignments } from "@/lib/modules/contractors/contractor.assignments";

type Params = { params: Promise<{ contractorId: string }> };

/** GET — the contractor's project assignments this reader can open (PRD #46 §160). */
export async function GET(_request: Request, { params }: Params) {
  const { contractorId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await listContractorAssignments(context, contractorId) });
  });
}
