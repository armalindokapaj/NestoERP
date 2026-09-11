import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createAttendanceSchema } from "@/lib/modules/hr/hr.schema";
import { parseAttendanceQuery } from "@/lib/modules/hr/hr.query";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";

/**
 * GET  /api/hr/attendance (PRD #16 §179).
 * POST /api/hr/attendance — record a day.
 *
 * `workedMinutes` is absent from the schema: the server derives it from
 * check-in and check-out (PRD #16 §106).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await attendance.listAttendance(context, parseAttendanceQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createAttendanceSchema.parse(await readJson(request));
    return apiOk({ data: await attendance.createAttendance(context, input) }, { status: 201 });
  });
}
