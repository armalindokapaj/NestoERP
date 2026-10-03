import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { adminRoleName } from "@/components/platform/admin-roles";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { organizationGroupOptions } from "@/lib/modules/platform/platform-organizations.query";
import { listUsersDirectory } from "@/lib/modules/platform/platform-users.query";
import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { cn } from "@/lib/utils/cn";
import { formatRelativeTime } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAccess");
  return { title: t("users.list.metaTitle") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const SCOPES = [["", "any"], ["platform", "platform"], ["group", "group"], ["company", "company"], ["none", "none"]] as const;

/**
 * NESTO accounts (Admin Users PRD #6 §3-§8): people who can sign in, not the
 * workforce. Search by name, username, email, company or group; filter by
 * status, scope and group; paged on the server.
 */
export default async function UsersPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const tr = await getTranslations("roles");
  const t = await getTranslations("adminAccess");
  const context = await requirePlatformContext();
  const [result, groups] = await Promise.all([listUsersDirectory(context, raw), organizationGroupOptions(context)]);
  const { rows, query, total, pages } = result;
  const filtered = Boolean(query.q || query.status || query.scope || query.group);
  const link = (changes: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries({ ...raw, ...changes }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "" && !(entry[0] === "page" && entry[1] === "1")));
    return `/admin/users${params.size ? `?${params}` : ""}`;
  };
  return (
    <div className="space-y-4">
      <PageHeader title={t("users.list.title")} description={t("users.list.description")} actions={canPlatform(context, "platform.user.initial_provision") || canPlatform(context, "platform.user.manage") ? <Link href="/admin/users/people" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-table font-medium text-accent-fg hover:bg-accent-strong">{t("users.list.addUser")}</Link> : undefined} />
      <p className="text-table text-fg-muted">{t("users.list.intro")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: t("users.list.statuses.active") }, { value: "SUSPENDED", label: t("users.list.statuses.suspended") }, { value: "INACTIVE", label: t("users.list.statuses.inactive") }]} groups={groups} showGroup placeholder={t("users.list.searchPlaceholder")} />
        <nav aria-label={t("users.list.scopeNav")} className="flex flex-wrap gap-1">
          {SCOPES.map(([value, label]) => <Link key={value || "any"} href={link({ scope: value, page: "1" })} replace aria-current={query.scope === value ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-meta", query.scope === value ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:bg-hover")}>{t(`users.list.scopes.${label}` as never)}</Link>)}
        </nav>
      </div>
      <section className="nesto-card overflow-hidden" data-testid="user-directory">
        {rows.length === 0 ? (
          filtered ? <NoResultsState className="m-4" noun={t("users.list.noun")} clearHref="/admin/users" /> : <EmptyState className="m-4" title={t("users.list.empty")} />
        ) : (
          <div className="overflow-x-auto">
            <Table stack flush aria-label={t("users.list.tableLabel")}>
              <TableHead><TableRow><TableHeaderCell>{t("users.list.cols.user")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("users.list.cols.organization")}</TableHeaderCell><TableHeaderCell>{t("users.list.cols.role")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("users.list.cols.scope")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("users.list.cols.lastActive")}</TableHeaderCell><TableHeaderCell>{t("users.list.cols.status")}</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="user-row">
                    <TableCell><Link href={`/admin/users/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.username}{row.email ? ` · ${row.email}` : ""}</p></TableCell>
                    <TableCell className="max-md:hidden">{row.organization}</TableCell>
                    <TableCell>{adminRoleName(tr, row.role)}</TableCell>
                    <TableCell className="max-lg:hidden">{enumLabel(t, "enums.userScope", row.scope)}</TableCell>
                    <TableCell className="max-sm:hidden">{row.lastActive ? formatRelativeTime(row.lastActive) : t("common.never")}</TableCell>
                    <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-table text-fg-muted">
            <span>{t("users.list.accounts", { count: total })}</span>
            {pages > 1 ? <nav aria-label={t("common.pagesNav")} className="flex gap-2">{query.page > 1 ? <Link href={link({ page: String(query.page - 1) })}>{t("common.previous")}</Link> : null}<span>{t("common.pageOf", { page: query.page, pages })}</span>{query.page < pages ? <Link href={link({ page: String(query.page + 1) })}>{t("common.next")}</Link> : null}</nav> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
