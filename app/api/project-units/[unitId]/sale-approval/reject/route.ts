import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { rejectUnitSale } from "@/lib/modules/sales/units/unit-sale-approval.service";
import { saleApprovalDecisionSchema } from "@/lib/modules/sales/units/unit-sales.schema";

type Params = { params: Promise<{ unitId: string }> };

/** POST — rejects the pending sale, with a reason (E-05F §42). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = saleApprovalDecisionSchema.parse(await readJson(request));
    await rejectUnitSale(context, unitId, input.note ?? "");
    return apiOk({ data: { ok: true } });
  });
}
