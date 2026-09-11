import { apiError, apiOk, withContext } from "@/lib/api/respond";
import * as reports from "@/lib/modules/hr/reports/reports.service";

/**
 * The built-in HR reports (PRD #16 §181, §140).
 *
 * One endpoint with a named report rather than five: every report runs the same
 * scope clauses the lists do, and the compensation report additionally requires
 * the compensation grant (PRD #16 §141, §147).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const report = url.searchParams.get("report") ?? "headcount";

    switch (report) {
      case "headcount":
        return apiOk({ data: await reports.headcountReport(context) });
      case "leave":
        return apiOk({ data: await reports.leaveSummary(context) });
      case "attendance":
        return apiOk({ data: await reports.attendanceSummary(context) });
      case "compensation":
        return apiOk({ data: await reports.compensationReport(context) });
      case "ending-soon":
        return apiOk({ data: await reports.upcomingEndDates(context) });
      default:
        return apiError("VALIDATION_ERROR", "That report does not exist.");
    }
  });
}
