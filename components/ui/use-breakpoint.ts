"use client";

import { useSyncExternalStore } from "react";

/**
 * The one breakpoint hook (AUD-04 §3, §8; SP-15, MW-16).
 *
 * Prefer CSS: most layout changes need no JavaScript at all. Use this only
 * where behaviour really differs — a bottom sheet instead of a side drawer —
 * and even then render one tree whose state survives the change, never a
 * separate mobile and desktop editor.
 *
 * Built on `useSyncExternalStore`, so a server render and the hydrating render
 * both see `undefined` ("not known yet") and agree; the real answer follows
 * straight after hydration and on every change. Callers decide what
 * `undefined` means for them instead of guessing a device type, which is what
 * made the older copies paint the desktop layout first and then swap.
 *
 * The widths are the design system's (styles/globals.css): sm 640, md 768,
 * lg 1024 — lg is where the navigation drawer becomes the sidebar.
 */

export const BREAKPOINTS = { xs: 480, sm: 640, md: 768, lg: 1024, xl: 1200, "2xl": 1440 } as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/** The media query that is true below `bp`, matching Tailwind's `max-<bp>:` variants. */
export function belowQuery(bp: Breakpoint): string {
  return `(max-width: ${BREAKPOINTS[bp] - 0.02}px)`;
}

/** The media query behind the `touch:` variant in globals.css: the drawer layout, or a coarse pointer. */
export const TOUCH_QUERY = "(max-width: 1023.98px), (pointer: coarse)";

type MediaQueryStore = {
  subscribe: (notify: () => void) => () => void;
  getSnapshot: () => boolean;
};

const stores = new Map<string, MediaQueryStore>();

/**
 * One store per query, shared by every component asking the same question, so
 * a page with ten phone-aware components registers one listener, not ten.
 */
export function mediaQueryStore(query: string, media: (query: string) => MediaQueryList = (q) => window.matchMedia(q)): MediaQueryStore {
  const existing = stores.get(query);
  if (existing) return existing;
  let list: MediaQueryList | null = null;
  const current = () => (list ??= media(query));
  const store: MediaQueryStore = {
    subscribe(notify) {
      const target = current();
      target.addEventListener("change", notify);
      return () => target.removeEventListener("change", notify);
    },
    getSnapshot: () => current().matches,
  };
  stores.set(query, store);
  return store;
}

/** Forgets the shared stores; for tests that swap `matchMedia`. */
export function resetMediaQueryStores() {
  stores.clear();
}

const serverSnapshot = () => undefined;

/** Whether `query` matches: `undefined` on the server and during hydration, then a boolean. */
export function useMediaQuery(query: string): boolean | undefined {
  const store = typeof window === "undefined" ? null : mediaQueryStore(query);
  return useSyncExternalStore<boolean | undefined>(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : serverSnapshot,
    serverSnapshot,
  );
}

/** True below the breakpoint (a phone below `md`, the drawer layout below `lg`). */
export function useIsBelow(bp: "xs" | "sm" | "md" | "lg"): boolean | undefined {
  return useMediaQuery(belowQuery(bp));
}

/** True where the `touch:` variant applies. */
export function useIsTouch(): boolean | undefined {
  return useMediaQuery(TOUCH_QUERY);
}

function noopSubscribe() {
  return () => undefined;
}

export type Orientation = "portrait" | "landscape";

/** Every field is `undefined` until hydration, like the hooks it is built on. */
export type Responsive = {
  /** Below `md` (768): phone and large phone. */
  isPhone: boolean | undefined;
  /** `md` up to below `lg`: 768–1023. */
  isTablet: boolean | undefined;
  /** `lg` (1024) and up. */
  isDesktop: boolean | undefined;
  orientation: Orientation | undefined;
  /** A mouse or trackpad is the primary pointer; width says nothing about it (MOB-01 §38). */
  hasFinePointer: boolean | undefined;
};

/**
 * The one JavaScript answer to "what kind of viewport is this" (MOB-01 §51).
 *
 * Reach for CSS first (`md:`, `touch:`, container queries). Use this only when
 * behaviour, not looks, differs — and render one tree whose state survives the
 * change. Never read `window.innerWidth` or the user agent (§48): the queries
 * behind it are shared stores, so ten callers register one listener each per
 * query, and a server render agrees with the hydrating one (§49).
 */
export function useResponsive(): Responsive {
  const isPhone = useMediaQuery(belowQuery("md"));
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);
  const portrait = useMediaQuery("(orientation: portrait)");
  const hasFinePointer = useMediaQuery("(pointer: fine)");
  return {
    isPhone,
    isTablet: isPhone === undefined || isDesktop === undefined ? undefined : !isPhone && !isDesktop,
    isDesktop,
    orientation: portrait === undefined ? undefined : portrait ? "portrait" : "landscape",
    hasFinePointer,
  };
}
