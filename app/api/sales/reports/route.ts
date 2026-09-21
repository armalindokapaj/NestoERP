import { apiError, apiOk, withContext } from "@/lib/api/respond";
import * as reports from "@/lib/modules/sales/reports/reports.service";

/**
 * The built-in sales reports (PRD #17 §161, §199).
 *
 * One endpoint with a `report` key rather than nine routes that would each have
 * to re-derive the same period and the same scope.
 *
 * Reports consume the active workspace (Workspace Context §41): a company's own
 * numbers, or in the Group workspace the aggregate of every authorised company,
 * money per currency and never summed across them. `?company=` narrows within
 * the group.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const key = url.searchParams.get("report") ?? "pipeline";
    const period = readPeriod(url);
    const company = url.searchParams.get("company") ?? undefined;

    switch (key) {
      case "pipeline":
        return apiOk({ data: await reports.pipelineByStageForWorkspace(context, company) });
      case "forecast":
      case "expected-close":
        return apiOk({ data: await reports.expectedCloseReportForWorkspace(context, company) });
      case "win-loss":
        return apiOk({ data: await reports.winLossReportForWorkspace(context, period, company) });
      case "by-owner":
        return apiOk({ data: await reports.ownerReportForWorkspace(context, period, company) });
      case "lead-conversion":
        return apiOk({ data: await reports.leadConversionReportForWorkspace(context, period, company) });
      case "lost-reasons":
        return apiOk({ data: await reports.lostReasonReportForWorkspace(context, period, company) });
      case "proposals":
        return apiOk({ data: await reports.proposalReportForWorkspace(context, period, company) });
      default:
        return apiError("VALIDATION_ERROR", "That report does not exist.");
    }
  }, { group: "read" });
}

/** An unreadable date falls back to the default period rather than failing. */
function readPeriod(url: URL): reports.ReportPeriod {
  const fallback = reports.defaultPeriod();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const parsedFrom = from ? new Date(from) : null;
  const parsedTo = to ? new Date(to) : null;

  return {
    from: parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : fallback.from,
    to: parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : fallback.to,
  };
}
