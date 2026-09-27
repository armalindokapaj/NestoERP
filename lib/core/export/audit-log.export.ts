import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { auditQuerySchema, listAuditEvents, redactForReader, type AuditEventListItemDTO, type AuditQuery } from "@/lib/core/audit/audit-query.service";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { prepareExport, type ExportColumn, type ExportLimits, type PreparedExport } from "./exporter";
import { assertExportParams, assertExportRange, type ParamRules } from "./export-params";

/**
 * The audit log as CSV (PRD #28 §170-§174; AUD-08 §7).
 *
 * Built on the list itself — `listAuditEvents`, the same company scope, the
 * same filters and the same order (newest first, then id) — so the file is a
 * copy of the screen, every page of it, not a second opinion about it. Only the
 * two fields the list does not carry (the reason and the recorded changes) are
 * read afterwards, by the ids the list returned, inside the same company. An
 * audit event is never edited, so that second read cannot disagree with the
 * first (DT-16).
 *
 * Rules the PRD is specific about:
 *
 *   - a cap (5,000 rows, the existing one) — past it the request is refused
 *     whole with a JSON error, where it used to write the first 5,000 and call
 *     the file complete (DT-17);
 *   - the export is itself audited, since taking a copy of the evidence is an
 *     event an auditor wants to see;
 *   - and that audit does not recurse — the rows are read *before* the export
 *     event is written, so an export never contains the record of itself.
 *
 * Needs `audit.export` on top of `audit.view`. Sensitive values were redacted
 * when the event was written and stay redacted: the file carries what the
 * event holds, never more.
 */

export const AUDIT_EXPORT_LIMITS: Partial<ExportLimits> = { maxRows: 5000 };

const TEXT: ParamRules[string] = { kind: "text", max: 200 };

/** The audit list's filters, as `GET /api/audit` reads them; the list filters repeat a key rather than join with commas. */
export const AUDIT_EXPORT_PARAMS: ParamRules = {
  from: { kind: "date" },
  to: { kind: "date" },
  severity: { kind: "enum", allowed: ["INFO", "IMPORTANT", "CRITICAL"] },
  category: TEXT,
  module: TEXT,
  actorType: { kind: "enum", allowed: ["USER", "SYSTEM", "INTEGRATION"] },
  q: TEXT,
};

export function parseAuditExport(context: UserContext, params: URLSearchParams): AuditQuery {
  assertPermission(context, "audit.view");
  assertPermission(context, "audit.export");
  assertExportParams(params, AUDIT_EXPORT_PARAMS, { repeatable: ["severity", "category", "module", "actorType"] });
  assertExportRange(params, "from", "to");
  const many = (key: string) => {
    const values = params.getAll(key).map((value) => value.trim()).filter(Boolean);
    return values.length ? values : undefined;
  };
  return auditQuerySchema.parse({
    from: params.get("from")?.trim() || undefined,
    to: params.get("to")?.trim() || undefined,
    severities: many("severity"),
    categories: many("category"),
    moduleKeys: many("module"),
    actorTypes: many("actorType"),
    query: params.get("q")?.trim() || undefined,
    page: 1,
    pageSize: 100,
  });
}

type AuditExportRow = AuditEventListItemDTO & { reason: string | null; changes: unknown };

export function auditColumns(context: UserContext): ExportColumn<AuditExportRow>[] {
  return [
    { header: "Company ID", kind: "code", value: () => context.companyId },
    { header: "Event ID", kind: "code", value: (row) => row.id },
    { header: "Occurred at", kind: "datetime", value: (row) => row.occurredAt },
    { header: "Actor", kind: "text", value: (row) => row.actor.displayName },
    { header: "Actor type", kind: "status", value: (row) => row.actor.type },
    { header: "Role", kind: "text", value: (row) => row.actor.roleSnapshot },
    { header: "Module", kind: "code", value: (row) => row.moduleKey },
    { header: "Category", kind: "status", value: (row) => row.category },
    { header: "Severity", kind: "status", value: (row) => row.severity },
    { header: "Action", kind: "code", value: (row) => row.actionKey },
    { header: "Entity type", kind: "code", value: (row) => row.entity?.type },
    { header: "Entity ID", kind: "code", value: (row) => row.entity?.id },
    { header: "Entity", kind: "text", value: (row) => row.entity?.label },
    { header: "Project ID", kind: "code", value: (row) => row.projectId },
    { header: "Reason", kind: "text", value: (row) => row.reason },
    { header: "Changes", kind: "text", value: (row) => (row.changes ? JSON.stringify(row.changes) : null) },
  ];
}

export async function exportAuditLog(context: UserContext, query: AuditQuery, options: { evaluatedAt?: Date } = {}): Promise<PreparedExport> {
  assertPermission(context, "audit.view");
  assertPermission(context, "audit.export");

  const prepared = await prepareExport<AuditExportRow>({
    id: "settings.audit",
    filename: "audit-log.csv",
    columns: auditColumns(context),
    limits: AUDIT_EXPORT_LIMITS,
    evaluatedAt: options.evaluatedAt,
    read: async (take) => {
      const list = await listAuditEvents(context, { ...query, page: 1, pageSize: take });
      if (list.data.length > take - 1) return { rows: list.data.map((row) => ({ ...row, reason: null, changes: null })), total: list.pagination.total };
      const details = await prisma.auditEvent.findMany({
        where: { companyId: context.companyId, id: { in: list.data.map((row) => row.id) } },
        select: { id: true, reason: true, changesJson: true },
      });
      const byId = new Map(details.map((row) => [row.id, row]));
      const canSeeSensitive = context.permissions.includes("audit.sensitive.view");
      return {
        rows: list.data.map((row) => ({ ...row, reason: byId.get(row.id)?.reason ?? null, changes: redactForReader((byId.get(row.id)?.changesJson ?? null) as Record<string, unknown> | null, canSeeSensitive) })),
        total: list.pagination.total,
      };
    },
  });

  await recordUserAction(context, {
    actionKey: AuditAction.AUDIT_LOG_EXPORTED,
    entity: { type: "audit_log", id: context.companyId, label: "Audit log export" },
    metadata: { rowCount: prepared.rowCount, capped: false },
  });
  return prepared;
}
