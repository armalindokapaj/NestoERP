"use client";

import * as React from "react";
import { useRouter as useNextRouter } from "next/navigation";

import { unsaved, type DepartureIntent } from "@/lib/unsaved/coordinator";

/**
 * Programmatic navigation that asks about unsaved work first (AUD-03 §5).
 *
 * A drop-in for `next/navigation`'s `useRouter`: the same methods, the same
 * arguments. `push`, `replace`, `back` and `forward` destroy the page's
 * editors, so they go through the tab's coordinator — at once when nothing
 * would be lost, after the person's answer when something would. `refresh`
 * keeps the page and its values, and `prefetch` never asks, saves or discards.
 */
export function guardNavigation(intent: DepartureIntent, go: () => void): void {
  if (unsaved.isLeaving() || !unsaved.hasBlocking(intent)) {
    go();
    return;
  }
  void unsaved.requestDeparture(intent).then((approval) => {
    approval?.run(go);
  });
}

function currentHref(): string {
  return typeof window === "undefined" ? "" : window.location.href;
}

/** Whether `href` renders another page than this one: a hash-only change keeps the editor. */
export function leavesPage(href: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const target = new URL(href, window.location.href);
    return target.origin !== window.location.origin || target.pathname !== window.location.pathname || target.search !== window.location.search;
  } catch {
    return true;
  }
}

export function useRouter(): ReturnType<typeof useNextRouter> {
  const router = useNextRouter();
  return React.useMemo(
    () => ({
      ...router,
      push: (href, options) => (leavesPage(href) ? guardNavigation({ kind: "navigate", href }, () => router.push(href, options)) : router.push(href, options)),
      replace: (href, options) => (leavesPage(href) ? guardNavigation({ kind: "navigate", href }, () => router.replace(href, options)) : router.replace(href, options)),
      back: () => guardNavigation({ kind: "history", href: currentHref() }, () => router.back()),
      forward: () => guardNavigation({ kind: "history", href: currentHref() }, () => router.forward()),
      refresh: () => router.refresh(),
      prefetch: (href, options) => router.prefetch(href, options),
    }),
    [router],
  );
}
