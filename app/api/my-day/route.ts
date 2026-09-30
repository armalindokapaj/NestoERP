import { apiOk, withContext } from "@/lib/api/respond";
import { getMyDay } from "@/lib/modules/productivity/my-day.service";

/**
 * GET /api/my-day — the person's day in one authorised read (MOB-06 §77, §78).
 * Each section is read through its owning module's own scope; a section that
 * failed says so rather than reading as empty. Reusable by any client.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await getMyDay(context) }), { group: "read" });
}
