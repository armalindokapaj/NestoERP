import { withContext } from "@/lib/api/respond";
import * as leave from "@/lib/modules/hr/leave/leave.service";

type Params = { params: Promise<{ leaveId: string }> };

/** Submits a draft or rejected request for approval (PRD #16 §86). */
export async function POST(_request: Request, { params }: Params) {
  const { leaveId } = await params;
  return withContext(async (context) => {
    await leave.submitLeave(context, leaveId);
    return new Response(null, { status: 204 });
  });
}
