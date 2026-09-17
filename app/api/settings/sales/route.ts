import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { getSalesSettings, salesSettingsSchema, updateSalesSettings } from "@/lib/modules/settings/sales-settings.service";

/**
 * GET   /api/settings/sales — the company's unit sales defaults (E-05E §24).
 * PATCH /api/settings/sales — change them, requiring company.settings.update.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getSalesSettings(context) }));
}

export async function PATCH(request: Request) {
  return withContext(async (context) => {
    const input = salesSettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateSalesSettings(context, input) });
  });
}
