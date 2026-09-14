import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { workLogInputSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { createWorkLog } from "@/lib/modules/timesheets/timesheet.worklogs";

/**
 * POST /api/timesheets/worklogs — log time for the signed-in member (PRD #42
 * §145). The week is found from the date, and created if it is the first entry.
 */
export async function POST(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = workLogInputSchema.parse(await readJson(request));
    return apiOk({ data: await createWorkLog(context, input) }, { status: 201 });
  });
}
