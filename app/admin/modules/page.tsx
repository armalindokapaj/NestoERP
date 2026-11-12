import Link from "@/components/navigation/nav-link";
import { AdminChoice, AdminListFoot, AdminListFrame, AdminTabs, AdminToolbar } from "@/components/platform/admin-list";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { LinkRow } from "@/components/platform/link-row";
import { Button } from "@/components/ui/button";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { formatDate } from "@/lib/i18n/format";
import { entitlementDirectory, listEntitlementPlans, moduleCatalog, moduleHolders } from "@/lib/modules/entitlements/entitlement.service";
import { organizationGroupOptions } from "@/lib/modules/platform/platform-organizations.query";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.modules") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * What each customer may use (Admin Modules PRD #4 §2, §9-§12, §35, §36):
 * By Organization answers "what does this company have?", By Module "who has
 * this module?". Both live in the address.
 */
export default async function ModulesPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const t = await getTranslations("adminOrgs");
  const context = await requirePlatformContext();
  const view = raw.view === "module" ? "module" : "organization";
  return (
    <div className="space-y-4">
      <PageHeader title={t("modules.title")} description={t("modules.description")} actions={<Button asChild variant="secondary"><Link href="/admin/modules/catalog">{t("modules.manageCatalog")}</Link></Button>} />
      <AdminTabs
        label={t("modules.viewsNav")}
        tabs={[
          { key: "organization", label: t("modules.byOrganization"), href: "/admin/modules", active: view === "organization" },
          { key: "module", label: t("modules.byModule"), href: "/admin/modules?view=module", active: view === "module" },
        ]}
      />
      {view === "organization" ? <ByOrganization context={context} raw={raw} /> : <ByModule context={context} moduleKey={typeof raw.module === "string" ? raw.module : ""} />}
    </div>
  );
}

async function ByOrganization({ context, raw }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; raw: Record<string, string | undefined> }) {
  const t = await getTranslations("adminOrgs");
  const [result, groups, plans] = await Promise.all([entitlementDirectory(context, raw), organizationGroupOptions(context), listEntitlementPlans(context)]);
  const { rows, query, total, pages } = result;
  const filtered = Boolean(query.q || query.plan || query.group || query.status);
  const page = (number: number) => {
    const params = new URLSearchParams(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "page"));
    if (number > 1) params.set("page", String(number));
    return `/admin/modules${params.size ? `?${params}` : ""}`;
  };
  const words = { pages: t("common.pages"), previous: t("common.previous"), next: t("common.next"), pageOf: t("common.pageOf", { page: query.page, pages }) };
  const modulesText = (row: (typeof rows)[number]) => `${t("modules.enabled", { count: row.modules })}${row.trials ? ` · ${t("modules.trial", { count: row.trials })}` : ""}`;
  return (
    <>
      <AdminToolbar>
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: t("modules.statuses.ACTIVE") }, { value: "SUSPENDED", label: t("modules.statuses.SUSPENDED") }, { value: "INACTIVE", label: t("modules.statuses.INACTIVE") }]} groups={groups} showGroup placeholder={t("modules.searchCompanies")} />
        <PlanFilter plans={plans.map((plan) => ({ value: plan.id, label: plan.name }))} current={query.plan} raw={raw} t={t} />
      </AdminToolbar>
      <AdminListFrame
        label={t("modules.tableLabel")}
        testId="entitlement-directory"
        empty={rows.length === 0 ? (filtered ? <NoResultsState className="m-4" noun={t("modules.noun")} clearHref="/admin/modules" /> : <EmptyState className="m-4" title={t("modules.emptyTitle")} description={t("modules.emptyBody")} />) : undefined}
        lines={rows.map((row) => ({
          href: `/admin/modules/${row.id}`,
          title: row.name,
          subtitle: [row.plan, row.parentGroup?.name ?? t("modules.standalone")].join(" · "),
          status: <AdminStatusBadge status={row.status} />,
          facts: [{ key: "modules", label: t("modules.headers.modules"), value: modulesText(row) }],
        }))}
        table={
          <Table aria-label={t("modules.tableLabel")}>
            <TableHead><TableRow><TableHeaderCell>{t("modules.headers.company")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("modules.headers.parentGroup")}</TableHeaderCell><TableHeaderCell>{t("modules.headers.plan")}</TableHeaderCell><TableHeaderCell>{t("modules.headers.modules")}</TableHeaderCell><TableHeaderCell className="max-lg:hidden">{t("modules.headers.projects")}</TableHeaderCell><TableHeaderCell>{t("modules.headers.status")}</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {rows.map((row) => (
                <LinkRow key={row.id} href={`/admin/modules/${row.id}`}>
                  <TableCell><Link href={`/admin/modules/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                  <TableCell className="max-lg:hidden">{row.parentGroup?.name ?? t("modules.standalone")}</TableCell>
                  <TableCell>{row.plan}</TableCell>
                  <TableCell className="tabular-nums">{modulesText(row)}</TableCell>
                  <TableCell className="tabular-nums max-lg:hidden">{row.projects}</TableCell>
                  <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </Table>
        }
        foot={total > 0 ? <AdminListFoot count={t("modules.total", { count: total })} page={query.page} pages={pages} previousHref={page(query.page - 1)} nextHref={page(query.page + 1)} words={words} /> : undefined}
      />
    </>
  );
}

function PlanFilter({ plans, current, raw, t }: { plans: Array<{ value: string; label: string }>; current: string; raw: Record<string, string | undefined>; t: Translate<"adminOrgs"> }) {
  const link = (value: string) => {
    const params = new URLSearchParams(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "plan" && entry[0] !== "page"));
    if (value) params.set("plan", value);
    return `/admin/modules${params.size ? `?${params}` : ""}`;
  };
  const options = [{ value: "", label: t("modules.anyPlan") }, ...plans, { value: "custom", label: t("modules.customPlan") }];
  return <AdminChoice label={t("modules.planNav")} options={options.map((option) => ({ key: option.value, label: option.label, href: link(option.value), active: current === option.value }))} />;
}

async function ByModule({ context, moduleKey }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; moduleKey: string }) {
  const locale = await getLocale();
  const t = await getTranslations("adminOrgs");
  const catalog = await moduleCatalog(context);
  const selected = catalog.modules.find((row) => row.key === moduleKey && row.scope === "Company");
  const holders = selected ? await moduleHolders(context, selected.key) : [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="border border-line-strong bg-surface" aria-label={t("modules.listLabel")}>
        <ul className="divide-y divide-line">
          {catalog.modules.map((row) => {
            const active = row.key === moduleKey;
            const text = row.scope === "Required" ? t("modules.requiredEveryCompany") : row.scope === "Project" ? t("modules.projectsEnabled", { count: row.enabled }) : t("modules.ofCompanies", { enabled: row.enabled, companies: catalog.companies });
            return (
              <li key={row.key}>
                {row.scope === "Company" ? (
                  <Link href={`/admin/modules?view=module&module=${row.key}`} aria-current={active ? "true" : undefined} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover", active && "bg-hover shadow-[inset_2px_0_0_var(--nesto-accent)]")}>
                    <span className="font-medium text-fg">{row.name}</span><span className="text-meta text-fg-subtle">{text}</span>
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="text-fg">{row.name}</span><span className="text-meta text-fg-subtle">{text}{row.scope === "Project" ? <> · <Link href="/admin/3d" className="text-accent-strong hover:underline">{t("modules.threeD")}</Link></> : null}</span></div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="min-w-0 border border-line-strong bg-surface" aria-label={selected ? t("modules.holders", { name: selected.name }) : t("modules.moduleHolders")}>
        {!selected ? (
          <p className="p-5 text-table text-fg-muted">{t("modules.chooseModule")}</p>
        ) : holders.length === 0 ? (
          <EmptyState className="m-4" title={t("modules.noHolders")} />
        ) : (
          <div className="overflow-x-auto">
            <Table aria-label={t("modules.holdersTable", { name: selected.name })}>
              <TableHead><TableRow><TableHeaderCell>{t("modules.holderHeaders.company")}</TableHeaderCell><TableHeaderCell className="max-md:hidden">{t("modules.holderHeaders.group")}</TableHeaderCell><TableHeaderCell>{t("modules.holderHeaders.plan")}</TableHeaderCell><TableHeaderCell>{t("modules.holderHeaders.status")}</TableHeaderCell><TableHeaderCell className="max-sm:hidden">{t("modules.holderHeaders.since")}</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {holders.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell><Link href={`/admin/modules/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                    <TableCell className="max-md:hidden">{row.group ?? t("modules.standalone")}</TableCell>
                    <TableCell>{row.plan}</TableCell>
                    <TableCell><AdminStatusBadge status={row.state} /></TableCell>
                    <TableCell className="max-sm:hidden">{row.since ? formatDate(row.since, locale) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
