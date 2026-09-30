import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MobileRecordCard, MobileRecordRow } from "@/components/data/mobile-record";
import {
  activeFilterCount,
  dropRelationFilters,
  parseQueryState,
  serializeQueryState,
  toSavedView,
} from "@/lib/data/query-state";
import { allVisibleSelected, pruneToVisible, selectAll, selectionSurvivesQueryChange, toggleId } from "@/lib/data/selection";

const keys = { filters: ["status", "floor", "project"] } as const;

describe("query state (MOB-03 §58, §84, §85)", () => {
  it("round-trips search, filters, sort, page, limit and unrelated route keys", () => {
    const query = "section=open&search=a-1&status=SOLD,RESERVED&floor=10&sort=price-desc&limit=50&page=3";
    const state = parseQueryState(query, keys);
    expect(state.search).toBe("a-1");
    expect(state.filters).toEqual([
      { param: "status", values: ["SOLD", "RESERVED"] },
      { param: "floor", values: ["10"] },
    ]);
    expect(state.sort).toEqual({ value: "price-desc" });
    expect(state.page).toBe(3);
    expect(state.limit).toBe(50);
    expect(state.other).toEqual({ section: "open" });
    const again = parseQueryState(serializeQueryState(state, keys), keys);
    expect(again).toEqual(state);
  });

  it("defaults an invalid page to 1 and an invalid limit to none", () => {
    const state = parseQueryState("page=-2&limit=abc", keys);
    expect(state.page).toBe(1);
    expect(state.limit).toBeNull();
  });

  it("counts only filters that hold a real value, never search, sort or page", () => {
    const state = parseQueryState("search=x&sort=recent&page=2&status=ALL&floor=10", keys);
    expect(activeFilterCount(state, { status: "ALL" })).toBe(1);
    expect(activeFilterCount(parseQueryState("search=x&sort=recent", keys))).toBe(0);
  });

  it("drops relation filters when the workspace changes and returns to page 1", () => {
    const state = parseQueryState("status=SOLD&project=p1&page=4", keys);
    const next = dropRelationFilters(state, ["project"]);
    expect(next.filters.map((filter) => filter.param)).toEqual(["status"]);
    expect(next.page).toBe(1);
  });

  it("describes a saved view without page or selection, and never widens scope", () => {
    const state = parseQueryState("search=x&status=SOLD&sort=name-asc&page=5", keys);
    const view = toSavedView(state, { scope: { groupId: "g", companyId: "c", projectId: null } });
    expect(view).toEqual({ search: "x", filters: [{ param: "status", values: ["SOLD"] }], sort: "name-asc", columns: [], scope: { groupId: "g", companyId: "c", projectId: null } });
    expect(JSON.stringify(view)).not.toContain("page");
  });
});

describe("selection rules (MOB-03 §30, §31)", () => {
  it("toggles by canonical id", () => {
    const one = toggleId(new Set(), "a");
    expect([...one]).toEqual(["a"]);
    expect([...toggleId(one, "a")]).toEqual([]);
  });

  it("select all takes exactly the visible ids", () => {
    expect([...selectAll(["a", "b"])]).toEqual(["a", "b"]);
    expect(allVisibleSelected(new Set(["a", "b"]), ["a", "b"])).toBe(true);
    expect(allVisibleSelected(new Set(["a"]), ["a", "b"])).toBe(false);
    expect(allVisibleSelected(new Set(), [])).toBe(false);
  });

  it("no invisible selection survives a refresh", () => {
    const current = new Set(["a", "b", "gone"]);
    expect([...pruneToVisible(current, ["a", "b", "c"])]).toEqual(["a", "b"]);
    // Nothing removed: the same set, so nothing re-renders.
    const same = new Set(["a"]);
    expect(pruneToVisible(same, ["a", "b"])).toBe(same);
  });

  it("any query change clears the selection", () => {
    expect(selectionSurvivesQueryChange("status=SOLD", "status=SOLD")).toBe(true);
    expect(selectionSurvivesQueryChange("status=SOLD", "status=OPEN")).toBe(false);
    expect(selectionSurvivesQueryChange("", "page=2")).toBe(false);
  });
});

describe("mobile record presentation (MOB-03 §9-§13)", () => {
  const html = (node: React.ReactElement) => renderToStaticMarkup(React.createElement("ul", null, node));

  it("a card is a record with a title, a status, a prominent value and labelled facts", () => {
    const out = html(
      React.createElement(MobileRecordCard, {
        title: "Unit A-101",
        subtitle: "Eyes of Tirana",
        status: React.createElement("span", null, "For sale"),
        value: "€245,000.00",
        facts: [
          { key: "floor", label: "Floor", value: "10" },
          { key: "area", label: "Area", value: "118 m²", figure: true },
        ],
      }),
    );
    expect(out).toContain("data-record-card");
    expect(out).toContain("Unit A-101");
    expect(out).toContain("Eyes of Tirana");
    expect(out).toContain("For sale");
    expect(out).toContain("€245,000.00");
    expect(out).toContain("<dt");
    expect(out).toContain("Floor");
    expect(out).toContain("tabular-nums");
  });

  it("selection and actions sit above the stretched link and never nest it", () => {
    const out = html(
      React.createElement(MobileRecordCard, {
        title: "Task",
        selection: React.createElement("input", { type: "checkbox", "aria-label": "Select Task" }),
        actions: React.createElement("button", { type: "button" }, "Actions"),
      }),
    );
    expect(out).toContain("data-card-actions");
    expect(out).toContain("z-10");
    // No link at all without an href: nothing interactive is nested in another.
    expect(out).not.toContain("<a ");
  });

  it("marks the selected record for assistive technology and sight", () => {
    const out = html(React.createElement(MobileRecordCard, { title: "Task", selected: true }));
    expect(out).toContain('data-selected="true"');
    expect(out).toContain("ring-accent");
  });

  it("a row is compact: identity first, then facts as one dotted line", () => {
    const out = html(
      React.createElement(MobileRecordRow, {
        title: "Migena Bajro",
        subtitle: "Head of Legal",
        facts: [
          { key: "dept", label: "Department", value: "Legal" },
          { key: "co", label: "Company", value: "ARMAAR Group" },
        ],
      }),
    );
    expect(out).toContain("data-record-row");
    expect(out).toContain("Migena Bajro");
    expect(out).toContain("Legal");
    expect(out).toContain("ARMAAR Group");
    expect(out).toContain("min-h-14");
    expect(out).not.toContain("<dt");
  });

  it("passes hook attributes to the root for tests and analytics", () => {
    const out = html(React.createElement(MobileRecordCard, { title: "x", data: { "data-testid": "unit-card", "data-unit-code": "A-1" } }));
    expect(out).toContain('data-testid="unit-card"');
    expect(out).toContain('data-unit-code="A-1"');
  });
});
