import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { auditFilterOptions, listAuditLog } from "@/lib/modules/platform/platform-audit.query";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Audit Log" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const FILTER_KEYS = ["q", "actor", "action", "entity", "org", "category", "severity", "from", "to"] as const;

/**
 * The platform Audit Log (Admin Audit PRD #6 §61-§73): filtered and paged on
 * the server, every row opens its event, and the same filters export as CSV.
 * Read-only — nothing here edits or deletes an event.
 */
export default async function AuditLogPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const context = await requirePlatformContext();
  const [{ filter, rows, total, pages }, options] = await Promise.all([listAuditLog(context, raw), auditFilterOptions(context)]);
  const filtered = FILTER_KEYS.some((key) => filter[key]);
  const query = (changes: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries({ ...Object.fromEntries(FILTER_KEYS.map((key) => [key, filter[key]])), page: String(filter.page), ...changes }).filter(([key, value]) => value !== "" && !(key === "page" && value === "1")));
    return params.size ? `?${params}` : "";
  };
  const field = "h-9 rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  return (
    <div className="space-y-4">
      <PageHeader title="Audit Log" description="Who did what, to which record, and when — across the platform." actions={<a href={`/api/platform-admin/audit/export${query({ page: "1" })}`} className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 text-table font-medium text-fg hover:bg-hover" data-testid="audit-export">Export CSV</a>} />
      <form method="get" action="/admin/audit" className="nesto-card flex flex-wrap items-end gap-2 p-3" aria-label="Filter audit events">
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">Search<input name="q" defaultValue={filter.q} placeholder="Actor, record, action..." className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">Actor<input name="actor" defaultValue={filter.actor} className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">Action<input name="action" defaultValue={filter.action} className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">Record type<select name="entity" defaultValue={filter.entity} className={field}><option value="">Any</option>{options.entities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">Group<select name="org" defaultValue={filter.org} className={field}><option value="">Any</option>{options.organizations.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">Category<select name="category" defaultValue={filter.category} className={field}><option value="">Any</option>{options.categories.map((value) => <option key={value} value={value}>{value.toLowerCase().replaceAll("_", " ")}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">Severity<select name="severity" defaultValue={filter.severity} className={field}><option value="">Any</option><option value="INFO">Info</option><option value="IMPORTANT">Important</option><option value="CRITICAL">Critical</option></select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">From<input type="date" name="from" defaultValue={filter.from} className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">To<input type="date" name="to" defaultValue={filter.to} className={field} /></label>
        <button type="submit" className="h-9 rounded-lg bg-accent px-3.5 text-table font-medium text-accent-fg hover:bg-accent-strong">Apply</button>
        {filtered ? <Link href="/admin/audit" className="h-9 px-2 text-table leading-9 text-fg-muted hover:text-fg">Clear</Link> : null}
      </form>
      <section className="nesto-card overflow-hidden" data-testid="audit-log">
        {rows.length === 0 ? (
          filtered ? <NoResultsState className="m-4" noun="events" clearHref="/admin/audit" /> : <EmptyState className="m-4" title="No audit events have been recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <Table flush aria-label="Audit events">
              <TableHead><TableRow><TableHeaderCell>Time</TableHeaderCell><TableHeaderCell>Actor</TableHeaderCell><TableHeaderCell>Action</TableHeaderCell><TableHeaderCell className="max-md:hidden">Record</TableHeaderCell><TableHeaderCell className="max-lg:hidden">Organization</TableHeaderCell><TableHeaderCell>Severity</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="audit-row">
                    <TableCell className="whitespace-nowrap"><Link href={`/admin/audit/${row.id}`} className="text-accent-strong hover:underline">{formatDateTime(row.occurredAt)}</Link></TableCell>
                    <TableCell>{row.actor}{row.actorRole ? <p className="text-micro text-fg-subtle">{row.actorRole}</p> : null}</TableCell>
                    <TableCell>{row.action}</TableCell>
                    <TableCell className="max-md:hidden">{row.entity}{row.entityType ? <p className="text-micro text-fg-subtle">{row.entityType}</p> : null}</TableCell>
                    <TableCell className="max-lg:hidden">{row.organization}</TableCell>
                    <TableCell><AdminStatusBadge status={row.severity} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-table text-fg-muted">
            <span data-testid="audit-scope">{total} {total === 1 ? "event" : "events"}</span>
            {pages > 1 ? <nav aria-label="Pages" className="flex gap-2">{filter.page > 1 ? <Link href={`/admin/audit${query({ page: String(filter.page - 1) })}`}>Previous</Link> : null}<span>Page {filter.page} of {pages}</span>{filter.page < pages ? <Link href={`/admin/audit${query({ page: String(filter.page + 1) })}`}>Next</Link> : null}</nav> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
