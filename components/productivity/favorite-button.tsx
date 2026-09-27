"use client";

import * as React from "react";
import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import type { NavigableType } from "@/lib/modules/productivity/navigable.types";
import { publishMyWorkChange, subscribeMyWork } from "@/lib/productivity/client";
import { cn } from "@/lib/utils/cn";
import { useCommonTranslations } from "@/components/i18n/common-text";

/**
 * ☆ Favorite / ★ Favorited on a record header (PRD #45 §75-§77). One click, no
 * confirmation; the server decides whether the record may be starred.
 */
export function FavoriteButton({ entityType, entityId, initial, compact = false }: { entityType: NavigableType; entityId: string; initial: boolean; compact?: boolean }) {
  const toast = useToast();
  const t = useCommonTranslations();
  const [favorite, setFavorite] = React.useState(initial);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => setFavorite(initial), [initial]);
  // The same star in another tab follows this one (Fast Re-entry §88, §216).
  React.useEffect(() => subscribeMyWork((change) => {
    if (change.kind === "favorite" && change.entityType === entityType && change.entityId === entityId) setFavorite(change.favorite);
  }), [entityType, entityId]);

  async function toggle() {
    const next = !favorite;
    setFavorite(next);
    setPending(true);
    try {
      if (next) await announcementApi("/api/favorites", { body: { entityType, entityId } });
      else await announcementApi(`/api/favorites/${entityType}/${entityId}`, { method: "DELETE" });
      publishMyWorkChange({ kind: "favorite", entityType, entityId, favorite: next });
    } catch (error) {
      setFavorite(!next);
      toast({ title: failureMessage(error, t("favorite.updateFailed")), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  const label = favorite ? t("favorite.favorited") : t("favorite.favorite");
  return (
    <Button type="button" variant={compact ? "ghost" : "secondary"} size={compact ? "icon-sm" : "sm"} onClick={() => void toggle()} disabled={pending} aria-pressed={favorite} aria-label={favorite ? t("favorite.remove") : t("favorite.add")} title={favorite ? t("favorite.remove") : t("favorite.add")} data-testid="favorite-button">
      <Star aria-hidden="true" className={cn("transition-colors", favorite ? "fill-warning text-warning" : "text-fg-subtle")} />
      {compact ? null : <span>{label}</span>}
    </Button>
  );
}
