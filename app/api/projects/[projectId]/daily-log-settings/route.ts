import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { projectSettingsSchema } from "@/lib/modules/daily-logs/daily-log.schema";
import { updateProjectDailyLogSettings } from "@/lib/modules/daily-logs/daily-log.settings";

type Params = { params: Promise<{ projectId: string }> };

/** PUT — a project's own daily log rules: required, reviewer, working days (PRD #43 §89, §104, §106). */
export async function PUT(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const input = projectSettingsSchema.parse(await readJson(request));
    return apiOk({ data: await updateProjectDailyLogSettings(context, projectId, input) });
  });
}
