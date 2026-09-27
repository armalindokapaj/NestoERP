import { describe, expect, it } from "vitest";

import { listPageRedirect, pageHref, pageWindow, sortNulls, withTieBreaker } from "@/lib/modules/shared/list-query";
import { applyListChange, clearListFilters, sameQuery } from "@/lib/tables/list-url";
import { appliedSort, headerSortState } from "@/lib/tables/sort";

/**
 * DT-04 / DT-05: the shared sort, page-window and query-transition contracts
 * (AUD-08 §3, §4). Every expected value is written out by hand.
 */

describe("withTieBreaker appends one unique key", () => {
  it("turns an object into an array ending in id", () => {
    expect(withTieBreaker({ dueDate: "asc" })).toEqual([{ dueDate: "asc" }, { id: "asc" }]);
  });

  it("appends to an array", () => {
    expect(withTieBreaker([{ status: "asc" }, { updatedAt: "desc" }])).toEqual([
      { status: "asc" },
      { updatedAt: "desc" },
      { id: "asc" },
    ]);
  });

  it("leaves an order that already ends in id alone, whatever its direction", () => {
    expect(withTieBreaker([{ name: "asc" }, { id: "desc" }])).toEqual([{ name: "asc" }, { id: "desc" }]);
    expect(withTieBreaker({ id: "asc" })).toEqual([{ id: "asc" }]);
  });

  it("does not append after an earlier unique id", () => {
    expect(withTieBreaker([{ id: "asc" }, { name: "asc" }])).toEqual([{ id: "asc" }, { name: "asc" }]);
  });

  it("splits a multi-key object in key order", () => {
    expect(withTieBreaker({ status: "asc", createdAt: "desc" })).toEqual([{ status: "asc" }, { createdAt: "desc" }, { id: "asc" }]);
  });

  it("orders an empty sort by id alone", () => {
    expect(withTieBreaker(undefined)).toEqual([{ id: "asc" }]);
    expect(withTieBreaker([])).toEqual([{ id: "asc" }]);
  });

  it("uses another unique field when told to, and ignores relation keys named alike", () => {
    expect(withTieBreaker({ issueDate: "desc" }, "number")).toEqual([{ issueDate: "desc" }, { number: "asc" }]);
    expect(withTieBreaker({ project: { id: "asc" } })).toEqual([{ project: { id: "asc" } }, { id: "asc" }]);
  });

  it("keeps a stated null placement", () => {
    expect(withTieBreaker({ dueDate: sortNulls("asc", "last") })).toEqual([{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
  });
});

describe("pageWindow", () => {
  it("reads zero rows as 0 results, never 1–0", () => {
    expect(pageWindow(0, 1, 25)).toEqual({ page: 1, limit: 25, total: 0, totalPages: 1, from: 0, to: 0, outOfRange: false });
    expect(pageWindow(0, 4, 25)).toEqual({ page: 1, limit: 25, total: 0, totalPages: 1, from: 0, to: 0, outOfRange: false });
  });

  it("counts a single page", () => {
    expect(pageWindow(7, 1, 25)).toEqual({ page: 1, limit: 25, total: 7, totalPages: 1, from: 1, to: 7, outOfRange: false });
    expect(pageWindow(25, 1, 25)).toEqual({ page: 1, limit: 25, total: 25, totalPages: 1, from: 1, to: 25, outOfRange: false });
  });

  it("gives 1–25 of 73 and the partial last page", () => {
    expect(pageWindow(73, 1, 25)).toMatchObject({ from: 1, to: 25, totalPages: 3, outOfRange: false });
    expect(pageWindow(73, 3, 25)).toMatchObject({ page: 3, from: 51, to: 73, outOfRange: false });
  });

  it("flags a page past the end and clamps to the last page", () => {
    expect(pageWindow(73, 4, 25)).toEqual({ page: 3, limit: 25, total: 73, totalPages: 3, from: 51, to: 73, outOfRange: true });
    expect(pageWindow(26, 999, 25)).toMatchObject({ page: 2, from: 26, to: 26, outOfRange: true });
  });

  it("reads nonsense input safely", () => {
    expect(pageWindow(10, 0, 25)).toMatchObject({ page: 1, from: 1, to: 10, outOfRange: false });
    expect(pageWindow(10, Number.NaN, 25)).toMatchObject({ page: 1, outOfRange: false });
    expect(pageWindow(-3, 2, 25)).toMatchObject({ total: 0, from: 0, to: 0 });
    expect(pageWindow(10, 2, 0)).toMatchObject({ limit: 1, page: 2, from: 2, to: 2, totalPages: 10 });
  });
});

describe("listPageRedirect and pageHref keep every other key", () => {
  it("moves to the last valid page, keeping search, filters, section, sort and repeats", () => {
    expect(
      listPageRedirect("/finance/invoices", { search: "A 1", status: ["OPEN", "DRAFT"], section: "mine", sort: "due-asc", page: "9" }, 3),
    ).toBe("/finance/invoices?search=A+1&status=OPEN&status=DRAFT&section=mine&sort=due-asc&page=3");
  });

  it("drops the page for page 1, and for an empty list", () => {
    expect(listPageRedirect("/tasks", "?section=open&page=4", 1)).toBe("/tasks?section=open");
    expect(listPageRedirect("/tasks", new URLSearchParams("page=4"), 0)).toBe("/tasks");
  });

  it("targets a page that is always in range, so there is no loop", () => {
    const target = listPageRedirect("/x", { page: "5" }, pageWindow(73, 5, 25).totalPages);
    const page = Number(new URL(target, "http://h").searchParams.get("page"));
    expect(pageWindow(73, page, 25).outOfRange).toBe(false);
  });

  it("builds page links, relative when there is no path", () => {
    expect(pageHref("", { search: "x", page: "2" }, 3)).toBe("?search=x&page=3");
    expect(pageHref("/clients", {}, 1)).toBe("/clients");
  });
});

describe("list-toolbar query transitions", () => {
  it("returns to page 1 on a search, filter, sort or page-size change", () => {
    expect(applyListChange("section=open&sort=due-asc&page=3", { search: "roof" })).toBe("section=open&sort=due-asc&search=roof");
    expect(applyListChange("status=OPEN&page=2", { status: "" })).toBe("");
    expect(applyListChange("page=2&limit=25", { limit: "50" })).toBe("limit=50");
  });

  it("clears only the list's own filter and search keys", () => {
    expect(
      clearListFilters("workspace=x&section=mine&sort=name-asc&limit=50&status=OPEN&search=a&projectId=p1&page=2&tab=list", ["status", "projectId", "search"]),
    ).toBe("workspace=x&section=mine&sort=name-asc&limit=50&tab=list");
  });

  it("knows an unchanged query regardless of key order", () => {
    expect(sameQuery("a=1&b=2", "?b=2&a=1")).toBe(true);
    expect(sameQuery("a=1", "a=2")).toBe(false);
    expect(sameQuery(applyListChange("sort=a-asc", { sort: "a-asc" }), "sort=a-asc")).toBe(true);
  });
});

describe("header sort state", () => {
  const KEYS = ["updated-desc", "name-asc", "name-desc", "value-desc", "recent"] as const;

  it("announces the applied direction and offers the opposite", () => {
    expect(headerSortState("name", "name-asc", KEYS)).toEqual({ ariaSort: "ascending", next: "name-desc" });
    expect(headerSortState("name", "name-desc", KEYS)).toEqual({ ariaSort: "descending", next: "name-asc" });
  });

  it("offers only allowlisted directions", () => {
    expect(headerSortState("value", "value-desc", KEYS)).toEqual({ ariaSort: "descending", next: null });
    expect(headerSortState("value", "name-asc", KEYS)).toEqual({ ariaSort: "none", next: "value-desc" });
    expect(headerSortState("recent", "recent", KEYS)).toEqual({ ariaSort: "other", next: null });
    expect(headerSortState("missing", "name-asc", KEYS)).toEqual({ ariaSort: "none", next: null });
  });

  it("assumes both directions without an allowlist", () => {
    expect(headerSortState("due", undefined)).toEqual({ ariaSort: "none", next: "due-asc" });
  });

  it("reads the applied sort from the server first, then an allowlisted URL value, then the default", () => {
    expect(appliedSort("name-asc", "value-desc", KEYS, "updated-desc")).toBe("name-asc");
    expect(appliedSort(undefined, "value-desc", KEYS, "updated-desc")).toBe("value-desc");
    expect(appliedSort(undefined, "hacked-asc", KEYS, "updated-desc")).toBe("updated-desc");
    expect(appliedSort(undefined, null, KEYS, "updated-desc")).toBe("updated-desc");
  });
});
