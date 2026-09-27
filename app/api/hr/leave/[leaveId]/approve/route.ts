import { readJson, withContext } from "@/lib/api/respond";
import { leaveDecisionSchema } from "@/lib/modules/hr/hr.schema";
import * as leave from "@/lib/modules/hr/leave/leave.service";

type Params = { params: Promise<{ leaveId: string }> };

/**
 * Approves leave (PRD #16 §87, §91).
 *
 * Draws down the balance and writes the ON_LEAVE attendance days in the same
 * transaction, so the two can never disagree.
 */
export async function POST(request: Request, { params }: Params) {
  const { leaveId } = await params;
  return withContext(async (context) => {
    const body = await readJson(request).catch((): Record<string, unknown> => ({}));
    const input = leaveDecisionSchema.parse(body);
    // The submission the caller decided: `submittedAt` as it read it (AUD-10 §4, A2).
    await leave.approveLeave(context, leaveId, input.note ?? null, leave.leaveSubmissionFrom(body.submittedAt));
    return new Response(null, { status: 204 });
  });
}
