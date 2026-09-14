import type { Metadata } from "next";

import { FavoritesView } from "@/components/productivity/favorites-view";
import { requireUserContext } from "@/lib/context/current-user";
import { listFavorites } from "@/lib/modules/productivity/favorites.service";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import { listRecentWork } from "@/lib/modules/productivity/recent-work.service";

export const metadata: Metadata = { title: "Favorites" };

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Personal shortcuts and recently opened records, each resolved against current access (PRD #45 §87-§90, §110). */
export default async function FavoritesPage({ searchParams }: Params) {
  const context = await requireUserContext();
  const params = await searchParams;
  const [favorites, recent, settings] = await Promise.all([listFavorites(context), listRecentWork(context, { limit: 50 }), resolveProductivitySettings(context.companyId)]);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-page font-semibold tracking-tight text-fg">Favorites</h1>
        <p className="mt-1.5 text-body text-fg-muted">Records you starred and records you opened lately. Only you can see these.</p>
      </header>
      <FavoritesView initialFavorites={favorites} initialRecent={recent} tab={params.tab === "recent" ? "recent" : "favorites"} favoritesEnabled={settings.favoritesEnabled} recentEnabled={settings.recentWorkEnabled} />
    </div>
  );
}
