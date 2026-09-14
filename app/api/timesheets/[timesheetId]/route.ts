import { apiOk, withContext } from "@/lib/api/respond";
import { getTimesheet } from "@/lib/modules/timesheets/timesheet.service";

type Params = { params: Promise<{ timesheetId: string }> };

/** GET — one week, if this reader may open it; otherwise not found (PRD #42 §122-§125, §231). */
export async function GET(_request: Request, { params }: Params) {
  const { timesheetId } = await params;
  return withContext(async (context) => apiOk({ data: await getTimesheet(context, timesheetId) }));
}
