import { ArrowDown, ArrowUp } from "@/components/icons";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { OrganizationCreateMenu } from "@/components/platform/organization-create";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { LinkRow } from "@/components/platform/link-row";
import { AdminListFoot, AdminListFrame, AdminTabs } from "@/components/platform/admin-list";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { dateText } from "@/lib/i18n/format";
import { COMPANY_STATUSES, GROUP_STATUSES, listOrganizations, organizationGroupOptions, type OrganizationQuery } from "@/lib/modules/platform/platform-organizations.query";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { statusLabel } from "./_detail/labels";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.organizations") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TABS = ["all", "group", "company", "standalone"] as const;
const TYPE_LABEL = { Group: "orgs.types.Group", Company: "orgs.types.Company", Standalone: "orgs.types.Standalone" } as const;

function href(query: OrganizationQuery, changes: Partial<OrganizationQuery>): string {
  const merged = { ...query, ...changes };
  const params = new URLSearchParams();
  if (merged.type !== "all") params.set("type", merged.type);
  if (merged.q) params.set("q", merged.q);
  if (merged.status) params.set("status", merged.status);
  if (merged.group) params.set("group", merged.group);
  if (merged.sort !== "name") params.set("sort", merged.sort);
  if (merged.dir !== "asc") params.set("dir", merged.dir);
  if (merged.page > 1) params.set("page", String(merged.page));
  const search = params.toString();
  return search ? `/admin/organizations?${search}` : "/admin/organizations";
}

/**
 * Groups and Companies in one directory (Organizations PRD §1, §5-§12):
 * All / Groups / Companies / Standalone, search, filters, sorting and pages,
 * all held in the address. Drawn as the console's lists are
 * (components/platform/admin-list.tsx): the table from md, compact lines on a phone.
 */
export default async function OrganizationsPage({ searchParams }: Props) {
  const locale = await getLocale();
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const t = await getTranslations("adminOrgs");
  const context = await requirePlatformContext();
  const [result, groups, openGroups] = await Promise.all([listOrganizations(context, raw), organizationGroupOptions(context), organizationGroupOptions(context, { openOnly: true })]);
  const { query, rows, total, pages } = result;
  const statuses = [...new Set<string>([...(query.type !== "company" && query.type !== "standalone" ? GROUP_STATUSES : []), ...(query.type !== "group" ? COMPANY_STATUSES : [])])].map((value) => ({ value, label: statusLabel(t, value) }));
  const filtered = Boolean(query.q || query.status || query.group);

  const sortHeader = (label: string, sort: OrganizationQuery["sort"], className?: string) => {
    const active = query.sort === sort;
    const Icon = query.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHeaderCell className={className} aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : undefined}>
        <Link href={href(query, { sort, dir: active && query.dir === "asc" ? "desc" : "asc", page: 1 })} replace scroll={false} className="inline-flex items-center gap-1 hover:text-fg">
          {label}{active ? <Icon aria-hidden="true" className="size-3" /> : null}
        </Link>
      </TableHeaderCell>
    );
  };

  const words = { pages: t("common.pages"), previous: t("common.previous"), next: t("common.next"), pageOf: t("common.pageOf", { page: query.page, pages }) };
  const typeLine = (row: (typeof rows)[number]) => [t(TYPE_LABEL[row.type]), row.parentGroup?.name, row.companies !== null ? t("orgs.companies", { count: row.companies }) : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("orgs.title")}
        description={t("orgs.description")}
        actions={<OrganizationCreateMenu groups={openGroups} canCompany={canPlatform(context, "platform.company.create")} canGroup={canPlatform(context, "platform.group.create")} />}
      />
      <AdminTabs
        label={t("orgs.typesNav")}
        tabs={TABS.map((tab) => ({ key: tab, label: t(`orgs.tabs.${tab}` as const), href: href(query, { type: tab, page: 1, group: tab === "group" ? "" : query.group }), active: query.type === tab, testId: `org-tab-${tab}` }))}
      />
      <OrganizationFilters statuses={statuses} groups={groups} showGroup={query.type !== "group" && query.type !== "standalone"} />

      <AdminListFrame
        label={t("orgs.title")}
        testId="organization-directory"
        empty={rows.length === 0 ? (filtered ? <NoResultsState className="m-4" noun={t("orgs.noun")} clearHref={href(query, { q: "", status: "", group: "", page: 1 })} /> : <EmptyState className="m-4" title={t("orgs.emptyTitle")} description={t("orgs.emptyBody")} />) : undefined}
        lines={rows.map((row) => ({
          href: `/admin/organizations/${row.id}`,
          title: row.name,
          subtitle: typeLine(row),
          status: <AdminStatusBadge status={row.status} />,
          facts: [
            { key: "projects", label: t("orgs.headers.projects"), value: `${t("orgs.headers.projects")} ${row.projects}` },
            { key: "users", label: t("orgs.headers.users"), value: `${t("orgs.headers.users")} ${row.users}` },
          ],
          data: { "data-testid": "organization-line" },
        }))}
        table={
          <Table aria-label={t("orgs.title")}>
            <TableHead>
              <TableRow>
                {sortHeader(t("orgs.headers.organization"), "name")}
                <TableHeaderCell>{t("orgs.headers.type")}</TableHeaderCell>
                <TableHeaderCell className="max-lg:hidden">{t("orgs.headers.parentGroup")}</TableHeaderCell>
                {sortHeader(t("orgs.headers.projects"), "projects")}
                {sortHeader(t("orgs.headers.users"), "users", "max-lg:hidden")}
                <TableHeaderCell className="max-xl:hidden">{t("orgs.headers.modules")}</TableHeaderCell>
                {sortHeader(t("orgs.headers.status"), "status")}
                {sortHeader(t("orgs.headers.created"), "created", "max-xl:hidden")}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.id} href={`/admin/organizations/${row.id}`} data-testid="organization-row" data-type={row.type}>
                  <TableCell>
                    <Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link>
                    <p className="font-mono text-micro text-fg-subtle">{row.slug}</p>
                  </TableCell>
                  <TableCell>{t(TYPE_LABEL[row.type])}{row.companies !== null ? <span className="block text-meta text-fg-subtle">{t("orgs.companies", { count: row.companies })}</span> : null}</TableCell>
                  <TableCell className="max-lg:hidden">{row.parentGroup ? <Link href={`/admin/organizations/${row.parentGroup.id}`} className="text-fg-muted hover:underline">{row.parentGroup.name}</Link> : "—"}</TableCell>
                  <TableCell className="tabular-nums">{row.projects}</TableCell>
                  <TableCell className="tabular-nums max-lg:hidden">{row.users}</TableCell>
                  <TableCell className="tabular-nums max-xl:hidden">{row.modules ?? "—"}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  <TableCell className="max-xl:hidden">{dateText(new Date(row.createdAt), { day: "2-digit", month: "short", year: "numeric" }, locale)}</TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </Table>
        }
        foot={total > 0 ? <AdminListFoot count={t("orgs.total", { count: total })} page={query.page} pages={pages} previousHref={href(query, { page: query.page - 1 })} nextHref={href(query, { page: query.page + 1 })} words={words} /> : undefined}
      />
    </div>
  );
}
