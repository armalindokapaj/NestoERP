import type { Metadata } from "next";
import { ArrowDown, ArrowUp } from "lucide-react";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge, adminStatusLabel } from "@/components/platform/admin-status-badge";
import { OrganizationCreateMenu } from "@/components/platform/organization-create";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { COMPANY_STATUSES, GROUP_STATUSES, listOrganizations, organizationGroupOptions, type OrganizationQuery } from "@/lib/modules/platform/platform-organizations.query";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Organizations" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const TABS = [
  { type: "all", label: "All" },
  { type: "group", label: "Groups" },
  { type: "company", label: "Companies" },
  { type: "standalone", label: "Standalone" },
] as const;

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
 * all held in the address.
 */
export default async function OrganizationsPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const context = await requirePlatformContext();
  const [result, groups, openGroups] = await Promise.all([listOrganizations(context, raw), organizationGroupOptions(context), organizationGroupOptions(context, { openOnly: true })]);
  const { query, rows, total, pages } = result;
  const statuses = [...new Set<string>([...(query.type !== "company" && query.type !== "standalone" ? GROUP_STATUSES : []), ...(query.type !== "group" ? COMPANY_STATUSES : [])])].map((value) => ({ value, label: adminStatusLabel(value) }));
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Organizations"
        description="Manage Groups and Companies across NESTO."
        actions={<OrganizationCreateMenu groups={openGroups} canCompany={canPlatform(context, "platform.company.create")} canGroup={canPlatform(context, "platform.group.create")} />}
      />
      <nav aria-label="Organization types" className="overflow-x-auto border-b border-line">
        <ul className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const active = query.type === tab.type;
            return (
              <li key={tab.type}>
                <Link href={href(query, { type: tab.type, page: 1, group: tab.type === "group" ? "" : query.group })} aria-current={active ? "page" : undefined} data-testid={`org-tab-${tab.type}`} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table transition-colors", active ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg")}>
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <OrganizationFilters statuses={statuses} groups={groups} showGroup={query.type !== "group" && query.type !== "standalone"} />

      <section className="nesto-card overflow-hidden" aria-label="Organizations" data-testid="organization-directory">
        {rows.length === 0 ? (
          filtered ? (
            <NoResultsState className="m-4" noun="organizations" clearHref={href(query, { q: "", status: "", group: "", page: 1 })} />
          ) : (
            <EmptyState className="m-4" title="No organizations yet." description="Create your first Company or Parent Group with Create above." />
          )
        ) : (
          <div className="overflow-x-auto">
            <Table flush aria-label="Organizations">
              <TableHead>
                <TableRow>
                  {sortHeader("Organization", "name")}
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell className="max-md:hidden">Parent Group</TableHeaderCell>
                  {sortHeader("Projects", "projects", "max-sm:hidden")}
                  {sortHeader("Users", "users", "max-lg:hidden")}
                  <TableHeaderCell className="max-lg:hidden">Modules</TableHeaderCell>
                  {sortHeader("Status", "status")}
                  {sortHeader("Created", "created", "max-xl:hidden")}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="organization-row" data-type={row.type}>
                    <TableCell>
                      <Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link>
                      <p className="font-mono text-micro text-fg-subtle">{row.slug}</p>
                    </TableCell>
                    <TableCell>{row.type}{row.companies !== null ? <span className="block text-meta text-fg-subtle">{row.companies} {row.companies === 1 ? "company" : "companies"}</span> : null}</TableCell>
                    <TableCell className="max-md:hidden">{row.parentGroup ? <Link href={`/admin/organizations/${row.parentGroup.id}`} className="text-fg-muted hover:underline">{row.parentGroup.name}</Link> : "—"}</TableCell>
                    <TableCell className="tabular-nums max-sm:hidden">{row.projects}</TableCell>
                    <TableCell className="tabular-nums max-lg:hidden">{row.users}</TableCell>
                    <TableCell className="tabular-nums max-lg:hidden">{row.modules ?? "—"}</TableCell>
                    <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                    <TableCell className="max-xl:hidden">{new Date(row.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-table text-fg-muted">
            <span>{total} {total === 1 ? "organization" : "organizations"}</span>
            {pages > 1 ? (
              <nav aria-label="Pages" className="flex items-center gap-2">
                {query.page > 1 ? <Link href={href(query, { page: query.page - 1 })} className="rounded-md px-2 py-1 hover:bg-hover">Previous</Link> : null}
                <span>Page {query.page} of {pages}</span>
                {query.page < pages ? <Link href={href(query, { page: query.page + 1 })} className="rounded-md px-2 py-1 hover:bg-hover">Next</Link> : null}
              </nav>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
