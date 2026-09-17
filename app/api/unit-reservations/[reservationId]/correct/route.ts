import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { correctReservationSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { correctReservation } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ reservationId: string }> };

/** POST — correct an active reservation's agreed price or notes, with a reason; elevated (E-05E §38). */
export async function POST(request: Request, { params }: Params) {
  const { reservationId } = await params;
  return withContext(async (context) => {
    const input = correctReservationSchema.parse(await readJson(request));
    await correctReservation(context, reservationId, input);
    return apiOk({ data: { corrected: true } });
  });
}
