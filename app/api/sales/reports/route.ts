import { apiError, apiOk, withContext } from "@/lib/api/respond";
import * as reports from "@/lib/modules/sales/reports/reports.service";

/**
 * The built-in sales reports (PRD #17 §161, §199).
 *
 * One endpoint with a `report` key rather than nine routes that would each have
 * to re-derive the same period and the same scope.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const key = url.searchParams.get("report") ?? "pipeline";
    const period = readPeriod(url);

    switch (key) {
      case "pipeline":
        return apiOk({ data: await reports.pipelineByStage(context) });
      case "forecast":
      case "expected-close":
        return apiOk({ data: await reports.expectedCloseReport(context) });
      case "win-loss":
        return apiOk({ data: await reports.winLossReport(context, period) });
      case "by-owner":
        return apiOk({ data: await reports.ownerReport(context, period) });
      case "lead-conversion":
        return apiOk({ data: await reports.leadConversionReport(context, period) });
      case "lost-reasons":
        return apiOk({ data: await reports.lostReasonReport(context, period) });
      case "proposals":
        return apiOk({ data: await reports.proposalReport(context, period) });
      default:
        return apiError("VALIDATION_ERROR", "That report does not exist.");
    }
  });
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
