import { apiOk, withContext } from "@/lib/api/respond";
import { auditQuerySchema, listAuditEvents } from "@/lib/core/audit/audit-query.service";

/**
 * GET /api/audit — the audit log, company-scoped and permission-checked
 * (PRD #28 §151). There is deliberately no POST, PATCH or DELETE: audit is
 * append-only and only trusted server code writes it (PRD #28 §10-§12, §317).
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
      page: params.get("page") ?? 1,
      pageSize: params.get("pageSize") ?? 50,
    });
    return apiOk(await listAuditEvents(context, query));
  });
}
