import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { activateScheduleSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { activatePaymentSchedule } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ scheduleId: string }> };

/** POST — puts a draft in force, superseding the schedule it replaces (E-05F §24, §76, §84). */
export async function POST(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  return withContext(async (context) => {
    const input = activateScheduleSchema.parse(await readJson(request));
    return apiOk({ data: await activatePaymentSchedule(context, scheduleId, input) });
  });
}
