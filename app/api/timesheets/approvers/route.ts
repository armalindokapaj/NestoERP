import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { approverOptions, listApproverAssignments, setApprover } from "@/lib/modules/timesheets/timesheet.approvers";
import { approverAssignmentSchema } from "@/lib/modules/timesheets/timesheet.schema";

/** GET /api/timesheets/approvers — who approves whose weeks, and who could (PRD #42 §72-§74). */
export async function GET() {
  return withContext(async (context) => {
    const [assignments, options] = await Promise.all([listApproverAssignments(context), approverOptions(context)]);
    return apiOk({ data: { assignments, options } });
  });
}

/** PUT /api/timesheets/approvers — set or clear one member's designated approver (§74, §233). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    const input = approverAssignmentSchema.parse(await readJson(request));
    return apiOk({ data: await setApprover(context, input) });
  });
}
