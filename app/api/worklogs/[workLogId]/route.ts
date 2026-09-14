import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { workLogUpdateSchema } from "@/lib/modules/timesheets/timesheet.schema";
import { deleteWorkLog, updateWorkLog } from "@/lib/modules/timesheets/timesheet.worklogs";

type Params = { params: Promise<{ workLogId: string }> };

/** PATCH — change one of my entries while its week is editable (PRD #42 §146). */
export async function PATCH(request: Request, { params }: Params) {
  const { workLogId } = await params;
  return withContext(async (context) => {
    const input = workLogUpdateSchema.parse(await readJson(request));
    return apiOk({ data: await updateWorkLog(context, workLogId, input) });
  });
}

/** DELETE — remove one of my entries from an editable week (PRD #42 §147). */
export async function DELETE(_request: Request, { params }: Params) {
  const { workLogId } = await params;
  return withContext(async (context) => apiOk({ data: await deleteWorkLog(context, workLogId) }));
}
