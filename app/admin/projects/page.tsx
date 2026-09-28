import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listProjectsDirectory, projectCompanyOptions } from "@/lib/modules/platform/platform-projects.query";
import { organizationGroupOptions } from "@/lib/modules/platform/platform-organizations.query";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Projects" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const THREE_D = [["", "Any 3D"], ["configured", "Configured"], ["none", "Not configured"], ["PUBLIC", "Public"], ["COMPANY_ONLY", "Company users"], ["PRIVATE", "Private"], ["OFFLINE", "Offline"]] as const;

/**
 * Every canonical project on NESTO (Admin Projects & 3D PRD #5 §5-§10): search
 * by project, company or group; filter by status, group and 3D; paged on the
 * server. A project's 3D state is shown apart from its lifecycle.
 */
export default async function ProjectsPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const context = await requirePlatformContext();
  const [result, companies, groups] = await Promise.all([listProjectsDirectory(context, raw), projectCompanyOptions(context), organizationGroupOptions(context)]);
  const { rows, query, total, pages } = result;
  const filtered = Boolean(query.q || query.company || query.group || query.status || query.three);
  const link = (changes: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries({ ...raw, ...changes }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "" && !(entry[0] === "page" && entry[1] === "1")));
    return `/admin/projects${params.size ? `?${params}` : ""}`;
  };
  const canCreate = canPlatform(context, "platform.project.manage");
  const create = canCreate ? (
    <PlatformCommandButton
      label="Create Project"
      title="Create Project"
      description="A name and its managing company are enough. The code is made from the name; 3D is configured separately."
      action="project.create"
      openOnCreate="project"
      variant="primary"
      success="Project created."
      fields={[
        { name: "name", label: "Project name", type: "text", required: true },
        { name: "companyId", label: "Managing company", type: "select", required: true, options: companies },
        { name: "code", label: "Code", type: "text", hint: "Optional. Made from the name when empty." },
      ]}
      redirectTo="/admin/projects/{id}"
    />
  ) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="Projects" description="Manage Projects across NESTO." actions={create} />
      <div className="flex flex-wrap items-center gap-2">
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: "Active" }, { value: "PENDING", label: "Pending" }, { value: "FINISHED", label: "Finished" }, { value: "ARCHIVED", label: "Archived" }]} groups={groups} showGroup placeholder="Search projects..." />
        <nav aria-label="3D status" className="flex flex-wrap gap-1">
          {THREE_D.map(([value, label]) => (
            <Link key={value || "any"} href={link({ three: value, page: "1" })} replace aria-current={query.three === value ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-meta", query.three === value ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:bg-hover")}>{label}</Link>
          ))}
        </nav>
      </div>
      <section className="nesto-card overflow-hidden" data-testid="project-directory">
        {rows.length === 0 ? (
          filtered ? <NoResultsState className="m-4" noun="projects" clearHref="/admin/projects" /> : (
            <EmptyState className="m-4" title="No Projects yet." description={companies.length ? "Create a Project before configuring NESTO 3D." : "Projects can be created once a company exists."} action={companies.length && canCreate ? { label: "Create Project", href: "/admin/projects?create=project" } : undefined} />
          )
        ) : (
          <div className="overflow-x-auto">
            <Table flush aria-label="Projects">
              <TableHead><TableRow><TableHeaderCell>Project</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Company</TableHeaderCell><TableHeaderCell className="max-lg:hidden">Group</TableHeaderCell><TableHeaderCell className="max-md:hidden">Modules</TableHeaderCell><TableHeaderCell>3D</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="project-row">
                    <TableCell><Link href={`/admin/projects/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                    <TableCell className="max-sm:hidden"><Link href={`/admin/organizations/${row.company.id}`} className="text-fg-muted hover:underline">{row.company.name}</Link></TableCell>
                    <TableCell className="max-lg:hidden">{row.group ? <Link href={`/admin/organizations/${row.group.id}`} className="text-fg-muted hover:underline">{row.group.name}</Link> : "—"}</TableCell>
                    <TableCell className="tabular-nums max-md:hidden">{row.modules}</TableCell>
                    <TableCell>{row.threeD === "Not configured" ? <AdminStatusBadge status={row.threeD} /> : <Link href={`/admin/3d/projects/${row.id}`} aria-label={`3D: ${row.threeD}. Open 3D administration for ${row.name}`}><AdminStatusBadge status={row.threeD} /></Link>}</TableCell>
                    <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-table text-fg-muted">
            <span>{total} {total === 1 ? "project" : "projects"}</span>
            {pages > 1 ? <nav aria-label="Pages" className="flex gap-2">{query.page > 1 ? <Link href={link({ page: String(query.page - 1) })}>Previous</Link> : null}<span>Page {query.page} of {pages}</span>{query.page < pages ? <Link href={link({ page: String(query.page + 1) })}>Next</Link> : null}</nav> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
