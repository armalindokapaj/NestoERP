import { assertModule } from "@/lib/access/guards";
import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { settingsSchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { resolveDailyLogSettings, updateDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";

/** GET /api/daily-logs/settings — the company's daily log rules (PRD #43 §248). */
export async function GET() {
  return withContext(async (context) => {
    assertModule(context, "dailyLogs");
    return apiOk({ data: await resolveDailyLogSettings(context.companyId) });
  });
}

/** PUT — change them (Owner, audited). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    const input = settingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateDailyLogSettings(context, input) });
  });
}
