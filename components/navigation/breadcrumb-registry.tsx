"use client";

import * as React from "react";

import type { Crumb } from "@/components/ui/breadcrumbs";

/**
 * Where a page hands its breadcrumb trail to the shell's one sticky bar
 * (Sticky Navigation §23, §24). A page names its trail with `<Breadcrumbs>` as it
 * always has; the bar under the top bar draws it. A layout (a project's, say)
 * registers at "layout" level and a page inside it at "page" level, so the
 * deeper trail wins while both are mounted.
 */
type Level = "layout" | "page";
type Entry = { id: number; level: Level; items: Crumb[] };

class BreadcrumbRegistry {
  private entries: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: Crumb[] | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => null;

  set(id: number, level: Level, items: Crumb[]) {
    this.entries = [...this.entries.filter((entry) => entry.id !== id), { id, level, items }];
    this.publish();
  }

  remove(id: number) {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.publish();
  }

  private publish() {
    const page = this.entries.filter((entry) => entry.level === "page");
    const chosen = (page.length ? page : this.entries).at(-1);
    this.snapshot = chosen?.items ?? null;
    for (const listener of this.listeners) listener();
  }
}

const RegistryContext = React.createContext<BreadcrumbRegistry | null>(null);
let nextId = 0;

export function BreadcrumbRegistryProvider({ children }: { children: React.ReactNode }) {
  const [registry] = React.useState(() => new BreadcrumbRegistry());
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/** The trail the bar should draw, or null when the page named none (the bar then derives one from the route). */
export function useRegisteredBreadcrumbs(): Crumb[] | null {
  const registry = React.useContext(RegistryContext);
  return React.useSyncExternalStore(
    registry?.subscribe ?? noopSubscribe,
    registry?.getSnapshot ?? nullSnapshot,
    registry?.getServerSnapshot ?? nullSnapshot,
  );
}

export function useRegisterBreadcrumbs(items: Crumb[], level: Level = "page") {
  const registry = React.useContext(RegistryContext);
  const [id] = React.useState(() => ++nextId);
  // Serialised, so a parent re-rendering with an equal trail publishes nothing new.
  const key = JSON.stringify(items);
  React.useLayoutEffect(() => {
    if (!registry) return;
    registry.set(id, level, JSON.parse(key) as Crumb[]);
  }, [registry, id, level, key]);
  React.useLayoutEffect(() => () => registry?.remove(id), [registry, id]);
}

const noopSubscribe = () => () => undefined;
const nullSnapshot = () => null;
