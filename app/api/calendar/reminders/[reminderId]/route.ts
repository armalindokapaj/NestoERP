import { withContext } from "@/lib/api/respond";
import { removeReminder } from "@/lib/modules/calendar/calendar.service";

type Params = { params: Promise<{ reminderId: string }> };

/** DELETE — only the caller's own reminder; anyone else's is not found (PRD #39 §70). */
export async function DELETE(_request: Request, { params }: Params) {
  const { reminderId } = await params;
  return withContext(async (context) => {
    await removeReminder(context, reminderId);
    return new Response(null, { status: 204 });
  });
}
