import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { extendReservationSchema } from "@/lib/modules/sales/units/unit-sales.schema";
import { extendReservation } from "@/lib/modules/sales/units/unit-sales.service";

type Params = { params: Promise<{ reservationId: string }> };

/** POST — a later expiry, with a reason; the old and new dates stay on record (E-05E §26). */
export async function POST(request: Request, { params }: Params) {
  const { reservationId } = await params;
  return withContext(async (context) => {
    const input = extendReservationSchema.parse(await readJson(request));
    return apiOk({ data: await extendReservation(context, reservationId, input) });
  });
}
