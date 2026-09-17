import { apiOk, withContext } from "@/lib/api/respond";
import { endAppointment } from "@/lib/modules/organization/appointment.service";

type Params = { params: Promise<{ assignmentId: string }> };

/** POST /api/organization/department-assignments/:assignmentId/end — the appointment ends and stays as history (E-06 §90). */
export async function POST(_request: Request, { params }: Params) {
  const { assignmentId } = await params;
  return withContext(async (context) => {
    await endAppointment(context, assignmentId);
    return apiOk({ data: { ok: true } });
  });
}
