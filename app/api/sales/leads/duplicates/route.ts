import { apiOk, readJson, withContext } from "@/lib/api/respond";
import * as leads from "@/lib/modules/sales/leads/lead.service";

/**
 * The soft duplicate check behind the lead form (PRD #17 §44, §158).
 *
 * A warning, never a block — and it only ever answers with records the caller
 * could already discover (PRD #17 §221).
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    const body = await readJson(request);

    return apiOk({
      data: await leads.checkLeadDuplicates(context, {
        name: typeof body.name === "string" ? body.name : undefined,
        companyName: typeof body.companyName === "string" ? body.companyName : undefined,
        email: typeof body.email === "string" ? body.email : undefined,
        phone: typeof body.phone === "string" ? body.phone : undefined,
        excludeLeadId: typeof body.excludeLeadId === "string" ? body.excludeLeadId : undefined,
      }),
    });
  });
}
