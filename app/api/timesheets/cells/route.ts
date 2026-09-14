import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { cellInputSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { setCell } from "@/lib/modules/timesheets/timesheet.worklogs";

/** PUT /api/timesheets/cells — set one grid cell's total; zero clears it (PRD #42 §47, §206). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = cellInputSchema.parse(await readJson(request));
    return apiOk({ data: await setCell(context, input) });
  });
}
