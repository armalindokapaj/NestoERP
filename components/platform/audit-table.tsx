import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils/format";

export type AuditRow = { id: string; actionKey: string; moduleKey?: string; category?: string; severity: string; actorDisplayNameSnapshot: string | null; actorRoleSnapshot?: string | null; entityType: string | null; entityLabelSnapshot: string | null; reason: string | null; summary?: string | null; occurredAt: string; requestId?: string | null };
export function AuditTable({ rows, label = "Audit events" }: { rows: AuditRow[]; label?: string }) { const tone = (severity: string) => severity === "CRITICAL" ? "danger" as const : severity === "IMPORTANT" ? "warning" as const : "neutral" as const; return <Table flush aria-label={label}><TableHead><TableRow><TableHeaderCell>Event</TableHeaderCell><TableHeaderCell>Actor</TableHeaderCell><TableHeaderCell>Target</TableHeaderCell><TableHeaderCell>Category</TableHeaderCell><TableHeaderCell>Details</TableHeaderCell><TableHeaderCell>Occurred</TableHeaderCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell><span className="font-mono text-meta text-fg">{row.actionKey}</span><p className="mt-1"><Badge tone={tone(row.severity)}>{row.severity}</Badge></p></TableCell><TableCell>{row.actorDisplayNameSnapshot ?? "System"}<p className="text-meta text-fg-subtle">{row.actorRoleSnapshot ?? "—"}</p></TableCell><TableCell>{row.entityLabelSnapshot ?? row.entityType ?? "—"}</TableCell><TableCell>{row.category ?? row.moduleKey ?? "—"}</TableCell><TableCell className="max-w-xs"><AuditDetails reason={row.reason} summary={row.summary ?? null} /></TableCell><TableCell>{formatDate(row.occurredAt)}{row.requestId ? <p className="font-mono text-micro text-fg-subtle">{row.requestId}</p> : null}</TableCell></TableRow>)}</TableBody></Table>; }

/**
 * A reason someone wrote, when one was given (older events keep theirs), and
 * otherwise the change NESTO recorded by itself. Never "Reason: —": most
 * actions no longer ask for one (Experience Editor no-reason PRD §10, §11).
 */
function AuditDetails({ reason, summary }: { reason: string | null; summary: string | null }) {
  if (reason) return <p className="truncate" title={reason}><span className="text-fg-subtle">Reason: </span>{reason}</p>;
  if (summary) return <p className="truncate text-fg-muted" title={summary}>{summary}</p>;
  return null;
}
