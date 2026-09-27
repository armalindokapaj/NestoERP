import { withContext } from "@/lib/api/respond";
import { exportAuditLog, parseAuditExport } from "@/lib/core/export/audit-log.export";
import { exportResponse } from "@/lib/core/export/exporter";

/**
 * GET /api/audit/export — the audit log as CSV (PRD #28 §170-§174; AUD-08 §7).
 *
 * Takes the same query string as `/api/audit`, so the file is a copy of the
 * screen — every page of it — rather than a second opinion about it. The
 * export is itself audited, and needs `audit.export` on top of `audit.view`:
 * reading the log and taking a copy of it away are different decisions. Past
 * 5,000 events, or with a filter the log does not support, it is refused with
 * a JSON error, never a shortened file.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const prepared = await exportAuditLog(context, parseAuditExport(context, params));
    return exportResponse(prepared);
  });
}
