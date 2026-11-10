"use client";

import { ThemePreference } from "@/components/settings/theme-preference";
import type { ThemeChoice } from "@/lib/layout/theme-state";

/**
 * The catalog's switch: Day or Night. The same control and the same cookie as
 * Settings › Appearance (components/settings), so what is chosen here is what
 * every other page then shows.
 */
export function CatalogToolbar({ theme }: { theme: ThemeChoice }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2" data-testid="catalog-toolbar">
      <ThemePreference initial={theme} />
    </div>
  );
}
