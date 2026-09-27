import { readJson, withContext } from "@/lib/api/respond";
import { leaveRejectionSchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";

type Params = { params: Promise<{ leaveId: string }> };

/** Rejects leave, with the reason the requester needs (PRD #16 §88). */
export async function POST(request: Request, { params }: Params) {
  const { leaveId } = await params;
  return withContext(async (context) => {
    const body = await readJson(request);
    const input = leaveRejectionSchema.parse(body);
    await leave.rejectLeave(context, leaveId, input.note, leave.leaveSubmissionFrom(body.submittedAt));
    return new Response(null, { status: 204 });
  });
}
