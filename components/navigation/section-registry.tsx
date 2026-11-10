"use client";

import * as React from "react";

import { SectionStore, type SectionItem, type SectionLevel } from "@/components/navigation/section-store";

/**
 * Where a page's tab rows hand their sections to the phone Ribbon's This page
 * below `lg` (components/layout/phone-ribbon.tsx), and the module's own row to
 * the desktop Ribbon. The store lives in the app
 * shell, keyed by the workspace with everything else, so nothing outlives a
 * workspace switch. Outside the shell (no provider) a row registers nothing.
 */
const SectionStoreContext = React.createContext<SectionStore | null>(null);

export function SectionStoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => new SectionStore());
  return <SectionStoreContext.Provider value={store}>{children}</SectionStoreContext.Provider>;
}

const EMPTY: readonly SectionLevel[] = [];
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY;

/** Every registered level, outer first. Empty on the server and while hydrating, so both renders agree. */
export function useSectionLevels(): readonly SectionLevel[] {
  const store = React.useContext(SectionStoreContext);
  return React.useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptySnapshot, store?.getServerSnapshot ?? emptySnapshot);
}

/**
 * One tab row's sections, registered while the row is mounted. Its hidden
 * anchor marks the row's place in the document, which orders nested levels,
 * and — while it has a choice to offer — lets the top bar keep the pill's
 * place before the page has hydrated (`data-section-level`, styles/globals.css).
 *
 * Registered in a layout effect, so after a client navigation the pill is
 * right in the same frame the new page is first painted.
 */
export function RegisterSections({ label, items, module = false }: { label: string; items: readonly SectionItem[]; module?: boolean }) {
  const store = React.useContext(SectionStoreContext);
  const anchor = React.useRef<HTMLSpanElement>(null);
  const id = React.useId();
  // Serialised, so a parent re-rendering with equal sections publishes nothing new.
  const key = JSON.stringify([label, items, module]);
  React.useLayoutEffect(() => {
    if (!store) return;
    const [levelLabel, levelItems, levelModule] = JSON.parse(key) as [string, SectionItem[], boolean];
    store.set(id, { label: levelLabel, items: levelItems, module: levelModule }, anchor.current);
  }, [store, id, key]);
  React.useLayoutEffect(() => () => store?.remove(id), [store, id]);
  return <span ref={anchor} hidden data-section-level={items.length > 1 ? "" : undefined} />;
}
