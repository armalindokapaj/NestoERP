"use client";

import * as React from "react";

/**
 * The offline workspace is one page with its own small router, so moving around
 * it never asks the server for anything (MOB-09 §65). The URL carries the view
 * (`?view=project&id=…`), so Back works, and a reload or a shared link lands in
 * the right place.
 */

export type OfflineView = "home" | "sync" | "storage" | "project" | "diary" | "task" | "hse" | "document" | "search";
export type OfflineRoute = { view: OfflineView; id: string | null; tab: string | null; project: string | null };

const VIEWS: readonly OfflineView[] = ["home", "sync", "storage", "project", "diary", "task", "hse", "document", "search"];
const EVENT = "nesto:offline-route";

export function parseRoute(search: string): OfflineRoute {
  const params = new URLSearchParams(search);
  const view = params.get("view") as OfflineView | null;
  const from = params.get("from");
  if (!view && from) return fromPath(from);
  return { view: view && VIEWS.includes(view) ? view : "home", id: params.get("id"), tab: params.get("tab"), project: params.get("project") };
}

/** A page the person asked for while offline, mapped to the nearest thing the device holds. */
function fromPath(path: string): OfflineRoute {
  const project = /^\/projects\/([^/?#]+)/.exec(path);
  if (project) return { view: "project", id: project[1]!, tab: path.includes("/daily-logs") ? "diary" : path.includes("/hse") ? "hse" : path.includes("/documents") ? "documents" : null, project: null };
  const task = /^\/tasks\/([^/?#]+)/.exec(path);
  if (task) return { view: "task", id: task[1]!, tab: null, project: null };
  return { view: path.startsWith("/settings") ? "storage" : "home", id: null, tab: null, project: null };
}

export function routeUrl(route: Partial<OfflineRoute> & { view: OfflineView }): string {
  const params = new URLSearchParams({ view: route.view });
  if (route.id) params.set("id", route.id);
  if (route.tab) params.set("tab", route.tab);
  if (route.project) params.set("project", route.project);
  return `/offline?${params.toString()}`;
}

/** `null` until the page has mounted: the server has no say in where a person is in the workspace. */
export function useOfflineRoute(): { route: OfflineRoute | null; go: (route: Partial<OfflineRoute> & { view: OfflineView }, options?: { replace?: boolean }) => void; back: () => void } {
  const [route, setRoute] = React.useState<OfflineRoute | null>(null);

  // Read before the framework rewrites the address, so a fallback page keeps the path it was asked for.
  React.useEffect(() => {
    const read = () => setRoute(parseRoute(window.location.search));
    read();
    window.addEventListener("popstate", read);
    window.addEventListener(EVENT, read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(EVENT, read);
    };
  }, []);

  const go = React.useCallback((next: Partial<OfflineRoute> & { view: OfflineView }, options: { replace?: boolean } = {}) => {
    const url = routeUrl(next);
    if (options.replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    window.dispatchEvent(new Event(EVENT));
    window.scrollTo?.({ top: 0 });
  }, []);
  const back = React.useCallback(() => window.history.back(), []);
  return { route, go, back };
}
