import Link from "@/components/navigation/nav-link";
import { ArrowRight } from "lucide-react";

import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { AddCompanyToGroup } from "@/components/platform/organization-create";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { PlatformContext } from "@/lib/context/platform-context";
import {
  organizationCompanies, organizationModules, organizationProjects, organizationUsage, organizationUsers, type OrganizationScope,
} from "@/lib/modules/platform/platform-organization-detail.query";
import { attachableCompanies } from "@/lib/modules/platform/platform-organizations.query";

/*
 * The tabs shared by group and company pages (Organizations PRD §24-§41).
 * Server components: each reads its own data only when it is the open tab.
 */

const bytes = (value: number) => value < 1024 ** 2 ? `${Math.round(value / 1024)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`;

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="nesto-card overflow-hidden" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export async function GroupCompaniesTab({ context, group }: { context: PlatformContext; group: { id: string; name: string; open: boolean } }) {
  const [rows, standalone] = await Promise.all([organizationCompanies(context, group.id), attachableCompanies(context)]);
  const add = group.open ? <AddCompanyToGroup group={{ value: group.id, label: group.name }} standalone={standalone} /> : null;
  return (
    <Card title="Companies" action={add}>
      {rows.length === 0 ? (
        <EmptyState className="m-4" title="No Companies in this Group." description="Create a new Company or add an existing standalone Company with Add Company." />
      ) : (
        <div className="overflow-x-auto">
          <Table flush aria-label="Companies">
            <TableHead><TableRow><TableHeaderCell>Company</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Projects</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Users</TableHeaderCell><TableHeaderCell className="max-md:hidden">Modules</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="group-company">
                  <TableCell><Link href={`/admin/organizations/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.slug}</p></TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.projects}</TableCell>
                  <TableCell className="tabular-nums max-sm:hidden">{row.users}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.modules}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export async function ProjectsTab({ context, scope }: { context: PlatformContext; scope: OrganizationScope }) {
  const rows = await organizationProjects(context, scope);
  return (
    <Card title="Projects">
      {rows.length === 0 ? (
        <EmptyState className="m-4" title="No Projects yet." description={`Projects associated with this ${scope.kind === "group" ? "Group's companies" : "Company"} will appear here.`} />
      ) : (
        <div className="overflow-x-auto">
          <Table flush aria-label="Projects">
            <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Managing Company</TableHeaderCell><TableHeaderCell className="max-md:hidden">Users</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell className="max-sm:hidden">3D</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><Link href={`/admin/projects/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                  <TableCell className="max-sm:hidden">{row.company.name}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.users}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  <TableCell className="max-sm:hidden"><AdminStatusBadge status={row.threeD} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export async function UsersTab({ context, scope }: { context: PlatformContext; scope: OrganizationScope }) {
  const rows = await organizationUsers(context, scope);
  return (
    <Card title="Users" action={<Link href="/admin/users" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Manage users<ArrowRight aria-hidden="true" className="size-3.5" /></Link>}>
      {rows.length === 0 ? (
        <EmptyState className="m-4" title="No user accounts yet." description="Accounts with a membership here appear in this list. Employees without a login are not users." />
      ) : (
        <div className="overflow-x-auto">
          <Table flush aria-label="Users">
            <TableHead><TableRow><TableHeaderCell>User</TableHeaderCell><TableHeaderCell>Role</TableHeaderCell>{scope.kind === "group" ? <TableHeaderCell className="max-md:hidden">Company</TableHeaderCell> : null}<TableHeaderCell className="max-lg:hidden">Department</TableHeaderCell><TableHeaderCell className="max-md:hidden">Projects</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell><span className="font-medium text-fg">{row.name}</span><p className="font-mono text-micro text-fg-subtle">{row.username}</p></TableCell>
                  <TableCell>{row.role}</TableCell>
                  {scope.kind === "group" ? <TableCell className="max-md:hidden">{row.company ? <Link href={`/admin/organizations/${row.company.id}`} className="hover:underline">{row.company.name}</Link> : "All companies"}</TableCell> : null}
                  <TableCell className="max-lg:hidden">{row.department ?? "—"}</TableCell>
                  <TableCell className="tabular-nums max-md:hidden">{row.projects ?? "—"}</TableCell>
                  <TableCell><AdminStatusBadge status={row.account !== "ACTIVE" ? row.account : row.membership} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export async function ModulesTab({ context, scope }: { context: PlatformContext; scope: OrganizationScope }) {
  const { companies, modules } = await organizationModules(context, scope);
  const enabled = modules.filter((row) => row.enabledIn > 0).length;
  return (
    <Card title="Modules" action={<Link href="/admin/modules" className="inline-flex items-center gap-1 text-table font-medium text-accent-strong hover:underline">Manage entitlements<ArrowRight aria-hidden="true" className="size-3.5" /></Link>}>
      <p className="border-b border-line px-5 py-3 text-table text-fg-muted">
        {scope.kind === "group" ? `Modules are granted company by company. ${enabled} of ${modules.length} are on in at least one of the ${companies} companies.` : `${enabled} enabled · ${modules.length - enabled} disabled`}
      </p>
      <ul className="divide-y divide-line">
        {modules.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <span className="min-w-0"><span className="block text-body text-fg">{row.name}</span>{row.description ? <span className="block truncate text-meta text-fg-subtle max-sm:hidden">{row.description}</span> : null}</span>
            {scope.kind === "group"
              ? <span className="shrink-0 text-table tabular-nums text-fg-muted">{row.enabledIn} / {companies} companies</span>
              : <AdminStatusBadge status={row.enabledIn > 0 ? "ENABLED" : "DISABLED"} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function UsageTab({ context, scope }: { context: PlatformContext; scope: OrganizationScope }) {
  const usage = await organizationUsage(context, scope);
  const items: [string, string | number][] = [
    ...(scope.kind === "group" ? [["Companies", usage.companies] as [string, number]] : []),
    ["Users", usage.users], ["Projects", usage.projects], ["Modules enabled", usage.modules], ["Storage", `${bytes(usage.storageBytes)} · ${usage.files} files`], ["3D experiences", usage.experiences],
  ];
  return (
    <Card title="Usage">
      <dl className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-card font-semibold tabular-nums text-fg">{value}</dd></div>
        ))}
      </dl>
    </Card>
  );
}
