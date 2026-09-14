import { z } from "zod";

import { apiOk, withContext } from "@/lib/api/respond";
import { taskOptions } from "@/lib/modules/timesheets/timesheet.service";

const querySchema = z.object({ projectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), q: z.string().max(80).optional() });

/** GET /api/timesheets/options/tasks?projectId= — tasks on a project the member can open (PRD #42 §54). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = querySchema.parse({ projectId: params.get("projectId") ?? undefined, q: params.get("q") ?? undefined });
    return apiOk({ data: await taskOptions(context, query.projectId, query.q) });
  });
}
