import { headers } from "next/headers";
import { cache } from "react";
import { after } from "next/server";

import type { UserContext } from "@/lib/context/types";
import { isFavorite } from "@/lib/modules/productivity/favorites.service";
import type { NavigableType } from "@/lib/modules/productivity/navigable.types";
import { resolveProductivitySettings } from "@/lib/modules/productivity/productivity.settings";
import { recordRecentAccess } from "@/lib/modules/productivity/recent-work.service";
import { FavoriteButton } from "./favorite-button";

/**
 * The star on a record page, and the note that it was opened (PRD #45 §75,
 * §99). The page has already loaded the record through its own service, so
 * the member can open it; the recent-work write happens after the response,
 * and never slows or fails the page.
 */
export async function RecordFavorite({ context, entityType, entityId, compact = false }: { context: UserContext; entityType: NavigableType; entityId: string; compact?: boolean }) {
  await recordOpened(context, entityType, entityId);
  const favorite = await favoriteState(context, entityType, entityId);
  if (favorite === null) return null;
  return <FavoriteButton entityType={entityType} entityId={entityId} initial={favorite} compact={compact} />;
}

/** The note that a record was opened, without the star — for a page whose star sits elsewhere (a project's actions menu). */
export async function RecordOpened({ context, entityType, entityId }: { context: UserContext; entityType: NavigableType; entityId: string }) {
  await recordOpened(context, entityType, entityId);
  return null;
}

/** Whether the member starred the record, or null where the company has favourites off. Read once per request, however many places ask. */
export const favoriteState = cache(async (context: UserContext, entityType: NavigableType, entityId: string): Promise<boolean | null> => {
  const [settings, favorite] = await Promise.all([resolveProductivitySettings(context.companyId), isFavorite(context, entityType, entityId)]);
  return settings.favoritesEnabled ? favorite : null;
});

async function recordOpened(context: UserContext, entityType: NavigableType, entityId: string) {
  // A prefetch is the router guessing where the person might go, not an open (Fast Re-entry §100):
  // recording it would move a record to the top of Recent Work without anybody opening it.
  const request = await headers();
  const prefetch = request.get("next-router-prefetch") === "1" || /prefetch/i.test(request.get("purpose") ?? "") || /prefetch/i.test(request.get("sec-purpose") ?? "");
  if (!prefetch) after(() => recordRecentAccess(context, entityType, entityId, { verified: true }));
}
