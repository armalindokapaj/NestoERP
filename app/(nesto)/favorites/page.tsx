import type { Metadata } from "next";
import Link from "next/link";

import { FavoritesView } from "@/components/productivity/favorites-view";
import { inGroupWorkspace } from "@/config/workspace";
import { requireUserContext } from "@/lib/context/current-user";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { listFavoritesForWorkspace } from "@/lib/modules/productivity/favorites.service";
import { productivityAvailability } from "@/lib/modules/productivity/productivity.workspace";
import { listRecentWorkForWorkspace } from "@/lib/modules/productivity/recent-work.service";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Favorites" };

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Personal shortcuts and recently opened records, each resolved against current access (PRD #45 §87-§90, §110).
 *
 * Reads the active workspace (Workspace Context §43, §44): in a company
 * workspace that company's favorites and recent work, in the Group workspace
 * all of them across the companies the person may use, every row naming its
 * company and opened through the enter-company hop. The company chips are a
 * filter, not a workspace (§87); a company the person may not use is no filter.
 */
export default async function FavoritesPage({ searchParams }: Params) {
  const context = await requireUserContext();
  const params = await searchParams;
  const inGroup = inGroupWorkspace(context);
  const companies = inGroup ? (await resolveWorkspaceContexts(context, {})).map((company) => ({ id: company.companyId, name: company.company.name })) : [];
  const companyFilter = inGroup && typeof params.company === "string" && companies.some((company) => company.id === params.company) ? params.company : undefined;
  const tab = params.tab === "recent" ? "recent" : "favorites";

  const [favorites, recent, settings] = await Promise.all([
    listFavoritesForWorkspace(context, { companyId: companyFilter }),
    listRecentWorkForWorkspace(context, { limit: 50, companyId: companyFilter }),
    productivityAvailability(context),
  ]);

  const filterHref = (company?: string) => {
    const query = new URLSearchParams();
    if (tab === "recent") query.set("tab", "recent");
    if (company) query.set("company", company);
    const text = query.toString();
    return text ? `/favorites?${text}` : "/favorites";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-page font-semibold tracking-tight text-fg">Favorites</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {inGroup
            ? "Records you starred and records you opened lately, across your companies. Only you can see these."
            : "Records you starred and records you opened lately. Only you can see these."}
        </p>
      </header>
      {inGroup && companies.length > 1 ? (
        <nav aria-label="Filter by company" className="flex flex-wrap items-center gap-1.5" data-testid="favorites-company-filter">
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
      <FavoritesView
        // A filter is a different list, not an edit of the one the view is holding.
        key={companyFilter ?? "all"}
        initialFavorites={favorites}
        initialRecent={recent}
        tab={tab}
        favoritesEnabled={settings.favoritesEnabled}
        recentEnabled={settings.recentWorkEnabled}
        inGroup={inGroup}
      />
    </div>
  );
}
