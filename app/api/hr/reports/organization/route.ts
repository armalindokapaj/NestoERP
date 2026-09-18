import { apiOk, withContext } from "@/lib/api/respond";
import { getOrganizationReport } from "@/lib/modules/hr/employment/employment.report";
import { organizationReportQuerySchema } from "@/lib/modules/hr/employment/employment.schema";

/**
 * GET /api/hr/reports/organization?asOf=&from=&to= — headcount on a day by
 * company, department, title and status, the movements of a period and tenure,
 * all from effective dates (E-03 §141-§144).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const query = organizationReportQuerySchema.parse({
      asOf: url.searchParams.get("asOf") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    return apiOk({ data: await getOrganizationReport(context, query) });
  });
}
