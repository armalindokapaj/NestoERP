/**
 * Navigation event hooks (MOB-02 §76).
 *
 * A single seam for product analytics. Nothing subscribes today and no
 * analytics dependency is added: components call `emitNavigationEvent`, which
 * dispatches a `nesto:navigation-event` CustomEvent on `window`. A future
 * provider listens once and forwards. Payloads carry ids and names, never
 * record data.
 */
export type NavigationEventName =
  | "navigation_destination_opened"
  | "quick_create_opened"
  | "more_opened"
  | "workspace_switched"
  | "global_search_opened";

export const NAVIGATION_EVENT = "nesto:navigation-event";

export type NavigationEventDetail = { name: NavigationEventName; data?: Record<string, string | number | boolean | null> };

export function emitNavigationEvent(name: NavigationEventName, data?: NavigationEventDetail["data"]): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NavigationEventDetail>(NAVIGATION_EVENT, { detail: { name, data } }));
}
