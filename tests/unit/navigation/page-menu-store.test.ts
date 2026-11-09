import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { isOrphan, offeredEntries, PageMenuStore, SERVER_STATE, slotShows, type PageHelpEntry } from "@/components/navigation/page-menu-store";
import type { SectionAnchor } from "@/components/navigation/section-store";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { FoldIntoPageMenu, PageMenuProvider, PageMenuSlot, type PageMenuItem } from "@/components/navigation/page-menu";
import { messages } from "@/lib/i18n/messages";

/**
 * The page's ⋯ menu (the user's rule: What is this? and Help live in the ⋯
 * right after the title or status, on every page and at every width; below lg
 * the secondary actions too). Tips and Help register while mounted; the
 * page's own record menu claims them, or the first header slot in the
 * document drawn at this width draws a ⋯ for them; with neither they stay
 * inline.
 */

const tip = (title: string): PageHelpEntry<string> => ({ kind: "tip", label: "What is this?", title, body: `${title} body` });
const help: PageHelpEntry<string> = { kind: "link", label: "Help", href: "/help/tasks" };

function anchorAt(place: number): SectionAnchor & { place: number } {
  return {
    place,
    isConnected: true,
    compareDocumentPosition(other) {
      const theirs = (other as unknown as { place: number }).place;
      return theirs > place ? 4 : theirs < place ? 2 : 0;
    },
  };
}

describe("PageMenuStore", () => {
  it("knows nothing on the server, and nothing there is drawn inline for want of a menu", () => {
    const store = new PageMenuStore<string>();
    expect(store.getServerSnapshot()).toBe(SERVER_STATE);
    expect(isOrphan(SERVER_STATE)).toBe(false);
  });

  it("lists tips before Help, each in the order it registered, and keeps a replaced entry's place", () => {
    const store = new PageMenuStore<string>();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setEntry("help", help);
    store.setEntry("a", tip("A"));
    store.setEntry("b", tip("B"));
    store.setEntry("a", tip("A2"));
    expect(store.getSnapshot().entries.map((entry) => entry.id)).toEqual(["a", "b", "help"]);
    expect(store.getSnapshot().entries[0]).toMatchObject({ kind: "tip", title: "A2" });
    expect(listener).toHaveBeenCalledTimes(4);
    store.removeEntry("b");
    expect(store.getSnapshot().entries.map((entry) => entry.id)).toEqual(["a", "help"]);
  });

  it("lists a page's secondary actions first, then its tips, then Help (Export CSV, Import… folded below lg)", () => {
    const store = new PageMenuStore<string>();
    store.setEntry("help", help);
    store.setEntry("tip", tip("T"));
    store.setEntry("export", { kind: "action", label: "Export CSV", onSelect: () => undefined });
    store.setEntry("import", { kind: "action", label: "Import…", href: "/import" });
    expect(store.getSnapshot().entries.map((entry) => entry.id)).toEqual(["export", "import", "tip", "help"]);
    expect(offeredEntries(store.getSnapshot()).map((entry) => entry.id)).toEqual(["export", "import", "tip", "help"]);
  });

  it("from lg offers the tips and Help only: the secondary actions are buttons on the page there", () => {
    const store = new PageMenuStore<string>();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setEntry("export", { kind: "action", label: "Export CSV", onSelect: () => undefined });
    store.setEntry("tip", tip("T"));
    store.setEntry("help", help);
    store.setWide(true);
    expect(store.getSnapshot().wide).toBe(true);
    expect(offeredEntries(store.getSnapshot()).map((entry) => entry.id)).toEqual(["tip", "help"]);
    store.setWide(true);
    expect(listener).toHaveBeenCalledTimes(4);
    store.setWide(false);
    expect(offeredEntries(store.getSnapshot()).map((entry) => entry.id)).toEqual(["export", "tip", "help"]);
  });

  it("from lg a slot with only actions to offer draws no ⋯; with a tip or Help it does", () => {
    const store = new PageMenuStore<string>();
    store.setWide(true);
    store.addSlot("header", anchorAt(1));
    store.setEntry("export", { kind: "action", label: "Export CSV", onSelect: () => undefined });
    expect(slotShows(store.getSnapshot(), "header", false)).toBe(false);
    store.setEntry("help", help);
    expect(slotShows(store.getSnapshot(), "header", false)).toBe(true);
  });

  it("uses the first slot drawn at this width: the compact header's below lg, the section header's from lg", () => {
    const store = new PageMenuStore<string>();
    store.setEntry("t", tip("T"));
    store.addSlot("compact", anchorAt(1), "belowLg");
    store.addSlot("section-row", anchorAt(6), "belowLg");
    store.addSlot("section-title", anchorAt(5), "lg");
    expect(store.getSnapshot().slot).toBe("compact");
    store.setWide(true);
    expect(store.getSnapshot().slot).toBe("section-title");
    expect(slotShows(store.getSnapshot(), "compact", false)).toBe(false);
    expect(slotShows(store.getSnapshot(), "section-title", false)).toBe(true);
    store.addSlot("everywhere", anchorAt(0));
    expect(store.getSnapshot().slot).toBe("everywhere");
    store.setWide(false);
    expect(store.getSnapshot().slot).toBe("everywhere");
  });

  it("leaves the entries inline from lg where the only slot is drawn below lg", () => {
    const store = new PageMenuStore<string>();
    store.setEntry("t", tip("T"));
    store.addSlot("compact", null, "belowLg");
    expect(isOrphan(store.getSnapshot())).toBe(false);
    store.setWide(true);
    expect(isOrphan(store.getSnapshot())).toBe(true);
    store.claim("record-menu");
    expect(isOrphan(store.getSnapshot())).toBe(false);
  });

  it("draws the ⋯ in the first slot of the document, and only with something to offer", () => {
    const store = new PageMenuStore<string>();
    store.addSlot("section-header", anchorAt(5));
    store.addSlot("project-header", anchorAt(1));
    let state = store.getSnapshot();
    expect(state.slot).toBe("project-header");
    expect(slotShows(state, "project-header", false)).toBe(false);
    store.setEntry("t", tip("T"));
    state = store.getSnapshot();
    expect(slotShows(state, "project-header", false)).toBe(true);
    expect(slotShows(state, "section-header", false)).toBe(false);
    store.removeSlot("project-header");
    expect(slotShows(store.getSnapshot(), "section-header", false)).toBe(true);
  });

  it("draws no slot while a page's own ⋯ holds the entries", () => {
    const store = new PageMenuStore<string>();
    store.addSlot("header", anchorAt(1));
    store.setEntry("t", tip("T"));
    store.claim("project-menu");
    expect(slotShows(store.getSnapshot(), "header", false)).toBe(false);
    store.release("project-menu");
    expect(slotShows(store.getSnapshot(), "header", false)).toBe(true);
  });

  it("before the page is known, a slot holds its place only when its header reserves it", () => {
    expect(slotShows(SERVER_STATE, "x", true)).toBe(true);
    expect(slotShows(SERVER_STATE, "x", false)).toBe(false);
  });

  it("leaves the entries inline where nothing can hold them", () => {
    const store = new PageMenuStore<string>();
    store.setEntry("t", tip("T"));
    expect(isOrphan(store.getSnapshot())).toBe(true);
    store.addSlot("header", null);
    expect(isOrphan(store.getSnapshot())).toBe(false);
    store.removeSlot("header");
    store.claim("menu");
    expect(isOrphan(store.getSnapshot())).toBe(false);
  });

  it("opens one tip at a time, only a registered one, and forgets it when the tip goes", () => {
    const store = new PageMenuStore<string>();
    store.openTip("missing");
    expect(store.getSnapshot().openTip).toBeNull();
    store.setEntry("t", tip("T"));
    store.openTip("t");
    expect(store.getSnapshot().openTip).toBe("t");
    store.removeEntry("t");
    expect(store.getSnapshot().openTip).toBeNull();
    store.setEntry("t", tip("T"));
    store.openTip("t");
    store.closeTip();
    expect(store.getSnapshot().openTip).toBeNull();
  });
});

/** Children passed the createElement way, which the component's required `children` prop type does not admit. */
const Fold = FoldIntoPageMenu as unknown as React.FC<{ item: PageMenuItem; children?: React.ReactNode }>;

describe("page menu on the server", () => {
  const render = (node: React.ReactNode) =>
    renderToStaticMarkup(React.createElement(I18nProvider, { locale: "en", messages: messages.en } as never, React.createElement(PageMenuProvider, null, node)));

  it("a module header reserves its ⋯, so it is in the first paint, at every width; an unreserved slot draws nothing", () => {
    const reserved = render(React.createElement(PageMenuSlot, { reserve: true }));
    expect(reserved).toContain("data-page-menu");
    expect(reserved).toContain('aria-label="More options"');
    expect(reserved).toContain('data-testid="page-menu"');
    expect(reserved).not.toMatch(/lg:hidden/);
    expect(render(React.createElement(PageMenuSlot, { reserve: false }))).not.toContain("data-page-menu");
  });

  it("a header's two places for its ⋯ are each drawn at their own width, and only the drawn one carries the test id", () => {
    const below = render(React.createElement(PageMenuSlot, { reserve: true, at: "belowLg" }));
    expect(below).toMatch(/class="[^"]*\blg:hidden\b/);
    expect(below).not.toContain("data-testid");
    const wide = render(React.createElement(PageMenuSlot, { reserve: true, at: "lg" }));
    expect(wide).toMatch(/class="[^"]*\bmax-lg:hidden\b/);
    expect(wide).not.toContain("data-testid");
  });

  it("a folded Help link is not drawn at any width while a menu can hold it; a folded action only below lg", () => {
    const folded = render(React.createElement(Fold, { item: { kind: "link", label: "Help", href: "/help/tasks" } }, React.createElement("a", { href: "/help/tasks" }, "Help")));
    expect(folded).toContain('<div class="hidden">');
    const action = render(React.createElement(Fold, { item: { kind: "action", label: "Export CSV", onSelect: () => undefined } }, React.createElement("button", null, "Export CSV")));
    expect(action).toContain('class="contents max-lg:hidden"');
    // Outside the shell nothing collects it: drawn at every width.
    const outside = renderToStaticMarkup(React.createElement(Fold, { item: { kind: "link", label: "Help", href: "/help/tasks" } }, "Help"));
    expect(outside).toContain('class="contents"');
  });
});
