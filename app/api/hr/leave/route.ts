import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createLeaveSchema } from "@/lib/modules/hr/hr.schema";
import { parseLeaveQuery } from "@/lib/modules/hr/hr.query";
import * as leave from "@/lib/modules/hr/leave/leave.service";

/**
 * GET  /api/hr/leave — scoped, filtered, paginated (PRD #16 §178).
 * POST /api/hr/leave — file a request.
 *
 * Without `hr.leave.view` the list collapses to the caller's own requests,
 * which is what self-service means (PRD #16 §16, §74).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk(await leave.listLeave(context, parseLeaveQuery(url.searchParams)));
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createLeaveSchema.parse(await readJson(request));
    return apiOk({ data: await leave.createLeave(context, input) }, { status: 201 });
  });
}
