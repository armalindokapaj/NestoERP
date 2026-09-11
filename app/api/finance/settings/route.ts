import { apiOk, readJson, withContext } from "@/lib/api/respond";
import {
  financeSettingsSchema,
  getFinanceSettings,
  updateFinanceSettings,
} from "@/lib/modules/finance/finance.settings";

/** Company finance configuration (PRD #15 §227, §395). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getFinanceSettings(context) }));
}

export async function PATCH(request: Request) {
  return withContext(async (context) => {
    const input = financeSettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateFinanceSettings(context, input) });
  });
}
