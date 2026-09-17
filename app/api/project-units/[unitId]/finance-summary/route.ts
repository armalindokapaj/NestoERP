import { apiOk, withContext } from "@/lib/api/respond";
import { getUnitFinanceSummary } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — contract value, paid, outstanding, overdue, next payment and financial status (E-05F §64, §66). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await getUnitFinanceSummary(context, unitId) }));
}
