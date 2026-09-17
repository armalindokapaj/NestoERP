import { apiOk, withContext } from "@/lib/api/respond";
import { getUnitFinance } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ unitId: string }> };

/** GET — the unit's Finance section: summary, schedules, and payments and invoices where the reader may see them (E-05F §50). */
export async function GET(_request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => apiOk({ data: await getUnitFinance(context, unitId) }));
}
