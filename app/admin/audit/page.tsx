import { adminRoleName } from "@/components/platform/admin-roles";
import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { auditFilterOptions, listAuditLog } from "@/lib/modules/platform/platform-audit.query";
import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { formatDateTime } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAccess");
  return { title: t("audit.list.metaTitle") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const FILTER_KEYS = ["q", "actor", "action", "entity", "org", "category", "severity", "from", "to"] as const;

/**
 * The platform Audit Log (Admin Audit PRD #6 §61-§73): filtered and paged on
 * the server, every row opens its event, and the same filters export as CSV.
 * Read-only — nothing here edits or deletes an event.
 */
export default async function AuditLogPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminAccess");
  const ta = await getTranslations("admin");
  const context = await requirePlatformContext();
  const [{ filter, rows, total, pages }, options] = await Promise.all([listAuditLog(context, raw), auditFilterOptions(context)]);
  const filtered = FILTER_KEYS.some((key) => filter[key]);
  const query = (changes: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries({ ...Object.fromEntries(FILTER_KEYS.map((key) => [key, filter[key]])), page: String(filter.page), ...changes }).filter(([key, value]) => value !== "" && !(key === "page" && value === "1")));
    return params.size ? `?${params}` : "";
  };
  const field = "h-11 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 sm:w-auto";
  return (
    <div className="space-y-4">
      <PageHeader title={t("audit.list.title")} description={t("audit.list.description")} actions={<a href={`/api/platform-admin/audit/export${query({ page: "1" })}`} className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 text-table font-medium text-fg hover:bg-hover" data-testid="audit-export">{t("audit.list.export")}</a>} />
      <form method="get" action="/admin/audit" className="nesto-card grid grid-cols-2 gap-2 p-3 sm:flex sm:flex-wrap sm:items-end" aria-label={t("audit.list.filterLabel")}>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-fg-subtle sm:col-auto">{t("audit.list.search")}<input name="q" defaultValue={filter.q} placeholder={t("audit.list.searchPlaceholder")} className={field} /></label>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-fg-subtle sm:col-auto">{t("audit.list.actor")}<input name="actor" defaultValue={filter.actor} className={field} /></label>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-fg-subtle sm:col-auto">{t("audit.list.action")}<input name="action" defaultValue={filter.action} className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.recordType")}<select name="entity" defaultValue={filter.entity} className={field}><option value="">{t("common.any")}</option>{options.entities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.group")}<select name="org" defaultValue={filter.org} className={field}><option value="">{t("common.any")}</option>{options.organizations.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.category")}<select name="category" defaultValue={filter.category} className={field}><option value="">{t("common.any")}</option>{options.categories.map((value) => <option key={value} value={value}>{enumLabel(t, "enums.category", value, value.toLowerCase().replaceAll("_", " "))}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.severity")}<select name="severity" defaultValue={filter.severity} className={field}><option value="">{t("common.any")}</option><option value="INFO">{t("audit.list.severityOptions.INFO")}</option><option value="IMPORTANT">{t("audit.list.severityOptions.IMPORTANT")}</option><option value="CRITICAL">{t("audit.list.severityOptions.CRITICAL")}</option></select></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.from")}<input type="date" name="from" defaultValue={filter.from} className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.to")}<input type="date" name="to" defaultValue={filter.to} className={field} /></label>
        <button type="submit" className="col-span-2 h-11 rounded-lg bg-accent px-3.5 text-table font-medium text-accent-fg hover:bg-accent-strong sm:col-auto sm:h-9">{t("audit.list.apply")}</button>
        {filtered ? <Link href="/admin/audit" className="col-span-2 h-11 px-2 text-center text-table leading-[2.75rem] text-fg-muted hover:text-fg sm:col-auto sm:h-9 sm:leading-9">{t("audit.list.clear")}</Link> : null}
      </form>
      <section className="nesto-card overflow-hidden" data-testid="audit-log">
        {rows.length === 0 ? (
          filtered ? <NoResultsState className="m-4" noun={t("audit.list.noun")} clearHref="/admin/audit" /> : <EmptyState className="m-4" title={t("audit.list.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <Table stack aria-label={t("audit.list.tableLabel")}>
              <TableHead><TableRow><TableHeaderCell>{t("audit.list.cols.time")}</TableHeaderCell><TableHeaderCell>{t("audit.list.cols.actor")}</TableHeaderCell><TableHeaderCell>{t("audit.list.cols.action")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("audit.list.cols.record")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("audit.list.cols.organization")}</TableHeaderCell><TableHeaderCell>{t("audit.list.cols.severity")}</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="audit-row">
                    <TableCell className="whitespace-nowrap"><Link href={`/admin/audit/${row.id}`} className="text-accent-strong hover:underline">{formatDateTime(row.occurredAt)}</Link></TableCell>
                    <TableCell>{row.actor}{row.actorRole ? <p className="text-micro text-fg-subtle">{adminRoleName(tr, row.actorRole)}</p> : null}</TableCell>
                    <TableCell>{enumLabel(ta, "actions", row.actionKey.replace(/^PLATFORM_/, ""), row.action)}</TableCell>
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
            <span data-testid="audit-scope">{t("audit.list.count", { count: total })}</span>
            {pages > 1 ? <nav aria-label={t("common.pagesNav")} className="flex gap-2">{filter.page > 1 ? <Link href={`/admin/audit${query({ page: String(filter.page - 1) })}`}>{t("common.previous")}</Link> : null}<span>{t("common.pageOf", { page: filter.page, pages })}</span>{filter.page < pages ? <Link href={`/admin/audit${query({ page: String(filter.page + 1) })}`}>{t("common.next")}</Link> : null}</nav> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
