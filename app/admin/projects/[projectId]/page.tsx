import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { AssignProjectCompany } from "@/components/platform/project-assignment";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { AccessError } from "@/lib/access/guards";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformProjectDetail, projectCompanyOptions, projectModules, projectUsers } from "@/lib/modules/platform/platform-projects.query";
import { UNASSIGNED_PROJECT_MESSAGE } from "@/lib/access/project-ownership";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Project" };

type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string; from?: string }> };
const TABS = [["overview", "Overview"], ["companies", "Companies"], ["users", "Users"], ["modules", "Modules"], ["3d", "3D"], ["settings", "Settings"]] as const;

/**
 * A canonical project's Platform Admin page (Admin Projects & 3D PRD #5
 * §12-§18, §63, §64). The 3D tab summarizes its experience and links into 3D
 * administration; its business records stay in the tenant workspace.
 */
export default async function PlatformProjectPage({ params, searchParams }: Props) {
  const [{ projectId }, { tab: rawTab, from }] = await Promise.all([params, searchParams]);
  const context = await requirePlatformContext();
  const project = await getPlatformProjectDetail(context, projectId).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // An unassigned project has no company to own users, modules or a 3D experience yet (Standalone Project PRD §13).
  const company = project.company;
  const tabs = company ? TABS : TABS.filter(([key]) => key === "overview" || key === "settings");
  const tab = tabs.some(([key]) => key === rawTab) ? rawTab! : "overview";
  const canManage = canPlatform(context, "platform.project.manage");
  const canAssign = !company && !project.archived && canPlatform(context, "platform.project.assign_company");
  const companyOptions = canAssign ? await projectCompanyOptions(context) : [];
  const label = tabs.find(([key]) => key === tab)![1];

  return (
    <div className="space-y-5">
      {company && from && (from === company.id || from === project.group?.id) ? <Link href={`/admin/organizations/${from}?tab=projects`} className="text-table text-fg-muted hover:text-fg" data-testid="return-to-organization">← {from === company.id ? company.name : project.group!.name}</Link> : null}
      <Breadcrumbs items={[{ label: "Projects", href: "/admin/projects" }, tab === "overview" ? { label: project.name } : { label: project.name, href: `/admin/projects/${project.id}` }, ...(tab === "overview" ? [] : [{ label }])]} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-page font-semibold text-fg">{project.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-body text-fg-muted">
            {company ? <Link href={`/admin/organizations/${company.id}`} className="text-accent-strong hover:underline">{company.name}</Link> : <AdminStatusBadge status="UNASSIGNED" />}
            <AdminStatusBadge status={project.status} />
            <span className="font-mono text-meta">{project.code}</span>
          </div>
        </div>
        {canAssign ? <AssignProjectCompany projectId={project.id} projectName={project.name} companies={companyOptions} /> : null}
        {project.threeD.configured ? <Button asChild size="sm" variant="secondary"><Link href={`/admin/3d/projects/${project.id}`}>3D administration</Link></Button> : null}
      </header>
      <nav aria-label="Project sections" className="nesto-context-tabs overflow-x-auto" data-context-tabs>
        <ul className="border-b border-line flex min-w-max gap-1">
          {tabs.map(([key, text]) => (
            <li key={key}><Link href={key === "overview" ? `/admin/projects/${project.id}` : `/admin/projects/${project.id}?tab=${key}`} scroll={false} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table", tab === key ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{text}</Link></li>
          ))}
        </ul>
      </nav>

      {tab === "overview" ? (
        <section className="nesto-card p-5" aria-label="Overview">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Managing company", company ? company.name : "Not assigned"],
              ["Parent Group", company ? (project.group?.name ?? "Standalone company") : "Inherited from the company once assigned"],
              ["Project manager", project.manager ?? "—"],
              ["Users", project.members],
              ["Units", project.units],
              ["3D", project.threeD.state],
              ["Created", formatDate(project.createdAt)],
              ["Updated", formatDate(project.updatedAt)],
            ] as const).map(([name, value]) => <div key={name}><dt className="text-meta text-fg-subtle">{name}</dt><dd className="text-body text-fg">{value}</dd></div>)}
          </dl>
          {project.description ? <p className="mt-4 text-table text-fg-muted">{project.description}</p> : null}
          {!company ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-hover p-3" data-testid="unassigned-notice">
              <p className="text-table text-fg-muted">{UNASSIGNED_PROJECT_MESSAGE} Only Platform Admin can see this project until then.</p>
              {canAssign ? <AssignProjectCompany projectId={project.id} projectName={project.name} companies={companyOptions} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {company && tab === "companies" ? (
        <section className="nesto-card p-5" aria-label="Companies">
          <h2 className="text-card font-semibold text-fg">Managing company</h2>
          <p className="mt-2 text-body"><Link href={`/admin/organizations/${company!.id}`} className="text-accent-strong hover:underline">{company!.name}</Link>{project.group ? <span className="text-fg-muted"> · {project.group.name}</span> : null}</p>
          <h2 className="mt-5 text-card font-semibold text-fg">Participating companies</h2>
          <p className="mt-2 text-table text-fg-muted">None. A NESTO project belongs to one managing company today; its people from other companies take part through their own project assignments.</p>
        </section>
      ) : null}

      {company && tab === "users" ? <UsersTab context={context} projectId={project.id} /> : null}
      {company && tab === "modules" ? <ModulesTab context={context} companyId={company.id} /> : null}

      {company && tab === "3d" ? (
        <section className="nesto-card p-5" aria-label="3D Experience">
          <h2 className="text-card font-semibold text-fg">3D Experience</h2>
          {project.threeD.configured ? (
            <>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <div><dt className="text-meta text-fg-subtle">Publishing</dt><dd><AdminStatusBadge status={project.threeD.state} /></dd></div>
                <div><dt className="text-meta text-fg-subtle">Release</dt><dd className="text-body text-fg">{project.threeD.published ? "Published" : "Not published yet"}</dd></div>
                <div><dt className="text-meta text-fg-subtle">3D Viewer entitlement</dt><dd><AdminStatusBadge status={project.threeD.entitlement?.status === "ACTIVE" && project.threeD.entitlement.viewerEnabled ? "Enabled" : "Disabled"} /></dd></div>
              </dl>
              <ul className="mt-4 divide-y divide-line text-table">
                {project.threeD.models.length === 0 ? <li className="py-2 text-fg-muted">No model uploaded yet.</li> : project.threeD.models.map((model) => (
                  <li key={`${model.fileName}-${model.version}`} className="flex flex-wrap justify-between gap-2 py-2"><span className="text-fg">{model.fileName} <span className="text-fg-subtle">· version {model.version}</span></span><span className="text-fg-muted">{model.status.toLowerCase()} · {model.bindings} unit bindings of {project.units}</span></li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm"><Link href={`/admin/3d/projects/${project.id}`}>Manage 3D</Link></Button>
                {canPlatform(context, "platform.3d.configure") ? <Button asChild size="sm" variant="secondary"><a href={`/admin/3d/projects/${project.id}/editor`} target="_blank" rel="noopener noreferrer">Experience Editor</a></Button> : null}
              </div>
            </>
          ) : (
            <div className="mt-2 space-y-3">
              <p className="text-table text-fg-muted">Not configured. Create a 3D Experience to enable the interactive Project Viewer.</p>
              {project.threeD.entitlement?.status !== "ACTIVE" ? <p className="text-table text-fg-muted">The 3D Viewer is not enabled for this Project yet. <Link href={`/admin/modules/${company!.id}?tab=projects`} className="text-accent-strong hover:underline">Manage Entitlements</Link></p> : null}
              {canPlatform(context, "platform.3d.configure") ? <Button asChild size="sm"><Link href={`/admin/3d?tab=unconfigured&q=${encodeURIComponent(project.code)}`}>Configure 3D</Link></Button> : null}
            </div>
          )}
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="nesto-card p-5" aria-label="Settings">
          <h2 className="text-card font-semibold text-fg">General</h2>
          <p className="mt-1 text-table text-fg-muted">Name, description and lifecycle. The 3D audience is set in 3D administration and never changes here.</p>
          {canManage && !project.archived ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <PlatformCommandButton label="Edit project" title={`Edit ${project.name}`} action="project.update" fixed={{ projectId: project.id }} fields={[{ name: "name", label: "Project name", type: "text", required: true }, { name: "description", label: "Description", type: "textarea" }, { name: "status", label: "Status", type: "select", required: true, options: [{ value: "PENDING", label: "Pending" }, { value: "ACTIVE", label: "Active" }, { value: "FINISHED", label: "Finished" }] }, { name: "reason", label: "Reason", type: "textarea", required: true }]} initial={{ name: project.name, description: project.description ?? "", status: project.status }} success="Project updated." />
              <PlatformCommandButton label="Archive project" title={`Archive ${project.name}?`} description="The project stops being active and its 3D experience cannot be viewed. Nothing is deleted." action="project.archive" fixed={{ projectId: project.id }} reasonOnly destructive variant="danger" submitLabel="Archive Project" success="Project archived." />
            </div>
          ) : project.archived ? <p className="mt-3 text-table text-fg-muted">This project is archived. Its records and 3D configuration are kept.</p> : null}
        </section>
      ) : null}
    </div>
  );
}

async function UsersTab({ context, projectId }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; projectId: string }) {
  const rows = await projectUsers(context, projectId);
  return (
    <section className="nesto-card overflow-hidden" aria-label="Users">
      {rows.length === 0 ? <EmptyState className="m-4" title="No users assigned yet." description="People are assigned to projects in the company workspace." /> : (
        <div className="overflow-x-auto">
          <Table stack flush aria-label="Project users">
            <TableHead><TableRow><TableHeaderCell>User</TableHeaderCell><TableHeaderCell>Role</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => <TableRow key={row.id}><TableCell><span className="font-medium text-fg">{row.name}</span>{row.primary ? <span className="ml-2 text-meta text-fg-subtle">primary</span> : null}<p className="font-mono text-micro text-fg-subtle">{row.username}</p></TableCell><TableCell>{row.role}</TableCell><TableCell><AdminStatusBadge status={row.status} /></TableCell></TableRow>)}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

async function ModulesTab({ context, companyId }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; companyId: string }) {
  const rows = await projectModules(context, companyId);
  return (
    <section className="nesto-card overflow-hidden" aria-label="Modules">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3"><p className="text-table text-fg-muted">The managing company&apos;s entitlements apply to this project.</p><Link href={`/admin/modules/${companyId}`} className="text-table font-medium text-accent-strong hover:underline">Manage Entitlements</Link></div>
      <ul className="divide-y divide-line">{rows.map((row) => <li key={row.key} className="flex items-center justify-between px-5 py-2.5 text-table"><span className="text-fg">{row.name}</span><AdminStatusBadge status={row.enabled ? "Enabled" : "Disabled"} /></li>)}</ul>
    </section>
  );
}
