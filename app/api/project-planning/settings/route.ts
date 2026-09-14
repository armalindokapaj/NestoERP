import { assertModule } from "@/lib/access/guards";
import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { planningSettingsSchema } from "@/lib/modules/project-planning/planning.schema";
import { resolvePlanningSettings, updatePlanningSettings } from "@/lib/modules/project-planning/planning.settings";

/** GET /api/project-planning/settings — the company's planning rules (PRD #44 §309). */
export async function GET() {
  return withContext(async (context) => {
    assertModule(context, "projects");
    return apiOk({ data: await resolvePlanningSettings(context.companyId) });
  });
}

/** PUT — change them (the planning authority, audited). */
export async function PUT(request: Request) {
  return withContext(async (context) => {
    const input = planningSettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updatePlanningSettings(context, input) });
  });
}
