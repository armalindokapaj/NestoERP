import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RegisterSections, SectionStoreProvider, useSectionLevels } from "@/components/navigation/section-registry";
import { hasCurrentSection, menuLevels, orderLevels, pageNameFrom, pillFor, SectionStore, type SectionAnchor, type SectionItem, type SectionLevel } from "@/components/navigation/section-store";

/**
 * The section menu's store (mobile section pill): each tab row registers its
 * level while mounted, the levels are kept outer first, and the pill names the
 * innermost section the page is on. Below lg the tab rows are not drawn, so
 * this is the only way to a page's sections there.
 */

const items = (keys: string[], active?: string): SectionItem[] => keys.map((key) => ({ key, label: key[0]!.toUpperCase() + key.slice(1), href: `/x/${key}`, active: key === active }));

/** An anchor at a place in a pretend document: lower places come first. */
function anchorAt(place: number, connected = true): SectionAnchor & { place: number } {
  return {
    place,
    isConnected: connected,
    compareDocumentPosition(other) {
      const theirs = (other as unknown as { place: number }).place;
      // FOLLOWING (4) when the other comes later, PRECEDING (2) when it comes earlier.
      return theirs > place ? 4 : theirs < place ? 2 : 0;
    },
  };
}

describe("SectionStore", () => {
  it("knows no sections on the server or while hydrating, and publishes what a row registers", () => {
    const store = new SectionStore();
    expect(store.getServerSnapshot()).toEqual([]);
    expect(store.getSnapshot()).toEqual([]);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("project", { label: "Project sections", items: items(["overview", "sales"], "sales") });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual([{ id: "project", label: "Project sections", items: items(["overview", "sales"], "sales") }]);
  });

  it("keeps one snapshot between changes, so useSyncExternalStore does not loop", () => {
    const store = new SectionStore();
    store.set("a", { label: "A", items: items(["one", "two"]) });
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("takes a level back when its row unmounts, and says nothing for one it never had", () => {
    const store = new SectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set("a", { label: "A", items: items(["one", "two"]) });
    store.remove("a");
    store.remove("never");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("stops telling a listener that unsubscribed", () => {
    const store = new SectionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set("a", { label: "A", items: items(["one", "two"]) });
    expect(listener).not.toHaveBeenCalled();
  });

  it("orders levels by their rows' place in the document, outer first, whatever order they registered in", () => {
    const store = new SectionStore();
    // A unit's tabs can register before its project's (a page's effects run before its layout's).
    store.set("unit", { label: "A-101 sections", items: items(["overview", "documents"], "documents") }, anchorAt(20));
    store.set("project", { label: "Project sections", items: items(["overview", "units"], "units") }, anchorAt(10));
    expect(store.getSnapshot().map((level) => level.id)).toEqual(["project", "unit"]);
  });

  it("an updated level keeps its place, and the new sections replace the old", () => {
    const store = new SectionStore();
    store.set("outer", { label: "Outer", items: items(["one", "two"], "one") });
    store.set("inner", { label: "Inner", items: items(["three", "four"], "three") });
    store.set("outer", { label: "Outer", items: items(["one", "two"], "two") });
    const levels = store.getSnapshot();
    expect(levels.map((level) => level.id)).toEqual(["outer", "inner"]);
    expect(levels[0]!.items.find((item) => item.active)?.key).toBe("two");
  });
});

describe("orderLevels", () => {
  it("falls back to registration order where an anchor is missing or no longer in the document", () => {
    const entries = [
      { id: "b", anchor: anchorAt(1, false), seq: 2 },
      { id: "a", anchor: null, seq: 1 },
      { id: "c", anchor: anchorAt(0), seq: 3 },
    ];
    expect(orderLevels(entries).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("does not change the list it is given", () => {
    const entries = [
      { id: "inner", anchor: anchorAt(2), seq: 1 },
      { id: "outer", anchor: anchorAt(1), seq: 2 },
    ];
    expect(orderLevels(entries).map((entry) => entry.id)).toEqual(["outer", "inner"]);
    expect(entries.map((entry) => entry.id)).toEqual(["inner", "outer"]);
  });
});

describe("menuLevels and pillFor", () => {
  const project: SectionLevel = { id: "p", label: "Project sections", items: items(["overview", "planning", "units", "sales"], "units") };
  const unit: SectionLevel = { id: "u", label: "A-101 sections", items: items(["overview", "documents", "sales"], "sales") };

  it("offers no level of a single tab, as no tab row is drawn for one", () => {
    const single: SectionLevel = { id: "s", label: "Single", items: items(["overview"], "overview") };
    expect(menuLevels([project, single]).map((level) => level.id)).toEqual(["p"]);
    expect(pillFor(menuLevels([single]))).toBeNull();
  });

  it("shows no pill on a page without sections", () => {
    expect(pillFor([])).toBeNull();
  });

  it("names the section the page is on", () => {
    expect(pillFor([project])).toEqual({ label: "Units", item: project.items[2] });
  });

  it("on a record inside a tabbed page, names the innermost level's section", () => {
    expect(pillFor([project, unit])?.label).toBe("Sales");
    expect(pillFor([project, unit])?.item?.href).toBe("/x/sales");
  });

  it("where the innermost level marks no section, names the outer one's", () => {
    const unmarked: SectionLevel = { ...unit, items: items(["overview", "documents"]) };
    expect(pillFor([project, unmarked])?.label).toBe("Units");
  });

  it("where no level marks a section, names the page itself (a project's Media), and only without one the level", () => {
    const none: SectionLevel = { ...project, items: items(["overview", "units"]) };
    expect(hasCurrentSection([none])).toBe(false);
    expect(hasCurrentSection([project])).toBe(true);
    expect(pillFor([none], "Project media")).toEqual({ label: "Project media", item: null });
    expect(pillFor([none], "  ")).toEqual({ label: "Project sections", item: null });
    expect(pillFor([none])).toEqual({ label: "Project sections", item: null });
    // A marked section wins over the page's name.
    expect(pillFor([project], "Project media")?.label).toBe("Units");
  });
});

describe("pageNameFrom", () => {
  type Heading = { textContent: string | null; closest(selector: string): unknown };
  const heading = (text: string, context = false): Heading => ({ textContent: text, closest: (selector) => (context && selector.includes("context") ? {} : null) });
  const main = (...headings: Heading[]) => ({ querySelectorAll: () => headings });

  it("takes the page header's title", () => {
    expect(pageNameFrom(main(heading("  Project\n  media ")), "Riverside · Media · Projects · NESTO")).toBe("Project media");
  });

  it("skips a header that only names the record the page sits in, and falls back to the document's title", () => {
    expect(pageNameFrom(main(heading("Riverside Residences", true)), "Work packages · Projects · NESTO")).toBe("Work packages");
    expect(pageNameFrom(null, "Work packages · Projects · NESTO")).toBe("Work packages");
  });

  it("has no name for a page with neither", () => {
    expect(pageNameFrom(main(), "NESTO")).toBeNull();
    expect(pageNameFrom(null, "")).toBeNull();
  });
});

describe("RegisterSections and useSectionLevels on the server", () => {
  function Probe() {
    const levels = useSectionLevels();
    return React.createElement("output", null, String(levels.length));
  }

  it("the server render knows no levels, so the hydrating render agrees with it", () => {
    const html = renderToStaticMarkup(
      React.createElement(SectionStoreProvider, null, React.createElement(RegisterSections, { label: "Project sections", items: items(["overview", "sales"], "sales") }), React.createElement(Probe)),
    );
    expect(html).toContain("<output>0</output>");
  });

  it("marks a row that offers a choice, for the top bar to keep the pill's place before hydration", () => {
    const two = renderToStaticMarkup(React.createElement(RegisterSections, { label: "L", items: items(["one", "two"], "one") }));
    const one = renderToStaticMarkup(React.createElement(RegisterSections, { label: "L", items: items(["one"], "one") }));
    expect(two).toMatch(/<span hidden="" data-section-level="">/);
    expect(one).not.toContain("data-section-level");
  });

  it("outside the shell a row registers nothing and nothing throws", () => {
    expect(() => renderToStaticMarkup(React.createElement(Probe))).not.toThrow();
  });
});
