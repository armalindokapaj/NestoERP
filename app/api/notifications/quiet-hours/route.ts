import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { getQuietHours, quietHoursSchema, setQuietHours } from "@/lib/core/notifications/notification.settings";

/** GET/PUT /api/notifications/quiet-hours — the caller's own quiet hours (MOB-10 §91). Personal, so every workspace may use it. */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getQuietHours(context) }), { group: "any" });
}

export async function PUT(request: Request) {
  return withContext(async (context) => apiOk({ data: await setQuietHours(context, quietHoursSchema.parse(await readJson(request))) }), { group: "any" });
}
