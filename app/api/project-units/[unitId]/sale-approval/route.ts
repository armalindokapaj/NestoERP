import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { requestSaleApproval } from "@/lib/modules/sales/units/unit-sale-approval.service";
import { saleApprovalRequestSchema } from "@/lib/modules/sales/units/unit-sales.schema";

type Params = { params: Promise<{ unitId: string }> };

/** POST — asks for the reservation's sale to be approved, where the Sold rule is Manual approval (E-05F §42). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = saleApprovalRequestSchema.parse(await readJson(request));
    return apiOk({ data: await requestSaleApproval(context, unitId, { note: input.note }) }, { status: 201 });
  });
}
