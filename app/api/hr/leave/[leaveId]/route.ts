import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { updateLeaveSchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";

type Params = { params: Promise<{ leaveId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { leaveId } = await params;
  return withContext(async (context) => apiOk({ data: await leave.getLeave(context, leaveId) }));
}

export async function PATCH(request: Request, { params }: Params) {
  const { leaveId } = await params;
  return withContext(async (context) => {
    // Status is not a field: each transition has its own endpoint, so an
    // update can never approve anything (PRD #16 §183).
    const input = updateLeaveSchema.parse(await readJson(request));
    return apiOk({ data: await leave.updateLeave(context, leaveId, input) });
  });
}
