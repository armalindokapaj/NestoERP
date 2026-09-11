import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateAttendanceSchema } from "@/lib/modules/hr/hr.schema";
import * as attendance from "@/lib/modules/hr/attendance/attendance.service";

type Params = { params: Promise<{ attendanceId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { attendanceId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await attendance.getAttendance(context, attendanceId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { attendanceId } = await params;
  return withContext(async (context) => {
    const input = updateAttendanceSchema.parse(await readJson(request));
    return apiOk({ data: await attendance.updateAttendance(context, attendanceId, input) });
  });
}
