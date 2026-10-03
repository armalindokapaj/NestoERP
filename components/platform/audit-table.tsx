import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils/format";

export type AuditRow = { id: string; actionKey: string; moduleKey?: string; category?: string; severity: string; actorDisplayNameSnapshot: string | null; actorRoleSnapshot?: string | null; entityType: string | null; entityLabelSnapshot: string | null; reason: string | null; summary?: string | null; occurredAt: string; requestId?: string | null };
export async function AuditTable({ rows, label }: { rows: AuditRow[]; label?: string }) {
  const t = await getTranslations("adminAccess");
  const tone = (severity: string) => severity === "CRITICAL" ? "danger" as const : severity === "IMPORTANT" ? "warning" as const : "neutral" as const;
  return <Table stack flush aria-label={label ?? t("audit.table.defaultLabel")}><TableHead><TableRow><TableHeaderCell>{t("audit.table.cols.event")}</TableHeaderCell><TableHeaderCell>{t("audit.table.cols.actor")}</TableHeaderCell><TableHeaderCell>{t("audit.table.cols.target")}</TableHeaderCell><TableHeaderCell>{t("audit.table.cols.category")}</TableHeaderCell><TableHeaderCell>{t("audit.table.cols.details")}</TableHeaderCell><TableHeaderCell>{t("audit.table.cols.occurred")}</TableHeaderCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell><span className="font-mono text-meta text-fg">{row.actionKey}</span><p className="mt-1"><Badge tone={tone(row.severity)}>{enumLabel(t, "enums.severity", row.severity)}</Badge></p></TableCell><TableCell>{row.actorDisplayNameSnapshot ?? t("audit.table.system")}<p className="text-meta text-fg-subtle">{row.actorRoleSnapshot ?? "—"}</p></TableCell><TableCell>{row.entityLabelSnapshot ?? row.entityType ?? "—"}</TableCell><TableCell>{row.category ? enumLabel(t, "enums.categoryCode", row.category) : (row.moduleKey ?? "—")}</TableCell><TableCell className="max-w-xs"><AuditDetails reason={row.reason} summary={row.summary ?? null} prefix={t("audit.table.reasonPrefix")} /></TableCell><TableCell>{formatDate(row.occurredAt)}{row.requestId ? <p className="font-mono text-micro text-fg-subtle">{row.requestId}</p> : null}</TableCell></TableRow>)}</TableBody></Table>;
}

/**
 * A reason someone wrote, when one was given (older events keep theirs), and
 * otherwise the change NESTO recorded by itself. Never "Reason: —": most
 * actions no longer ask for one (Experience Editor no-reason PRD §10, §11).
 */
function AuditDetails({ reason, summary, prefix }: { reason: string | null; summary: string | null; prefix: string }) {
  if (reason) return <p className="truncate" title={reason}><span className="text-fg-subtle">{prefix}</span>{reason}</p>;
  if (summary) return <p className="truncate text-fg-muted" title={summary}>{summary}</p>;
  return null;
}
