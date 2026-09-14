import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { reopenSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { reopenTimesheet } from "@/lib/modules/timesheets/timesheet.submission";

type Params = { params: Promise<{ timesheetId: string }> };

/** POST — reopen an approved week for correction, with a note (PRD #42 §117-§119, §152). */
export async function POST(request: Request, { params }: Params) {
  const { timesheetId } = await params;
  return withContext(async (context) => {
    const input = reopenSchema.parse(await readJson(request));
    return apiOk({ data: await reopenTimesheet(context, timesheetId, input) });
  });
}
