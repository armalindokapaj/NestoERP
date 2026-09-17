import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateScheduleSchema } from "@/lib/modules/finance/units/unit-finance.schema";
import { getPaymentSchedule, updatePaymentSchedule } from "@/lib/modules/finance/units/unit-finance.service";

type Params = { params: Promise<{ scheduleId: string }> };

/** GET — one payment schedule with its installments and what is paid (E-05F §59). */
export async function GET(_request: Request, { params }: Params) {
  const { scheduleId } = await params;
  return withContext(async (context) => apiOk({ data: await getPaymentSchedule(context, scheduleId) }));
}

/** PATCH — a draft's installments, replaced as a whole (E-05F §21, §60). */
export async function PATCH(request: Request, { params }: Params) {
  const { scheduleId } = await params;
  return withContext(async (context) => {
    const input = updateScheduleSchema.parse(await readJson(request));
    return apiOk({ data: await updatePaymentSchedule(context, scheduleId, input) });
  });
}
