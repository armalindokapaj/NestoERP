import { apiOk, readJson, withContext } from "@/lib/api/respond";
import {
  getIntegrationSettings,
  integrationSettingsSchema,
  updateIntegrationSettings,
} from "@/lib/modules/settings/integration-settings.service";

/**
 * GET   /api/settings/integrations — toggles plus why any is blocked (PRD #24 §144).
 * PATCH /api/settings/integrations — update, refusing a toggle whose modules are off.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getIntegrationSettings(context) }));
}

export async function PATCH(request: Request) {
  return withContext(async (context) => {
    const input = integrationSettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateIntegrationSettings(context, input) });
  });
}
