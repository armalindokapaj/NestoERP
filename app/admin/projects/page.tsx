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
import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";
import { threeDLabel } from "../organizations/_detail/labels";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.projects") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const THREE_D = ["", "configured", "none", "PUBLIC", "COMPANY_ONLY", "PRIVATE", "OFFLINE"] as const;

/**
 * Every canonical project on NESTO (Admin Projects & 3D PRD #5 §5-§10): search
 * by project, company or group; filter by status, group and 3D; paged on the
 * server. A project's 3D state is shown apart from its lifecycle.
 */
export default async function ProjectsPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const t = await getTranslations("adminOrgs");
  const context = await requirePlatformContext();
  const [result, companies, groups] = await Promise.all([listProjectsDirectory(context, raw), projectCompanyOptions(context), organizationGroupOptions(context)]);
  const { rows, query, total, pages } = result;
  const filtered = Boolean(query.q || query.company || query.group || query.status || query.three || query.ownership);
  const link = (changes: Record<string, string>) => {
    const params = new URLSearchParams(Object.entries({ ...raw, ...changes }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "" && !(entry[0] === "page" && entry[1] === "1")));
    return `/admin/projects${params.size ? `?${params}` : ""}`;
  };
  const canUnassigned = canPlatform(context, "platform.project.create_unassigned");
  const canCreate = canPlatform(context, "platform.project.manage") || canUnassigned;
  const create = canCreate ? (
    <PlatformCommandButton
      label={t("projects.create.label")}
      title={t("projects.create.title")}
      description={t("projects.create.description")}
      action="project.create"
      openOnCreate="project"
      variant="primary"
      success={t("common.projectCreated")}
      fields={[
        { name: "name", label: t("common.projectName"), type: "text", required: true },
        { name: "companyId", label: t("projects.create.company"), type: "select", required: !canUnassigned, emptyLabel: canUnassigned ? t("projects.create.unassigned") : undefined, options: companies },
        { name: "code", label: t("common.code"), type: "text", hint: t("projects.create.codeHint") },
      ]}
      redirectTo="/admin/projects/{id}"
    />
  ) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title={t("projects.title")} description={t("projects.description")} actions={create} />
      <div className="flex flex-wrap items-center gap-2">
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: t("projects.statuses.ACTIVE") }, { value: "PENDING", label: t("projects.statuses.PENDING") }, { value: "FINISHED", label: t("projects.statuses.FINISHED") }, { value: "ARCHIVED", label: t("projects.statuses.ARCHIVED") }]} groups={groups} showGroup placeholder={t("common.searchProjects")} />
        <nav aria-label={t("projects.ownershipNav")} className="flex flex-wrap gap-1" data-testid="ownership-filter">
          {([["", t("projects.ownership.all")], ["assigned", t("projects.ownership.assigned")], ["unassigned", t("projects.ownership.unassigned")]] as const).map(([value, label]) => (
            <Link key={value || "all"} href={link({ ownership: value, page: "1" })} replace aria-current={query.ownership === value ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-meta", query.ownership === value ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:bg-hover")}>{label}</Link>
          ))}
        </nav>
        <nav aria-label={t("projects.threeDNav")} className="flex flex-wrap gap-1">
          {THREE_D.map((value) => (
            <Link key={value || "any"} href={link({ three: value, page: "1" })} replace aria-current={query.three === value ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-meta", query.three === value ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:bg-hover")}>{value === "" ? t("projects.anyThreeD") : value === "configured" ? t("threeD.configured") : threeDLabel(t, value === "none" ? "Not configured" : value)}</Link>
          ))}
        </nav>
      </div>
      <section className="nesto-card overflow-hidden" data-testid="project-directory">
        {rows.length === 0 ? (
          filtered ? <NoResultsState className="m-4" noun={t("projects.noun")} clearHref="/admin/projects" /> : (
            <EmptyState className="m-4" title={t("projects.emptyTitle")} description={companies.length ? t("projects.emptyWithCompany") : t("projects.emptyNoCompany")} action={companies.length && canCreate ? { label: t("projects.create.label"), href: "/admin/projects?create=project" } : undefined} />
          )
        ) : (
          <div className="overflow-x-auto">
            <Table stack aria-label={t("projects.title")}>
              <TableHead><TableRow><TableHeaderCell>{t("projects.headers.project")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("projects.headers.company")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("projects.headers.group")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("projects.headers.modules")}</TableHeaderCell><TableHeaderCell>{t("projects.headers.threeD")}</TableHeaderCell><TableHeaderCell>{t("projects.headers.status")}</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="project-row">
                    <TableCell><Link href={`/admin/projects/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                    <TableCell className="max-sm:hidden">{row.company ? <Link href={`/admin/organizations/${row.company.id}`} className="text-fg-muted hover:underline">{row.company.name}</Link> : <AdminStatusBadge status="UNASSIGNED" />}</TableCell>
                    <TableCell className="max-lg:hidden">{row.group ? <Link href={`/admin/organizations/${row.group.id}`} className="text-fg-muted hover:underline">{row.group.name}</Link> : "—"}</TableCell>
                    <TableCell className="tabular-nums max-md:hidden">{row.modules ?? "—"}</TableCell>
                    <TableCell>{row.threeD === "Not configured" ? <AdminStatusBadge status={row.threeD} /> : <Link href={`/admin/3d/projects/${row.id}`} aria-label={t("projects.threeDLink", { state: threeDLabel(t, row.threeD), name: row.name })}><AdminStatusBadge status={row.threeD} /></Link>}</TableCell>
                    <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-table text-fg-muted">
            <span>{t("projects.total", { count: total })}</span>
            {pages > 1 ? <nav aria-label={t("common.pages")} className="flex gap-2">{query.page > 1 ? <Link href={link({ page: String(query.page - 1) })}>{t("common.previous")}</Link> : null}<span>{t("common.pageOf", { page: query.page, pages })}</span>{query.page < pages ? <Link href={link({ page: String(query.page + 1) })}>{t("common.next")}</Link> : null}</nav> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
