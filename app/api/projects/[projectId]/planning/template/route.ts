import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { applyTemplateSchema } from "@/lib/modules/project-planning/planning.schema";
import { applyTemplate } from "@/lib/modules/project-planning/planning.templates";

type Params = { params: Promise<{ projectId: string }> };

/** POST — start an empty plan from a template; never over an existing plan (PRD #44 §136, §137). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = applyTemplateSchema.parse(await readJson(request));
    return apiOk({ data: await applyTemplate(context, projectId, input.templateKey) }, { status: 201 });
  });
}
