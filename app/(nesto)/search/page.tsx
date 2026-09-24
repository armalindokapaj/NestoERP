import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { SearchX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchPageField } from "@/components/search/search-page-field";
import { CompanyRecordLink } from "@/components/workspace/company-record-link";
import { CompanyTag } from "@/components/workspace/company-tag";
import { modules, type ModuleKey } from "@/config/modules";
import { inGroupWorkspace } from "@/config/workspace";
import { requireUserContext } from "@/lib/context/current-user";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { globalSearchForWorkspace } from "@/lib/core/search/search.service";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Search" };

/**
 * The dedicated search page (PRD #26 §12, §166).
 *
 * A server component on purpose. The API route exists for the command palette,
 * but a page that renders its own results cannot drift from what the services
 * authorise — it calls `globalSearchForWorkspace` directly, so every result on screen has
 * been through the same company, module, permission and scope checks as the
 * module's own list.
 *
 * Results are grouped by module because that is how somebody reads them: "four
 * contracts and one purchase order" is an answer, one flat list of nineteen
 * things is not.
 *
 * In the Group workspace the same page searches every company the person may
 * use (Workspace Context §40, §99): each company-scoped result names its
 * company and opens through the enter-company hop, because a record's page is
 * a company page. The company chips are a filter, not a workspace (§87).
 */
const RESULT_LIMIT = 50;

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function moduleLabel(key: string): string {
  return modules[key as ModuleKey]?.label ?? key;
}

/** Turns purchase_order into "Purchase order". */
function entityLabel(entityType: string): string {
  const words = entityType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function SearchPage({ searchParams }: Params) {
  const context = await requireUserContext();
  const params = await searchParams;

  const term = typeof params.q === "string" ? params.q : "";
  const moduleFilter = typeof params.module === "string" ? [params.module] : undefined;
  const inGroup = inGroupWorkspace(context);
  const companies = inGroup ? (await resolveWorkspaceContexts(context, {})).map((company) => ({ id: company.companyId, name: company.company.name })) : [];
  // Only a company the person may use is a filter; anything else is no filter (§57, §86).
  const companyFilter = inGroup && typeof params.company === "string" && companies.some((company) => company.id === params.company) ? params.company : undefined;

  const { results, groups, partial, failedModules } = await globalSearchForWorkspace(context, term, {
    moduleKeys: moduleFilter,
    limitPerProvider: 10,
    totalLimit: RESULT_LIMIT,
    companyId: companyFilter,
  });

  const filterHref = (company?: string) => {
    const query = new URLSearchParams();
    if (term.trim()) query.set("q", term);
    if (typeof params.module === "string") query.set("module", params.module);
    if (company) query.set("company", company);
    const text = query.toString();
    return text ? `/search?${text}` : "/search";
  };

  const searched = term.trim().length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search"
        description={
          inGroup
            ? "Everything you can reach, across every company and module you have access to."
            : "Everything you can reach, across every module you have access to."
        }
      />

      <SearchPageField defaultValue={term} company={companyFilter} />

      {inGroup && companies.length > 1 ? (
        <nav aria-label="Filter by company" className="flex flex-wrap items-center gap-1.5" data-testid="search-company-filter">
          {[{ id: undefined, name: "All companies" }, ...companies].map((company) => {
            const current = company.id === companyFilter;
            return (
              <Link
                key={company.id ?? "all"}
                href={filterHref(company.id)}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-meta font-medium transition-colors",
                  current ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {company.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {/*
       * A module whose provider failed is named rather than silently dropped:
       * "no results" and "we could not ask" are different answers, and only one
       * of them means the record is not there (PRD #26 §37, §38).
       */}
      {partial ? (
        <p className="text-body text-warning">
          Some modules could not be searched just now
          {failedModules.length > 0 ? ` (${failedModules.map(moduleLabel).join(", ")})` : ""}. These
          results are incomplete.
        </p>
      ) : null}

      {!searched ? (
        <EmptyState
          icon={<SearchX />}
          title="Search across NESTO"
          description="Find a project, a contract number, a purchase order, a stock item or a person. Only records you already have access to are searched."
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={`Nothing matches “${term}”.`}
          description="Check the spelling, or try a record number. Records you do not have access to never appear here."
        />
      ) : (
        <div className="space-y-6">
          <p className="text-body text-fg-muted">
            {results.length === RESULT_LIMIT ? `First ${RESULT_LIMIT}` : results.length} result
            {results.length === 1 ? "" : "s"} for “{term}”
            {groups.length > 1 ? ` across ${groups.length} modules` : ""}.
          </p>

          {groups.map((group) => {
            const rows = results.filter((row) => row.moduleKey === group.moduleKey);
            if (rows.length === 0) return null;

            return (
              <section key={group.moduleKey} className="space-y-2">
                <h2 className="text-section font-semibold text-fg">
                  {moduleLabel(group.moduleKey)}
                  <span className="ml-2 text-body font-normal text-fg-subtle">{group.count}</span>
                </h2>

                <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                  {rows.map((row) => (
                    <li key={`${row.company?.id ?? ""}:${row.entityType}:${row.entityId}`}>
                      {(() => {
                        const content = (
                          <>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-table font-medium text-fg">
                                {row.title}
                              </span>
                              {row.subtitle ? (
                                <span className="block truncate text-micro text-fg-subtle">
                                  {row.subtitle}
                                </span>
                              ) : null}
                            </span>
                            {row.company ? <CompanyTag name={row.company.name} className="shrink-0" /> : null}
                            <span className="hidden shrink-0 text-micro text-fg-subtle sm:block">
                              {entityLabel(row.entityType)}
                            </span>
                            {row.status ? (
                              <Badge tone="default" className="shrink-0">
                                {row.status}
                              </Badge>
                            ) : null}
                          </>
                        );
                        const className = "flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted";
                        // A company's record is a company page: the Group workspace enters the company first (§31).
                        return row.company ? (
                          <CompanyRecordLink companyId={row.company.id} companyName={row.company.name} href={row.href} className={className}>
                            {content}
                          </CompanyRecordLink>
                        ) : (
                          <Link href={row.href} className={className}>
                            {content}
                          </Link>
                        );
                      })()}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
