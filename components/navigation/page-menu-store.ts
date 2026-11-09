/**
 * The page's ⋯ menu (components/navigation/page-menu.tsx), at every width.
 *
 * A page's "What is this?" tips and its Help are never drawn where they sit:
 * each hands itself to this store while it is mounted (an entry), and the
 * page's one ⋯ menu offers them. Below `lg` (phones and tablets) its secondary
 * actions (Export CSV, Import…) fold into the same ⋯; from `lg` they stay
 * visible buttons where the page put them, so the ⋯ there offers the tips and
 * Help only. That menu is either the page's own record menu (a project's, a
 * task's, a client's…), which then claims them, or, where the page has none,
 * a ⋯ the page header draws for them (a slot). Several headers can offer a
 * slot (a project's compact header and a section's own header): the first in
 * the document that is drawn at the current width is the one used.
 *
 * HOW TO ADD AN ITEM (the API; keep it stable):
 *
 * - A control in the header that should fold into the ⋯ — a secondary action
 *   (Export CSV, Import…) or a link — wraps its visible control in
 *   `FoldIntoPageMenu` with the item that stands for it:
 *
 *     <FoldIntoPageMenu item={{ kind: "action", label: t("export"), icon: <Download />, onSelect: run }}>
 *       <Button onClick={run}>…</Button>
 *     </FoldIntoPageMenu>
 *
 *   An action's children are drawn from lg as ever and not below it, where
 *   the item is in the ⋯ instead; a link's (Help) are not drawn at any width.
 *   Where nothing on the page can hold the item (no header slot, outside the
 *   shell) the children stay drawn at every width.
 * - Without a visible control of its own: `useRegisterPageMenuItem(item)`
 *   (null registers nothing), plus `usePageMenuInline()` to know whether to
 *   draw a fallback.
 * - Items: `{ kind: "action", label, icon?, onSelect? | href?, destructive?,
 *   disabled? }`, `{ kind: "link", label, href }` (Help), `{ kind: "tip",
 *   label, title, body, link? }` ("What is this?", which `WhatIsThis` adds
 *   itself). The menu lists actions first (below lg only), then tips, then
 *   links. An action's `onSelect` runs once the menu has closed, so it may
 *   open a dialog. The item is matched by its fields, so an inline object is
 *   fine and a new `onSelect` each render is fine too.
 * - The primary action stays a visible button at every width: pass it to the
 *   header as an ordinary action (`PageHeaderFrame`/`ModulePage` `actions`)
 *   and do not wrap it. Only secondary controls fold.
 * - A record's own ⋯ in the header marks its trigger `data-page-menu` (so the
 *   header puts it at the end of the title row below lg) and, to hold the
 *   folded items too, calls `useClaimPageMenu(true)` while its ⋯ is drawn and
 *   renders `<PageMenuItems separator />` at the end of its menu. It claims at
 *   every width; `PageMenuItems` lists only what the width folds.
 * - A header slot (`PageMenuSlot`) may be drawn at one width only (`at`): a
 *   project's compact header below lg, or a page header's two places for its
 *   ⋯ — the end of the title row below lg, right after the title or status
 *   from lg.
 *
 * Presentation only, and framework-free here, so it is unit-tested on its
 * own. `Node` is whatever labels and bodies are (React nodes in the app).
 */

import { orderLevels, type SectionAnchor } from "@/components/navigation/section-store";

export type PageHelpTip<Node = unknown> = {
  kind: "tip";
  /** The menu item's words ("What is this?"). */
  label: Node;
  /** The tip's heading, which the dialog it opens carries. */
  title: string;
  body: Node;
  link?: { label: string; href: string };
};

export type PageHelpLink<Node = unknown> = { kind: "link"; label: Node; href: string };

/** A secondary page action (Export CSV, Import…): `onSelect`, or `href` for one that is a link. */
export type PageMenuAction<Node = unknown> = {
  kind: "action";
  label: Node;
  icon?: Node;
  onSelect?: () => void;
  href?: string;
  destructive?: boolean;
  disabled?: boolean;
};

export type PageMenuEntry<Node = unknown> = PageMenuAction<Node> | PageHelpTip<Node> | PageHelpLink<Node>;

/** The earlier name, kept so nothing that imports it breaks. */
export type PageHelpEntry<Node = unknown> = PageMenuEntry<Node>;

const KIND_ORDER: Record<PageMenuEntry["kind"], number> = { action: 0, tip: 1, link: 2 };

export type PageMenuState<Node = unknown> = {
  /** False on the server and while hydrating: nothing is known yet, so nothing is drawn inline "for want of a menu". */
  ready: boolean;
  /** From `lg` (true) or below it (false): which slots are drawn and what the ⋯ offers. */
  wide: boolean;
  /** Every registered entry, actions first, then tips, then links, each in the order they registered. What the ⋯ offers at this width is `offeredEntries`. */
  entries: ReadonlyArray<{ id: string } & PageMenuEntry<Node>>;
  /** A page's own ⋯ menu holds the entries; no slot is drawn. */
  claimed: boolean;
  /** The slot that draws the ⋯: the first in the document drawn at this width; null without one. */
  slot: string | null;
  /** The tip whose dialog is open. */
  openTip: string | null;
};

/** Where a header slot can be drawn: at every width, below `lg` only, or from `lg` only. */
export type PageMenuSlotWidth = "all" | "belowLg" | "lg";

type Slot = { id: string; anchor: SectionAnchor | null; seq: number; at: PageMenuSlotWidth };

export const SERVER_STATE: PageMenuState<never> = Object.freeze({ ready: false, wide: false, entries: Object.freeze([]), claimed: false, slot: null, openTip: null });

/** True when nothing on the page can hold the entries at this width: each is then drawn where it sits. */
export function isOrphan(state: Pick<PageMenuState, "ready" | "claimed" | "slot">): boolean {
  return state.ready && !state.claimed && state.slot === null;
}

/** Whether a slot of this width is drawn at the state's width. */
export function slotDrawnAt(at: PageMenuSlotWidth, wide: boolean): boolean {
  return at === "all" || (at === "lg") === wide;
}

/**
 * What the page's ⋯ offers at the state's width: below `lg` every entry; from
 * `lg` the tips and Help only, because the secondary actions are visible
 * buttons there.
 */
export function offeredEntries<Node>(state: Pick<PageMenuState<Node>, "wide" | "entries">): PageMenuState<Node>["entries"] {
  return state.wide ? state.entries.filter((entry) => entry.kind !== "action") : state.entries;
}

/** Whether a slot draws its ⋯: it is the one in use, something is to be offered, and no page menu took them. `reserve` holds its place before the page is known. */
export function slotShows(state: PageMenuState, id: string, reserve: boolean): boolean {
  if (!state.ready) return reserve;
  return state.slot === id && !state.claimed && offeredEntries(state).length > 0;
}

export class PageMenuStore<Node = unknown> {
  private entries = new Map<string, { entry: PageMenuEntry<Node>; seq: number }>();
  private claims = new Set<string>();
  private slots = new Map<string, Slot>();
  private open: string | null = null;
  private listeners = new Set<() => void>();
  private seq = 0;
  private wide = false;
  private snapshot: PageMenuState<Node> = { ready: true, wide: false, entries: [], claimed: false, slot: null, openTip: null };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => SERVER_STATE as PageMenuState<Node>;

  /** Registers an entry, or replaces what it holds; it keeps its place. */
  setEntry(id: string, entry: PageMenuEntry<Node>) {
    const seq = this.entries.get(id)?.seq ?? ++this.seq;
    this.entries.set(id, { entry, seq });
    this.publish();
  }

  removeEntry(id: string) {
    if (!this.entries.delete(id)) return;
    if (this.open === id) this.open = null;
    this.publish();
  }

  claim(id: string) {
    if (this.claims.has(id)) return;
    this.claims.add(id);
    this.publish();
  }

  release(id: string) {
    if (this.claims.delete(id)) this.publish();
  }

  /** A header's place for the ⋯; `at` limits it to one width (`PageMenuSlotWidth`). */
  addSlot(id: string, anchor: SectionAnchor | null, at: PageMenuSlotWidth = "all") {
    const seq = this.slots.get(id)?.seq ?? ++this.seq;
    this.slots.set(id, { id, anchor, seq, at });
    this.publish();
  }

  removeSlot(id: string) {
    if (this.slots.delete(id)) this.publish();
  }

  /** The viewport is `lg` or wider (true) or below it (false); the provider keeps it current. */
  setWide(wide: boolean) {
    if (this.wide === wide) return;
    this.wide = wide;
    this.publish();
  }

  openTip(id: string) {
    if (!this.entries.has(id) || this.open === id) return;
    this.open = id;
    this.publish();
  }

  closeTip() {
    if (this.open === null) return;
    this.open = null;
    this.publish();
  }

  private publish() {
    const sorted = [...this.entries.entries()].sort(([, a], [, b]) => a.seq - b.seq).map(([id, { entry }]) => ({ id, ...entry }));
    const wide = this.wide;
    this.snapshot = {
      ready: true,
      wide,
      // A stable sort: within a kind, the order they registered.
      entries: sorted.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
      claimed: this.claims.size > 0,
      slot: orderLevels([...this.slots.values()].filter((slot) => slotDrawnAt(slot.at, wide)))[0]?.id ?? null,
      openTip: this.open,
    };
    for (const listener of this.listeners) listener();
  }
}
