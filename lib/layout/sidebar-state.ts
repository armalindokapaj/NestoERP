/**
 * Sidebar collapse state (design spec §14).
 *
 * Persisted in a cookie rather than localStorage so the server renders the
 * correct width on the first paint — a collapse that flashes open on every
 * navigation is worse than no collapse at all.
 */
export const SIDEBAR_COOKIE = "nesto.sidebar";

export type SidebarState = "expanded" | "collapsed";

export function isSidebarState(value: string | undefined): value is SidebarState {
  return value === "expanded" || value === "collapsed";
}

export function readSidebarState(value: string | undefined): SidebarState {
  return isSidebarState(value) ? value : "expanded";
}
