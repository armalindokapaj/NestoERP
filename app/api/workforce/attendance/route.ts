import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { getAttendanceSheet, saveAttendanceSheet } from "@/lib/modules/workforce/site-attendance.service";
import { saveSheetSchema, sheetScopeSchema } from "@/lib/modules/workforce/workforce.schema";

/**
 * GET  /api/workforce/attendance?date=&projectId=&siteId=&crewId= — the site
 *      sheet: who works there that day and what is recorded (E-04 §123).
 * POST /api/workforce/attendance — mark the sheet (§124). Only the people on it,
 *      and never a day HR or approved leave recorded.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const scope = sheetScopeSchema.parse({ date: params.get("date") ?? "", projectId: params.get("projectId"), siteId: params.get("siteId"), crewId: params.get("crewId") });
    return apiOk({ data: await getAttendanceSheet(context, scope) });
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = saveSheetSchema.parse(await readJson(request));
    return apiOk({ data: await saveAttendanceSheet(context, input) });
  });
}
