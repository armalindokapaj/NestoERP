import { after } from "next/server";

import type { UserContext } from "@/lib/context/types";
import { isFavorite } from "@/lib/modules/productivity/favorites.service";
import type { NavigableType } from "@/lib/modules/productivity/navigable.registry";
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
  after(() => recordRecentAccess(context, entityType, entityId, { verified: true }));
  const [settings, favorite] = await Promise.all([resolveProductivitySettings(context.companyId), isFavorite(context, entityType, entityId)]);
  if (!settings.favoritesEnabled) return null;
  return <FavoriteButton entityType={entityType} entityId={entityId} initial={favorite} compact={compact} />;
}
