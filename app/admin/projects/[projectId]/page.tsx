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
import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";
import { threeDLabel } from "../../organizations/_detail/labels";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.project") };
}

type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string; from?: string }> };
const TABS = [["overview", "project.tabs.overview"], ["companies", "project.tabs.companies"], ["users", "project.tabs.users"], ["modules", "project.tabs.modules"], ["3d", "project.tabs.threeD"], ["settings", "project.tabs.settings"]] as const;

/**
 * A canonical project's Platform Admin page (Admin Projects & 3D PRD #5
 * §12-§18, §63, §64). The 3D tab summarizes its experience and links into 3D
 * administration; its business records stay in the tenant workspace.
 */
export default async function PlatformProjectPage({ params, searchParams }: Props) {
  const [{ projectId }, { tab: rawTab, from }] = await Promise.all([params, searchParams]);
  const t = await getTranslations("adminOrgs");
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
  const label = t(tabs.find(([key]) => key === tab)![1]);

  return (
    <div className="space-y-5">
      {company && from && (from === company.id || from === project.group?.id) ? <Link href={`/admin/organizations/${from}?tab=projects`} className="text-table text-fg-muted hover:text-fg" data-testid="return-to-organization">← {from === company.id ? company.name : project.group!.name}</Link> : null}
      <Breadcrumbs items={[{ label: t("meta.projects"), href: "/admin/projects" }, tab === "overview" ? { label: project.name } : { label: project.name, href: `/admin/projects/${project.id}` }, ...(tab === "overview" ? [] : [{ label }])]} />
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
        {project.threeD.configured ? <Button asChild size="sm" variant="secondary"><Link href={`/admin/3d/projects/${project.id}`}>{t("project.admin3d")}</Link></Button> : null}
      </header>
      <nav aria-label={t("project.sectionsNav")} className="nesto-context-tabs overflow-x-auto" data-context-tabs>
        <ul className="border-b border-line flex min-w-max gap-1">
          {tabs.map(([key, text]) => (
            <li key={key}><Link href={key === "overview" ? `/admin/projects/${project.id}` : `/admin/projects/${project.id}?tab=${key}`} scroll={false} aria-current={tab === key ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table", tab === key ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{t(text)}</Link></li>
          ))}
        </ul>
      </nav>

      {tab === "overview" ? (
        <section className="nesto-card p-5" aria-label={t("project.tabs.overview")}>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              [t("project.managingCompany"), company ? company.name : t("project.notAssigned")],
              [t("project.parentGroup"), company ? (project.group?.name ?? t("project.standaloneCompany")) : t("project.inherited")],
              [t("project.projectManager"), project.manager ?? "—"],
              [t("project.usersLabel"), project.members],
              [t("project.units"), project.units],
              [t("project.threeD"), threeDLabel(t, project.threeD.state)],
              [t("project.created"), formatDate(project.createdAt)],
              [t("project.updated"), formatDate(project.updatedAt)],
            ] as const).map(([name, value]) => <div key={name}><dt className="text-meta text-fg-subtle">{name}</dt><dd className="text-body text-fg">{value}</dd></div>)}
          </dl>
          {project.description ? <p className="mt-4 text-table text-fg-muted">{project.description}</p> : null}
          {!company ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-hover p-3" data-testid="unassigned-notice">
              <p className="text-table text-fg-muted">{t("project.unassignedNotice", { message: t("project.unassignedMessage") })}</p>
              {canAssign ? <AssignProjectCompany projectId={project.id} projectName={project.name} companies={companyOptions} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {company && tab === "companies" ? (
        <section className="nesto-card p-5" aria-label={t("project.tabs.companies")}>
          <h2 className="text-card font-semibold text-fg">{t("project.managingCompany")}</h2>
          <p className="mt-2 text-body"><Link href={`/admin/organizations/${company!.id}`} className="text-accent-strong hover:underline">{company!.name}</Link>{project.group ? <span className="text-fg-muted"> · {project.group.name}</span> : null}</p>
          <h2 className="mt-5 text-card font-semibold text-fg">{t("project.participating")}</h2>
          <p className="mt-2 text-table text-fg-muted">{t("project.participatingNone")}</p>
        </section>
      ) : null}

      {company && tab === "users" ? <UsersTab context={context} projectId={project.id} /> : null}
      {company && tab === "modules" ? <ModulesTab context={context} companyId={company.id} /> : null}

      {company && tab === "3d" ? (
        <section className="nesto-card p-5" aria-label={t("project.experience")}>
          <h2 className="text-card font-semibold text-fg">{t("project.experience")}</h2>
          {project.threeD.configured ? (
            <>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <div><dt className="text-meta text-fg-subtle">{t("project.publishing")}</dt><dd><AdminStatusBadge status={project.threeD.state} /></dd></div>
                <div><dt className="text-meta text-fg-subtle">{t("project.release")}</dt><dd className="text-body text-fg">{project.threeD.published ? t("project.published") : t("project.notPublished")}</dd></div>
                <div><dt className="text-meta text-fg-subtle">{t("project.viewerEntitlement")}</dt><dd><AdminStatusBadge status={project.threeD.entitlement?.status === "ACTIVE" && project.threeD.entitlement.viewerEnabled ? "Enabled" : "Disabled"} /></dd></div>
              </dl>
              <ul className="mt-4 divide-y divide-line text-table">
                {project.threeD.models.length === 0 ? <li className="py-2 text-fg-muted">{t("project.noModel")}</li> : project.threeD.models.map((model) => (
                  <li key={`${model.fileName}-${model.version}`} className="flex flex-wrap justify-between gap-2 py-2"><span className="text-fg">{model.fileName} <span className="text-fg-subtle">· {t("project.version", { version: model.version })}</span></span><span className="text-fg-muted">{t("project.modelLine", { status: model.status.toLowerCase(), bindings: model.bindings, units: project.units })}</span></li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm"><Link href={`/admin/3d/projects/${project.id}`}>{t("project.manage3d")}</Link></Button>
                {canPlatform(context, "platform.3d.configure") ? <Button asChild size="sm" variant="secondary"><a href={`/admin/3d/projects/${project.id}/editor`} target="_blank" rel="noopener noreferrer">{t("project.editor")}</a></Button> : null}
              </div>
            </>
          ) : (
            <div className="mt-2 space-y-3">
              <p className="text-table text-fg-muted">{t("project.notConfigured")}</p>
              {project.threeD.entitlement?.status !== "ACTIVE" ? (() => { const [before, after] = t("project.viewerNotEnabled", { link: "\u0001" }).split("\u0001"); return <p className="text-table text-fg-muted">{before}<Link href={`/admin/modules/${company!.id}?tab=projects`} className="text-accent-strong hover:underline">{t("project.manageEntitlements")}</Link>{after}</p>; })() : null}
              {canPlatform(context, "platform.3d.configure") ? <Button asChild size="sm"><Link href={`/admin/3d?tab=unconfigured&q=${encodeURIComponent(project.code)}`}>{t("project.configure3d")}</Link></Button> : null}
            </div>
          )}
        </section>
      ) : null}

      {tab === "settings" ? (
        <section className="nesto-card p-5" aria-label={t("project.tabs.settings")}>
          <h2 className="text-card font-semibold text-fg">{t("project.settings.general")}</h2>
          <p className="mt-1 text-table text-fg-muted">{t("project.settings.description")}</p>
          {canManage && !project.archived ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <PlatformCommandButton label={t("project.settings.editLabel")} title={t("project.settings.editTitle", { name: project.name })} action="project.update" fixed={{ projectId: project.id }} fields={[{ name: "name", label: t("common.projectName"), type: "text", required: true }, { name: "description", label: t("common.description"), type: "textarea" }, { name: "status", label: t("project.settings.statusField"), type: "select", required: true, options: [{ value: "PENDING", label: t("projects.statuses.PENDING") }, { value: "ACTIVE", label: t("projects.statuses.ACTIVE") }, { value: "FINISHED", label: t("projects.statuses.FINISHED") }] }, { name: "reason", label: t("common.reason"), type: "textarea", required: true }]} initial={{ name: project.name, description: project.description ?? "", status: project.status }} success={t("project.settings.updated")} />
              <PlatformCommandButton label={t("project.settings.archiveLabel")} title={t("project.settings.archiveTitle", { name: project.name })} description={t("project.settings.archiveDescription")} action="project.archive" fixed={{ projectId: project.id }} reasonOnly destructive variant="danger" submitLabel={t("project.settings.archiveSubmit")} success={t("project.settings.archived")} />
            </div>
          ) : project.archived ? <p className="mt-3 text-table text-fg-muted">{t("project.settings.archivedNote")}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

async function UsersTab({ context, projectId }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; projectId: string }) {
  const t = await getTranslations("adminOrgs");
  const rows = await projectUsers(context, projectId);
  return (
    <section className="nesto-card overflow-hidden" aria-label={t("project.tabs.users")}>
      {rows.length === 0 ? <EmptyState className="m-4" title={t("project.users.emptyTitle")} description={t("project.users.emptyBody")} /> : (
        <div className="overflow-x-auto">
          <Table stack flush aria-label={t("project.users.label")}>
            <TableHead><TableRow><TableHeaderCell>{t("project.users.user")}</TableHeaderCell><TableHeaderCell>{t("common.role")}</TableHeaderCell><TableHeaderCell>{t("common.status")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => <TableRow key={row.id}><TableCell><span className="font-medium text-fg">{row.name}</span>{row.primary ? <span className="ml-2 text-meta text-fg-subtle">{t("project.users.primary")}</span> : null}<p className="font-mono text-micro text-fg-subtle">{row.username}</p></TableCell><TableCell>{row.role}</TableCell><TableCell><AdminStatusBadge status={row.status} /></TableCell></TableRow>)}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

async function ModulesTab({ context, companyId }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; companyId: string }) {
  const t = await getTranslations("adminOrgs");
  const rows = await projectModules(context, companyId);
  return (
    <section className="nesto-card overflow-hidden" aria-label={t("project.tabs.modules")}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3"><p className="text-table text-fg-muted">{t("project.modulesTab.note")}</p><Link href={`/admin/modules/${companyId}`} className="text-table font-medium text-accent-strong hover:underline">{t("project.modulesTab.manage")}</Link></div>
      <ul className="divide-y divide-line">{rows.map((row) => <li key={row.key} className="flex items-center justify-between px-5 py-2.5 text-table"><span className="text-fg">{row.name}</span><AdminStatusBadge status={row.enabled ? "Enabled" : "Disabled"} /></li>)}</ul>
    </section>
  );
}
