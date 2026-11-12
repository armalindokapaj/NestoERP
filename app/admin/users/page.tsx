import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { adminRoleName } from "@/components/platform/admin-roles";
import { AdminChoice, AdminListFoot, AdminListFrame, AdminToolbar } from "@/components/platform/admin-list";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { LinkRow } from "@/components/platform/link-row";
import { Button } from "@/components/ui/button";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { formatRelativeTime } from "@/lib/i18n/format";
import { organizationGroupOptions } from "@/lib/modules/platform/platform-organizations.query";
import { listUsersDirectory } from "@/lib/modules/platform/platform-users.query";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";

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
  const locale = await getLocale();
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
  const lastActive = (value: string | null | Date) => (value ? formatRelativeTime(value, locale) : t("common.never"));
  const words = { pages: t("common.pagesNav"), previous: t("common.previous"), next: t("common.next"), pageOf: t("common.pageOf", { page: query.page, pages }) };
  const add = canPlatform(context, "platform.user.initial_provision") || canPlatform(context, "platform.user.manage") ? (
    <Button asChild variant="primary"><Link href="/admin/users/people">{t("users.list.addUser")}</Link></Button>
  ) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title={t("users.list.title")} description={t("users.list.intro")} actions={add} />
      <AdminToolbar>
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: t("users.list.statuses.active") }, { value: "SUSPENDED", label: t("users.list.statuses.suspended") }, { value: "INACTIVE", label: t("users.list.statuses.inactive") }]} groups={groups} showGroup placeholder={t("users.list.searchPlaceholder")} />
        <AdminChoice label={t("users.list.scopeNav")} options={SCOPES.map(([value, label]) => ({ key: value, label: t(`users.list.scopes.${label}` as never), href: link({ scope: value, page: "1" }), active: query.scope === value }))} />
      </AdminToolbar>
      <AdminListFrame
        label={t("users.list.tableLabel")}
        testId="user-directory"
        empty={rows.length === 0 ? (filtered ? <NoResultsState className="m-4" noun={t("users.list.noun")} clearHref="/admin/users" /> : <EmptyState className="m-4" title={t("users.list.empty")} />) : undefined}
        lines={rows.map((row) => ({
          href: `/admin/users/${row.id}`,
          title: row.name,
          subtitle: [adminRoleName(tr, row.role), row.organization].filter(Boolean).join(" · "),
          status: <AdminStatusBadge status={row.status} />,
          facts: [{ key: "username", label: t("users.list.cols.user"), value: row.username }, { key: "lastActive", label: t("users.list.cols.lastActive"), value: lastActive(row.lastActive) }],
          data: { "data-testid": "user-line" },
        }))}
        table={
          <Table aria-label={t("users.list.tableLabel")}>
            <TableHead><TableRow><TableHeaderCell>{t("users.list.cols.user")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("users.list.cols.organization")}</TableHeaderCell><TableHeaderCell>{t("users.list.cols.role")}</TableHeaderCell><TableHeaderCell className="max-xl:hidden">{t("users.list.cols.scope")}</TableHeaderCell><TableHeaderCell>{t("users.list.cols.lastActive")}</TableHeaderCell><TableHeaderCell>{t("users.list.cols.status")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.id} href={`/admin/users/${row.id}`} data-testid="user-row">
                  <TableCell><Link href={`/admin/users/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.username}{row.email ? ` · ${row.email}` : ""}</p></TableCell>
                  <TableCell className="max-lg:hidden">{row.organization}</TableCell>
                  <TableCell>{adminRoleName(tr, row.role)}</TableCell>
                  <TableCell className="max-xl:hidden">{enumLabel(t, "enums.userScope", row.scope)}</TableCell>
                  <TableCell>{lastActive(row.lastActive)}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </Table>
        }
        foot={total > 0 ? <AdminListFoot count={t("users.list.accounts", { count: total })} page={query.page} pages={pages} previousHref={link({ page: String(query.page - 1) })} nextHref={link({ page: String(query.page + 1) })} words={words} /> : undefined}
      />
    </div>
  );
}
