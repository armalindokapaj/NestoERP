import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { clientAddress, userAgentOf } from "@/lib/core/security/throttle";
import { switchCompanyContext, switchCompanySchema } from "@/lib/modules/organization/company-context.service";

/**
 * POST /api/me/company-context — work in another of this person's companies
 * (E-06 §3.4, §96).
 *
 * A POST for the same reason opening a project is one: a prefetch or a crawler
 * must never move somebody's session. A company they do not belong to answers
 * 404 and moves nothing.
 */
export async function POST(request: Request) {
  return withContext(async (session) => {
    const { companyId } = switchCompanySchema.parse(await readJson(request));
    const result = await switchCompanyContext(session, companyId, {
      ipAddress: clientAddress(request.headers),
      userAgent: userAgentOf(request.headers),
    });
    return apiOk({ data: result });
  });
}
