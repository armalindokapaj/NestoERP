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
