import { adminRoleName } from "@/components/platform/admin-roles";
import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminFilterToggle } from "@/components/platform/admin-filter-toggle";
import { AdminListFoot, AdminListFrame } from "@/components/platform/admin-list";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { LinkRow } from "@/components/platform/link-row";
import { Button } from "@/components/ui/button";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { formatDateTime } from "@/lib/i18n/format";
import { auditFilterOptions, listAuditLog } from "@/lib/modules/platform/platform-audit.query";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { FormSelect } from "@/components/ui/form-select";

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
  const locale = await getLocale();
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
      <PageHeader title={t("audit.list.title")} description={t("audit.list.description")} actions={<Button asChild variant="secondary"><a href={`/api/platform-admin/audit/export${query({ page: "1" })}`} data-testid="audit-export">{t("audit.list.export")}</a></Button>} />
      <form method="get" action="/admin/audit" className="grid grid-cols-2 gap-2 border border-line-strong bg-surface p-3 sm:flex sm:flex-wrap sm:items-end" aria-label={t("audit.list.filterLabel")}>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-fg-subtle sm:col-auto">{t("audit.list.search")}<input name="q" defaultValue={filter.q} placeholder={t("audit.list.searchPlaceholder")} className={field} /></label>
        <AdminFilterToggle label={t("audit.list.filters")} count={FILTER_KEYS.filter((key) => key !== "q" && filter[key]).length}>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-fg-subtle sm:col-auto">{t("audit.list.actor")}<input name="actor" defaultValue={filter.actor} className={field} /></label>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-fg-subtle sm:col-auto">{t("audit.list.action")}<input name="action" defaultValue={filter.action} className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.recordType")}<FormSelect name="entity" defaultValue={filter.entity} className={field}><option value="">{t("common.any")}</option>{options.entities.map((value) => <option key={value} value={value}>{value}</option>)}</FormSelect></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.group")}<FormSelect name="org" defaultValue={filter.org} className={field}><option value="">{t("common.any")}</option>{options.organizations.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</FormSelect></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.category")}<FormSelect name="category" defaultValue={filter.category} className={field}><option value="">{t("common.any")}</option>{options.categories.map((value) => <option key={value} value={value}>{enumLabel(t, "enums.category", value, value.toLowerCase().replaceAll("_", " "))}</option>)}</FormSelect></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.severity")}<FormSelect name="severity" defaultValue={filter.severity} className={field}><option value="">{t("common.any")}</option><option value="INFO">{t("audit.list.severityOptions.INFO")}</option><option value="IMPORTANT">{t("audit.list.severityOptions.IMPORTANT")}</option><option value="CRITICAL">{t("audit.list.severityOptions.CRITICAL")}</option></FormSelect></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.from")}<input type="date" name="from" defaultValue={filter.from} className={field} /></label>
        <label className="flex flex-col gap-1 text-meta text-fg-subtle">{t("audit.list.to")}<input type="date" name="to" defaultValue={filter.to} className={field} /></label>
        </AdminFilterToggle>
        <button type="submit" className="col-span-2 h-11 bg-primary px-3.5 text-table font-medium text-primary-fg hover:bg-primary-hover sm:col-auto sm:h-9">{t("audit.list.apply")}</button>
        {filtered ? <Link href="/admin/audit" className="col-span-2 h-11 px-2 text-center text-table leading-[2.75rem] text-fg-muted hover:text-fg sm:col-auto sm:h-9 sm:leading-9">{t("audit.list.clear")}</Link> : null}
      </form>
      <AdminListFrame
        label={t("audit.list.tableLabel")}
        testId="audit-log"
        empty={rows.length === 0 ? (filtered ? <NoResultsState className="m-4" noun={t("audit.list.noun")} clearHref="/admin/audit" /> : <EmptyState className="m-4" title={t("audit.list.empty")} />) : undefined}
        lines={rows.map((row) => ({
          href: `/admin/audit/${row.id}`,
          title: enumLabel(ta, "actions", row.actionKey.replace(/^PLATFORM_/, ""), row.action),
          subtitle: [row.actor, row.entity].filter(Boolean).join(" · "),
          status: <AdminStatusBadge status={row.severity} />,
          facts: [{ key: "time", label: t("audit.list.cols.time"), value: formatDateTime(row.occurredAt, locale) }, { key: "organization", label: t("audit.list.cols.organization"), value: row.organization }],
        }))}
        table={
          <Table aria-label={t("audit.list.tableLabel")}>
            <TableHead><TableRow><TableHeaderCell>{t("audit.list.cols.time")}</TableHeaderCell><TableHeaderCell>{t("audit.list.cols.actor")}</TableHeaderCell><TableHeaderCell>{t("audit.list.cols.action")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("audit.list.cols.record")}</TableHeaderCell><TableHeaderCell className="max-xl:hidden">{t("audit.list.cols.organization")}</TableHeaderCell><TableHeaderCell>{t("audit.list.cols.severity")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.id} href={`/admin/audit/${row.id}`} data-testid="audit-row">
                  <TableCell className="whitespace-nowrap"><Link href={`/admin/audit/${row.id}`} className="font-medium text-fg hover:underline">{formatDateTime(row.occurredAt, locale)}</Link></TableCell>
                  <TableCell>{row.actor}{row.actorRole ? <p className="text-micro text-fg-subtle">{adminRoleName(tr, row.actorRole)}</p> : null}</TableCell>
                  <TableCell>{enumLabel(ta, "actions", row.actionKey.replace(/^PLATFORM_/, ""), row.action)}</TableCell>
                  <TableCell className="max-lg:hidden">{row.entity}{row.entityType ? <p className="text-micro text-fg-subtle">{row.entityType}</p> : null}</TableCell>
                  <TableCell className="max-xl:hidden">{row.organization}</TableCell>
                  <TableCell><AdminStatusBadge status={row.severity} /></TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </Table>
        }
        foot={total > 0 ? <AdminListFoot count={t("audit.list.count", { count: total })} countTestId="audit-scope" page={filter.page} pages={pages} previousHref={`/admin/audit${query({ page: String(filter.page - 1) })}`} nextHref={`/admin/audit${query({ page: String(filter.page + 1) })}`} words={{ pages: t("common.pagesNav"), previous: t("common.previous"), next: t("common.next"), pageOf: t("common.pageOf", { page: filter.page, pages }) }} /> : undefined}
      />
    </div>
  );
}
