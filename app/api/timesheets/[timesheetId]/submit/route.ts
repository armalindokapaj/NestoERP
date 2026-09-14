import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { submitSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { submitTimesheet } from "@/lib/modules/timesheets/timesheet.submission";

type Params = { params: Promise<{ timesheetId: string }> };

/** POST — submit my week to its approver, with the version I reviewed (PRD #42 §66-§69, §148, §164). */
export async function POST(request: Request, { params }: Params) {
  const { timesheetId } = await params;
  return withContext(async (context) => {
    const input = submitSchema.parse(await readJson(request));
    return apiOk({ data: await submitTimesheet(context, timesheetId, input) });
  });
}
