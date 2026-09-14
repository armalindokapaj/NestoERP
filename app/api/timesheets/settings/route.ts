import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { settingsSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { getTimesheetSettings, updateTimesheetSettings } from "@/lib/modules/timesheets/timesheet.settings";

/** GET /api/timesheets/settings — the company's timesheet rules (PRD #42 §217). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getTimesheetSettings(context) }));
}

/** PUT /api/timesheets/settings — change them (settings.manage, audited). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    const input = settingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateTimesheetSettings(context, input) });
  });
}
