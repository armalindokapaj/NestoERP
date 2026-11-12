import Link from "@/components/navigation/nav-link";
import { AdminChoice, AdminListFoot, AdminListFrame, AdminToolbar } from "@/components/platform/admin-list";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { LinkRow } from "@/components/platform/link-row";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { PlatformCommandButton } from "@/components/platform/platform-command";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { listProjectsDirectory, projectCompanyOptions } from "@/lib/modules/platform/platform-projects.query";
import { organizationGroupOptions } from "@/lib/modules/platform/platform-organizations.query";
import { getTranslations } from "@/lib/i18n/server";
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
      saveKind="create"
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

  const threeDName = (value: (typeof THREE_D)[number]) => (value === "" ? t("projects.anyThreeD") : value === "configured" ? t("threeD.configured") : threeDLabel(t, value === "none" ? "Not configured" : value));
  const words = { pages: t("common.pages"), previous: t("common.previous"), next: t("common.next"), pageOf: t("common.pageOf", { page: query.page, pages }) };

  return (
    <div className="space-y-4">
      <PageHeader title={t("projects.title")} description={t("projects.description")} actions={create} />
      <AdminToolbar>
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: t("projects.statuses.ACTIVE") }, { value: "PENDING", label: t("projects.statuses.PENDING") }, { value: "FINISHED", label: t("projects.statuses.FINISHED") }, { value: "ARCHIVED", label: t("projects.statuses.ARCHIVED") }]} groups={groups} showGroup placeholder={t("common.searchProjects")} />
        <AdminChoice
          label={t("projects.ownershipNav")}
          testId="ownership-filter"
          options={([["", t("projects.ownership.all")], ["assigned", t("projects.ownership.assigned")], ["unassigned", t("projects.ownership.unassigned")]] as const).map(([value, label]) => ({ key: value, label, href: link({ ownership: value, page: "1" }), active: query.ownership === value }))}
        />
        <AdminChoice label={t("projects.threeDNav")} options={THREE_D.map((value) => ({ key: value, label: threeDName(value), href: link({ three: value, page: "1" }), active: query.three === value }))} />
      </AdminToolbar>
      <AdminListFrame
        label={t("projects.title")}
        testId="project-directory"
        empty={rows.length === 0 ? (filtered ? <NoResultsState className="m-4" noun={t("projects.noun")} clearHref="/admin/projects" /> : (
          <EmptyState className="m-4" title={t("projects.emptyTitle")} description={companies.length ? t("projects.emptyWithCompany") : t("projects.emptyNoCompany")} action={companies.length && canCreate ? { label: t("projects.create.label"), href: "/admin/projects?create=project" } : undefined} />
        )) : undefined}
        lines={rows.map((row) => ({
          href: `/admin/projects/${row.id}`,
          title: row.name,
          subtitle: [row.company?.name ?? t("projects.ownership.unassigned"), row.group?.name].filter(Boolean).join(" · "),
          status: <AdminStatusBadge status={row.status} />,
          facts: [{ key: "code", label: t("common.code"), value: row.code }, { key: "threeD", label: t("projects.headers.threeD"), value: `3D ${threeDLabel(t, row.threeD)}` }],
          data: { "data-testid": "project-line" },
        }))}
        table={
          <Table aria-label={t("projects.title")}>
            <TableHead><TableRow><TableHeaderCell>{t("projects.headers.project")}</TableHeaderCell><TableHeaderCell>{t("projects.headers.company")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("projects.headers.group")}</TableHeaderCell><TableHeaderCell className="max-xl:hidden">{t("projects.headers.modules")}</TableHeaderCell><TableHeaderCell>{t("projects.headers.threeD")}</TableHeaderCell><TableHeaderCell>{t("projects.headers.status")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.id} href={`/admin/projects/${row.id}`} data-testid="project-row">
                  <TableCell><Link href={`/admin/projects/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link><p className="font-mono text-micro text-fg-subtle">{row.code}</p></TableCell>
                  <TableCell>{row.company ? <Link href={`/admin/organizations/${row.company.id}`} className="text-fg-muted hover:underline">{row.company.name}</Link> : <AdminStatusBadge status="UNASSIGNED" />}</TableCell>
                  <TableCell className="max-lg:hidden">{row.group ? <Link href={`/admin/organizations/${row.group.id}`} className="text-fg-muted hover:underline">{row.group.name}</Link> : "—"}</TableCell>
                  <TableCell className="tabular-nums max-xl:hidden">{row.modules ?? "—"}</TableCell>
                  <TableCell>{row.threeD === "Not configured" ? <AdminStatusBadge status={row.threeD} /> : <Link href={`/admin/3d/projects/${row.id}`} aria-label={t("projects.threeDLink", { state: threeDLabel(t, row.threeD), name: row.name })}><AdminStatusBadge status={row.threeD} /></Link>}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </Table>
        }
        foot={total > 0 ? <AdminListFoot count={t("projects.total", { count: total })} page={query.page} pages={pages} previousHref={link({ page: String(query.page - 1) })} nextHref={link({ page: String(query.page + 1) })} words={words} /> : undefined}
      />
    </div>
  );
}
