import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { organizationGroupOptions } from "@/lib/modules/platform/platform-organizations.query";
import { listUsersDirectory } from "@/lib/modules/platform/platform-users.query";
import { cn } from "@/lib/utils/cn";
import { formatRelativeTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Users" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const SCOPES = [["", "Any scope"], ["platform", "Platform"], ["group", "Group"], ["company", "Company"], ["none", "No access"]] as const;

/**
 * NESTO accounts (Admin Users PRD #6 §3-§8): people who can sign in, not the
 * workforce. Search by name, username, email, company or group; filter by
 * status, scope and group; paged on the server.
 */
export default async function UsersPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
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
      <PageHeader title="Users" description="Manage NESTO accounts and platform access." actions={canPlatform(context, "platform.user.initial_provision") || canPlatform(context, "platform.user.manage") ? <Link href="/admin/users/people" className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-table font-medium text-accent-fg hover:bg-accent-strong">+ Add User</Link> : undefined} />
      <p className="text-table text-fg-muted">An account belongs to a person. Add User starts from the person in People, so nobody is created twice.</p>
      <div className="flex flex-wrap items-center gap-2">
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: "Active" }, { value: "SUSPENDED", label: "Suspended" }, { value: "INACTIVE", label: "Inactive" }]} groups={groups} showGroup placeholder="Search users..." />
        <nav aria-label="Scope" className="flex flex-wrap gap-1">
          {SCOPES.map(([value, label]) => <Link key={value || "any"} href={link({ scope: value, page: "1" })} replace aria-current={query.scope === value ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-meta", query.scope === value ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:bg-hover")}>{label}</Link>)}
        </nav>
      </div>
      <section className="nesto-card overflow-hidden" data-testid="user-directory">
        {rows.length === 0 ? (
          filtered ? <NoResultsState className="m-4" noun="users" clearHref="/admin/users" /> : <EmptyState className="m-4" title="No NESTO user accounts have been created yet." />
        ) : (
          <div className="overflow-x-auto">
            <Table stack flush aria-label="Users">
              <TableHead><TableRow><TableHeaderCell>User</TableHeaderCell><TableHeaderCell className="max-md:hidden">Organization</TableHeaderCell><TableHeaderCell>Role</TableHeaderCell><TableHeaderCell className="max-lg:hidden">Scope</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Last active</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="user-row">
                    <TableCell><Link href={`/admin/users/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.username}{row.email ? ` · ${row.email}` : ""}</p></TableCell>
                    <TableCell className="max-md:hidden">{row.organization}</TableCell>
                    <TableCell>{row.role}</TableCell>
                    <TableCell className="max-lg:hidden">{row.scope}</TableCell>
                    <TableCell className="max-sm:hidden">{row.lastActive ? formatRelativeTime(row.lastActive) : "Never"}</TableCell>
                    <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-table text-fg-muted">
            <span>{total} {total === 1 ? "account" : "accounts"}</span>
            {pages > 1 ? <nav aria-label="Pages" className="flex gap-2">{query.page > 1 ? <Link href={link({ page: String(query.page - 1) })}>Previous</Link> : null}<span>Page {query.page} of {pages}</span>{query.page < pages ? <Link href={link({ page: String(query.page + 1) })}>Next</Link> : null}</nav> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
