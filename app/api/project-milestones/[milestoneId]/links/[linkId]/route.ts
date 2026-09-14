import { apiOk, withContext } from "@/lib/api/respond";
import { unlinkRecord } from "@/lib/modules/project-planning/planning.links";

type Params = { params: Promise<{ milestoneId: string; linkId: string }> };

/** DELETE — remove a meeting or daily log link; the record is untouched. */
export async function DELETE(_request: Request, { params }: Params) {
  const { milestoneId, linkId } = await params;
  return withContext(async (context) => {
    await unlinkRecord(context, milestoneId, linkId);
    return apiOk({ data: { removed: true } });
  });
}
