import { apiOk, withContext } from "@/lib/api/respond";
import { listCompliance } from "@/lib/modules/contractors/contractor.compliance";
import { complianceListSchema } from "@/lib/modules/contractors/contractor.schema";

/** GET — the company's compliance register (PRD #46 §160, §207). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = complianceListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listCompliance(context, query) });
  });
}
