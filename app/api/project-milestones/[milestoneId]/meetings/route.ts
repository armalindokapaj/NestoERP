import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { linkRecord } from "@/lib/modules/project-planning/planning.links";
import { recordLinkSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ milestoneId: string }> };

/** POST — link a meeting of the same project (PRD #44 §60-§62, §194). */
export async function POST(request: Request, { params }: Params) {
  const { milestoneId } = await params;
  return withContext(async (context) => {
    const input = recordLinkSchema.parse(await readJson(request));
    return apiOk({ data: await linkRecord(context, milestoneId, "meeting", input.recordId) }, { status: 201 });
  });
}
