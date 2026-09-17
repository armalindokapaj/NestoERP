import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { discardScheduleSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { discardPaymentSchedule } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ scheduleId: string }> };

/** POST — cancels a draft schedule nobody wants; it is kept, never deleted (E-05F §20). */
export async function POST(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  return withContext(async (context) => {
    const input = discardScheduleSchema.parse(await readJson(request));
    await discardPaymentSchedule(context, scheduleId, input);
    return apiOk({ data: { ok: true } });
  });
}
