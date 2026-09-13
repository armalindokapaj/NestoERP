import { withContext } from "@/lib/api/respond";
import { auditQuerySchema, exportAuditEvents } from "@/lib/core/audit/audit-query.service";

/**
 * GET /api/audit/export — the audit log as CSV (PRD #28 §170-§174).
 *
 * Takes the same query string as `/api/audit`, so the file is a copy of the
 * screen rather than a second opinion about it. The export is itself audited,
 * and needs `audit.export` on top of `audit.view`: reading the log and taking
 * a copy of it away are different decisions.
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const query = auditQuerySchema.parse({
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      severities: params.getAll("severity").length ? params.getAll("severity") : undefined,
      categories: params.getAll("category").length ? params.getAll("category") : undefined,
      moduleKeys: params.getAll("module").length ? params.getAll("module") : undefined,
      actorTypes: params.getAll("actorType").length ? params.getAll("actorType") : undefined,
      query: params.get("q") ?? undefined,
      page: 1,
      pageSize: 100,
    });

    const { filename, csv } = await exportAuditEvents(context, query);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // A scoped export is per-reader data: never cached anywhere shared
        // (PRD #30 §214).
        "Cache-Control": "no-store",
      },
    });
  });
}
