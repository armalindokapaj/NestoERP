import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createMilestone } from "@/lib/modules/project-planning/planning.milestones";
import { createMilestoneSchema, milestoneListSchema } from "@/lib/modules/project-planning/planning.schema";
import { listMilestones } from "@/lib/modules/project-planning/planning.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's milestones, filtered by phase, status, owner, critical, dates, search or a quick filter (PRD #44 §124-§126, §188). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const search = new URL(request.url).searchParams;
    const query = milestoneListSchema.parse(Object.fromEntries(["phaseId", "status", "ownerId", "critical", "from", "to", "q", "quick"].flatMap((key) => (search.get(key) ? [[key, search.get(key)]] : []))));
    return apiOk({ data: await listMilestones(context, projectId, query) });
  });
}

/** POST — add a milestone (PRD #44 §141-§143, §188). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createMilestoneSchema.parse(await readJson(request));
    return apiOk({ data: await createMilestone(context, projectId, input) }, { status: 201 });
  });
}
