import { apiOk, withContext } from "@/lib/api/respond";
import { accessCheckQuerySchema, diagnoseAccess } from "@/lib/modules/organization/access-diagnostics.service";

/**
 * GET /api/organization/access-diagnostics?userId=&targetCompanyId=[&permission=] —
 * why a person of the group can or cannot do something in one of its
 * companies (E-06 §73). For those who keep access; it changes nothing.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    return apiOk({ data: await diagnoseAccess(context, accessCheckQuerySchema.parse(Object.fromEntries(url.searchParams))) });
  });
}
