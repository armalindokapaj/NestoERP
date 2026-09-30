import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { listProjectPreferences, projectLevelSchema, setProjectLevel } from "@/lib/core/notifications/notification.settings";

/** GET/PATCH /api/notifications/project-preferences — how much of each of the caller's projects reaches their phone (MOB-10 §88). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listProjectPreferences(context) }));
}

export async function PATCH(request: Request) {
  return withContext(async (context) => apiOk({ data: await setProjectLevel(context, projectLevelSchema.parse(await readJson(request))) }));
}
