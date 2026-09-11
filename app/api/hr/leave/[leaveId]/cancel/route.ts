import { withContext } from "@/lib/api/respond";
import * as leave from "@/lib/modules/hr/leave/leave.service";

type Params = { params: Promise<{ leaveId: string }> };

/**
 * Cancels leave (PRD #16 §89, §93).
 *
 * Cancelling approved leave returns the days and removes exactly the
 * attendance rows that leave wrote.
 */
export async function POST(_request: Request, { params }: Params) {
  const { leaveId } = await params;
  return withContext(async (context) => {
    await leave.cancelLeave(context, leaveId);
    return new Response(null, { status: 204 });
  });
}
