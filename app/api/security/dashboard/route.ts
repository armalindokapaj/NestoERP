import { apiOk, withContext } from "@/lib/api/respond";
import { securityDashboard } from "@/lib/modules/security/security.service";

/** Counts of devices by standing for the administrator's scope (MOB-11 §140, §141). */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await securityDashboard(context) }), { group: "read" });
}
