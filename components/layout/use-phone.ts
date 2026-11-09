"use client";

import * as React from "react";

const QUERY = "(max-width: 767.98px)";

/**
 * Whether the viewport is a phone (below `md`). `null` before the first client
 * render — the server cannot know — so a caller renders its CSS-hidden form
 * until then and settles to one real element, never two (Premium Mobile §6).
 */
export function usePhone(): boolean | null {
  return React.useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => null,
  );
}

const BELOW_LG = "(max-width: 1023.98px)";

/**
 * Whether the viewport is below `lg` (phones and tablets), where the shell
 * folds a page's tab rows, tips and Help into its menus. `null` before the
 * first client render, like `usePhone`.
 */
export function useBelowLg(): boolean | null {
  return React.useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(BELOW_LG);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(BELOW_LG).matches,
    () => null,
  );
}
