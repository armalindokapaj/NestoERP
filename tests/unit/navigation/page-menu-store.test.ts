import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { isOrphan, PageMenuStore, SERVER_STATE, slotShows, type PageHelpEntry } from "@/components/navigation/page-menu-store";
import type { SectionAnchor } from "@/components/navigation/section-store";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { FoldIntoPageMenu, PageMenuProvider, PageMenuSlot, type PageMenuItem } from "@/components/navigation/page-menu";
import { messages } from "@/lib/i18n/messages";

/**
 * The page's ⋯ menu below lg (the user's rule: What is this? and Help live in
 * the ⋯ at the end of the title row, on every page). Tips and Help register
 * while mounted; the page's own record menu claims them, or the first header
 * slot in the document draws a ⋯ for them; with neither they stay inline.
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

  it("a module header reserves its ⋯, so it is in the first paint; an unreserved slot draws nothing", () => {
    const reserved = render(React.createElement(PageMenuSlot, { reserve: true }));
    expect(reserved).toContain("data-page-menu");
    expect(reserved).toContain('aria-label="More options"');
    expect(render(React.createElement(PageMenuSlot, { reserve: false }))).not.toContain("data-page-menu");
  });

  it("a folded Help link is drawn from lg only while a menu can hold it below lg", () => {
    const folded = render(React.createElement(Fold, { item: { kind: "link", label: "Help", href: "/help/tasks" } }, React.createElement("a", { href: "/help/tasks" }, "Help")));
    expect(folded).toContain('class="contents max-lg:hidden"');
    // Outside the shell nothing collects it: drawn at every width.
    const outside = renderToStaticMarkup(React.createElement(Fold, { item: { kind: "link", label: "Help", href: "/help/tasks" } }, "Help"));
    expect(outside).toContain('class="contents"');
  });
});
