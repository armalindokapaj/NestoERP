import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchPageField } from "@/components/search/search-page-field";
import { modules, type ModuleKey } from "@/config/modules";
import { requireUserContext } from "@/lib/context/current-user";
import { globalSearch } from "@/lib/core/search/search.service";

export const metadata: Metadata = { title: "Search" };

/**
 * The dedicated search page (PRD #26 §12, §166).
 *
 * A server component on purpose. The API route exists for the command palette,
 * but a page that renders its own results cannot drift from what the services
 * authorise — it calls `globalSearch` directly, so every result on screen has
 * been through the same company, module, permission and scope checks as the
 * module's own list.
 *
 * Results are grouped by module because that is how somebody reads them: "four
 * contracts and one purchase order" is an answer, one flat list of nineteen
 * things is not.
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

  const { results, groups, partial, failedModules } = await globalSearch(context, term, {
    moduleKeys: moduleFilter,
    limitPerProvider: 10,
    totalLimit: RESULT_LIMIT,
  });

  const searched = term.trim().length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search"
        description="Everything you can reach, across every module you have access to."
      />

      <SearchPageField defaultValue={term} />

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
                    <li key={`${row.entityType}:${row.entityId}`}>
                      <Link
                        href={row.href}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                      >
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
                        <span className="hidden shrink-0 text-micro text-fg-subtle sm:block">
                          {entityLabel(row.entityType)}
                        </span>
                        {row.status ? (
                          <Badge tone="default" className="shrink-0">
                            {row.status}
                          </Badge>
                        ) : null}
                      </Link>
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
