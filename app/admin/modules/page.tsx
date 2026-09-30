import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { OrganizationFilters } from "@/components/platform/organization-filters";
import { EmptyState, NoResultsState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { entitlementDirectory, listEntitlementPlans, moduleCatalog, moduleHolders } from "@/lib/modules/entitlements/entitlement.service";
import { organizationGroupOptions } from "@/lib/modules/platform/platform-organizations.query";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Modules" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * What each customer may use (Admin Modules PRD #4 §2, §9-§12, §35, §36):
 * By Organization answers "what does this company have?", By Module "who has
 * this module?". Both live in the address.
 */
export default async function ModulesPage({ searchParams }: Props) {
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const context = await requirePlatformContext();
  const view = raw.view === "module" ? "module" : "organization";
  const tab = (value: string, label: string) => (
    <li>
      <Link href={value === "organization" ? "/admin/modules" : "/admin/modules?view=module"} aria-current={view === value ? "page" : undefined} className={cn("-mb-px flex h-10 items-center border-b-2 px-3 text-table transition-colors", view === value ? "border-accent font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg")}>{label}</Link>
    </li>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Modules" description="Manage NESTO functionality and customer entitlements." actions={<Link href="/admin/modules/catalog" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-table font-medium text-fg hover:bg-hover">Manage Catalog</Link>} />
      <nav aria-label="Views" className="nesto-context-tabs" data-context-tabs><ul className="border-b border-line flex gap-1">{tab("organization", "By Organization")}{tab("module", "By Module")}</ul></nav>
      {view === "organization" ? <ByOrganization context={context} raw={raw} /> : <ByModule context={context} moduleKey={typeof raw.module === "string" ? raw.module : ""} />}
    </div>
  );
}

async function ByOrganization({ context, raw }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; raw: Record<string, string | undefined> }) {
  const [result, groups, plans] = await Promise.all([entitlementDirectory(context, raw), organizationGroupOptions(context), listEntitlementPlans(context)]);
  const { rows, query, total, pages } = result;
  const filtered = Boolean(query.q || query.plan || query.group || query.status);
  const page = (number: number) => {
    const params = new URLSearchParams(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "page"));
    if (number > 1) params.set("page", String(number));
    return `/admin/modules${params.size ? `?${params}` : ""}`;
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <OrganizationFilters statuses={[{ value: "ACTIVE", label: "Active" }, { value: "SUSPENDED", label: "Suspended" }, { value: "INACTIVE", label: "Inactive" }]} groups={groups} showGroup placeholder="Search companies..." />
        <PlanFilter plans={plans.map((plan) => ({ value: plan.id, label: plan.name }))} current={query.plan} raw={raw} />
      </div>
      <section className="nesto-card overflow-hidden" data-testid="entitlement-directory">
        {rows.length === 0 ? (
          filtered ? <NoResultsState className="m-4" noun="companies" clearHref="/admin/modules" /> : <EmptyState className="m-4" title="No Companies found." description="Create a Company before assigning modules." />
        ) : (
          <div className="overflow-x-auto">
            <Table flush aria-label="Company entitlements">
              <TableHead><TableRow><TableHeaderCell>Company</TableHeaderCell><TableHeaderCell className="max-md:hidden">Parent Group</TableHeaderCell><TableHeaderCell>Plan</TableHeaderCell><TableHeaderCell>Modules</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Projects</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell><Link href={`/admin/modules/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                    <TableCell className="max-md:hidden">{row.parentGroup?.name ?? "Standalone"}</TableCell>
                    <TableCell>{row.plan}</TableCell>
                    <TableCell className="tabular-nums">{row.modules} enabled{row.trials ? <span className="text-meta text-fg-subtle"> · {row.trials} trial</span> : null}</TableCell>
                    <TableCell className="tabular-nums max-sm:hidden">{row.projects}</TableCell>
                    <TableCell><AdminStatusBadge status={row.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {total > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-table text-fg-muted">
            <span>{total} {total === 1 ? "company" : "companies"}</span>
            {pages > 1 ? <span className="flex gap-2">{query.page > 1 ? <Link href={page(query.page - 1)}>Previous</Link> : null}<span>Page {query.page} of {pages}</span>{query.page < pages ? <Link href={page(query.page + 1)}>Next</Link> : null}</span> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function PlanFilter({ plans, current, raw }: { plans: Array<{ value: string; label: string }>; current: string; raw: Record<string, string | undefined> }) {
  const link = (value: string) => {
    const params = new URLSearchParams(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "plan" && entry[0] !== "page"));
    if (value) params.set("plan", value);
    return `/admin/modules${params.size ? `?${params}` : ""}`;
  };
  const options = [{ value: "", label: "Any plan" }, ...plans, { value: "custom", label: "Custom" }];
  return (
    <nav aria-label="Plan" className="flex flex-wrap gap-1">
      {options.map((option) => (
        <Link key={option.value || "any"} href={link(option.value)} aria-current={current === option.value ? "true" : undefined} className={cn("rounded-full border px-2.5 py-1 text-meta", current === option.value ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:bg-hover")}>{option.label}</Link>
      ))}
    </nav>
  );
}

async function ByModule({ context, moduleKey }: { context: Awaited<ReturnType<typeof requirePlatformContext>>; moduleKey: string }) {
  const catalog = await moduleCatalog(context);
  const selected = catalog.modules.find((row) => row.key === moduleKey && row.scope === "Company");
  const holders = selected ? await moduleHolders(context, selected.key) : [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section className="nesto-card overflow-hidden" aria-label="Modules">
        <ul className="divide-y divide-line">
          {catalog.modules.map((row) => {
            const active = row.key === moduleKey;
            const text = row.scope === "Required" ? "Required · every company" : row.scope === "Project" ? `${row.enabled} ${row.enabled === 1 ? "project" : "projects"} enabled` : `${row.enabled} of ${catalog.companies} companies`;
            return (
              <li key={row.key}>
                {row.scope === "Company" ? (
                  <Link href={`/admin/modules?view=module&module=${row.key}`} aria-current={active ? "true" : undefined} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover/50", active && "bg-accent-soft/50")}>
                    <span className="font-medium text-fg">{row.name}</span><span className="text-meta text-fg-subtle">{text}</span>
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5"><span className="text-fg">{row.name}</span><span className="text-meta text-fg-subtle">{text}{row.scope === "Project" ? <> · <Link href="/admin/3d" className="text-accent-strong hover:underline">3D</Link></> : null}</span></div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="nesto-card overflow-hidden" aria-label={selected ? `${selected.name} holders` : "Module holders"}>
        {!selected ? (
          <p className="p-5 text-table text-fg-muted">Choose a module to see the companies that have it.</p>
        ) : holders.length === 0 ? (
          <EmptyState className="m-4" title="No Companies currently use this module." />
        ) : (
          <div className="overflow-x-auto">
            <Table flush aria-label={`${selected.name} companies`}>
              <TableHead><TableRow><TableHeaderCell>Company</TableHeaderCell><TableHeaderCell className="max-md:hidden">Group</TableHeaderCell><TableHeaderCell>Plan</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell className="max-sm:hidden">Since</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {holders.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell><Link href={`/admin/modules/${row.id}`} className="font-medium text-fg hover:underline">{row.name}</Link></TableCell>
                    <TableCell className="max-md:hidden">{row.group ?? "Standalone"}</TableCell>
                    <TableCell>{row.plan}</TableCell>
                    <TableCell><AdminStatusBadge status={row.state} /></TableCell>
                    <TableCell className="max-sm:hidden">{row.since ? formatDate(row.since) : "—"}</TableCell>
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
