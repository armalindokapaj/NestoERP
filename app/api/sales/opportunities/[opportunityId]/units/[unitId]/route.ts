import { apiOk, withContext } from "@/lib/api/respond";
import { removeUnitFromDeal } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ opportunityId: string; unitId: string }> };

/** DELETE — take the unit out of the deal, unless the deal holds it reserved or sold (E-05E §18). */
export async function DELETE(_request: Request, { params }: Params) {
  const { opportunityId, unitId } = await params;
  return withContext(async (context) => {
    await removeUnitFromDeal(context, opportunityId, unitId);
    return apiOk({ data: { removed: true } });
  });
}
