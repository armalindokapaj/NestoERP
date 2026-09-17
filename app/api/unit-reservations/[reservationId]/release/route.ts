import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { releaseReservationSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { releaseReservation } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ reservationId: string }> };

/** POST — end the reservation early, with a reason; the unit is for sale again (E-05E §27). */
export async function POST(request: Request, { params }: Params) {
  const { reservationId } = await params;
  return withContext(async (context) => {
    const input = releaseReservationSchema.parse(await readJson(request));
    return apiOk({ data: await releaseReservation(context, reservationId, input) });
  });
}
