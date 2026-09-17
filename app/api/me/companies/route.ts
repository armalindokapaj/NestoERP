import { apiOk, withContext } from "@/lib/api/respond";
import { listCompanyContexts } from "@/lib/modules/organization/company-context.service";

/**
 * GET /api/me/companies — the companies this person can work in, for the
 * company switcher (E-06 §3.4). Their own memberships only.
 */
export async function GET() {
  return withContext(async (session) => apiOk({ data: await listCompanyContexts(session) }));
}
