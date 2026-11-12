/**
 * The page's sections, for the phone's section row below `lg`
 * (components/layout/phone-sections.tsx).
 *
 * Below 1024px a page's tab rows are not drawn: the row under the top bar
 * holds them instead. Every tab row goes through ContextTabsFrame,
 * which hands its tabs to this store while it is mounted — its level — and
 * takes them back when it unmounts. A record's own tabs inside a tabbed page
 * (a unit inside its project) are a second level; the levels are kept in
 * document order, outer first.
 *
 * Presentation only. A row's tabs arrive already filtered by permission, so
 * the phone's row can hold nothing the tab row would not have shown. Framework-free, so
 * it is unit-tested on its own; the React side is section-registry.tsx.
 */

export type SectionItem = {
  key: string;
  label: string;
  href: string;
  /** The section the page is on. */
  active: boolean;
  /** A number the tab shows beside its name, if any. */
  count?: number | null;
  /** Opens in a new browser tab (the 3D viewer). */
  newTab?: boolean;
};

export type SectionLevel = {
  id: string;
  label: string;
  items: readonly SectionItem[];
};

/** Where an anchor sits in the document; a DOM Node in the browser, anything with the method in a test. */
export type SectionAnchor = { isConnected: boolean; compareDocumentPosition(other: SectionAnchor): number };

type Entry = SectionLevel & { anchor: SectionAnchor | null; seq: number };

// Node.DOCUMENT_POSITION_PRECEDING and _FOLLOWING, spelled out so this file needs no DOM.
const PRECEDING = 2;
const FOLLOWING = 4;

const EMPTY: readonly SectionLevel[] = Object.freeze([]);

/** Outer before inner: by place in the document where both anchors are in it, else by when they registered. */
export function orderLevels<T extends { anchor: SectionAnchor | null; seq: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.anchor && b.anchor && a.anchor !== b.anchor && a.anchor.isConnected && b.anchor.isConnected) {
      const position = a.anchor.compareDocumentPosition(b.anchor);
      if (position & FOLLOWING) return -1;
      if (position & PRECEDING) return 1;
    }
    return a.seq - b.seq;
  });
}

export class SectionStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private snapshot: readonly SectionLevel[] = EMPTY;
  private seq = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;
  /** The server, and the hydrating render, know no sections: the row appears once the page's rows have registered. */
  getServerSnapshot = () => EMPTY;

  /** Registers a level, or replaces what it holds; it keeps its place among the levels. */
  set(id: string, level: { label: string; items: readonly SectionItem[] }, anchor: SectionAnchor | null = null) {
    const seq = this.entries.get(id)?.seq ?? ++this.seq;
    this.entries.set(id, { id, label: level.label, items: level.items, anchor, seq });
    this.publish();
  }

  remove(id: string) {
    if (this.entries.delete(id)) this.publish();
  }

  private publish() {
    this.snapshot = this.entries.size === 0 ? EMPTY : orderLevels([...this.entries.values()]).map(({ id, label, items }) => ({ id, label, items }));
    for (const listener of this.listeners) listener();
  }
}

/** The levels the phone's row can show: a row of one tab is no choice, as ContextTabs draws no row for it. */
export function menuLevels(levels: readonly SectionLevel[]): SectionLevel[] {
  return levels.filter((level) => level.items.length > 1);
}

/**
 * The page's own name, for a page no row marks: its heading — the title of
 * its page header (`h1[data-page-title]`), unless that header only names the
 * record the page sits in (a project's sub-page: `data-page-header="context"`)
 * — or else the first part of the document's title ("Work packages · Projects
 * · NESTO" is "Work packages"). Null when neither gives one. `main` and
 * `title` are passed in, so this is tested without a DOM.
 */
export function pageNameFrom(main: { querySelectorAll(selector: string): ArrayLike<{ textContent: string | null; closest(selector: string): unknown }> } | null, title: string): string | null {
  const headings = main ? Array.from(main.querySelectorAll("[data-page-header] h1[data-page-title]")) : [];
  for (const heading of headings) {
    if (heading.closest('[data-page-header="context"]')) continue;
    const text = heading.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  const first = title.split(" · ")[0]?.trim();
  return first && first !== title.trim() ? first : null;
}
