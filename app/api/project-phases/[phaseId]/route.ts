import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { archivePhase, updatePhase } from "@/lib/modules/project-planning/planning.phases";
import { updatePhaseSchema } from "@/lib/modules/project-planning/planning.schema";

type Params = { params: Promise<{ phaseId: string }> };

/** PATCH — a phase's name, dates, status, progress and owner, with the version the form loaded (PRD #44 §187). */
export async function PATCH(request: Request, { params }: Params) {
  const { phaseId } = await params;
  return withContext(async (context) => {
    const input = updatePhaseSchema.parse(await readJson(request));
    return apiOk({ data: await updatePhase(context, phaseId, input) });
  });
}

/** DELETE — archive the phase, once it holds no live milestones (PRD #44 §187, §271). */
export async function DELETE(_request: Request, { params }: Params) {
  const { phaseId } = await params;
  return withContext(async (context) => {
    await archivePhase(context, phaseId);
    return apiOk({ data: { archived: true } });
  });
}
