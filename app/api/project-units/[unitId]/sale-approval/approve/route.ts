import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { approveUnitSale } from "@/lib/modules/sales/units/unit-sale-approval.service";
import { saleApprovalDecisionSchema } from "@/lib/modules/sales/units/unit-sales.schema";

type Params = { params: Promise<{ unitId: string }> };

/** POST — approves the pending sale; Mark Sold is then unlocked for that reservation (E-05F §42). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = saleApprovalDecisionSchema.parse(await readJson(request));
    await approveUnitSale(context, unitId, input.note);
    return apiOk({ data: { ok: true } });
  });
}
