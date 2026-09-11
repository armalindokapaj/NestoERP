import { apiOk, readJson, withContext } from "@/lib/api/respond";
import {
  companySettingsSchema,
  getCompanySettings,
  updateCompanySettings,
} from "@/lib/modules/settings/company-settings.service";

/**
 * GET   /api/settings/company — company-wide defaults (PRD #24 §144).
 * PATCH /api/settings/company — update them, requiring company.settings.update.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getCompanySettings(context) }));
}

export async function PATCH(request: Request) {
  return withContext(async (context) => {
    const input = companySettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateCompanySettings(context, input) });
  });
}
