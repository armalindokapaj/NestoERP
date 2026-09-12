import { apiOk, withContext } from "@/lib/api/respond";
import * as reports from "@/lib/modules/contracts/reports/reports.service";

/**
 * Every legal report in one response (PRD #18 §266).
 *
 * One endpoint rather than ten, because the reports share a scope query and a
 * redaction pass — splitting them would mean running both ten times.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await reports.contractReports(context) }));
}
