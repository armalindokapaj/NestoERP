import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { deleteMinutesSection, updateMinutesSection } from "@/lib/modules/meetings/meeting.minutes";
import { updateMinutesSectionSchema } from "@/lib/modules/meetings/meeting.schema";

type Params = { params: Promise<{ meetingId: string; sectionId: string }> };

/** PATCH — edit a draft minutes section (PRD #40 §45, §166). */
export async function PATCH(request: Request, { params }: Params) {
  const { meetingId, sectionId } = await params;
  return withContext(async (context) => {
    const input = updateMinutesSectionSchema.parse(await readJson(request));
    return apiOk({ data: await updateMinutesSection(context, meetingId, sectionId, input) });
  });
}

/** DELETE — remove a draft minutes section (PRD #40 §166). */
export async function DELETE(_request: Request, { params }: Params) {
  const { meetingId, sectionId } = await params;
  return withContext(async (context) => apiOk({ data: await deleteMinutesSection(context, meetingId, sectionId) }));
}
