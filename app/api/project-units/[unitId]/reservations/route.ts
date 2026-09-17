import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reserveSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { reserveUnit } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ unitId: string }> };

/** POST — reserve the unit for a client and a deal, either of them new; one active reservation per unit (E-05E §19-§23). */
export async function POST(request: Request, { params }: Params) {
  const { unitId } = await params;
  return withContext(async (context) => {
    const input = reserveSchema.parse(await readJson(request));
    return apiOk({ data: await reserveUnit(context, unitId, input) }, { status: 201 });
  });
}
