import { describe, expect, it } from "vitest";

import {
  appliedDraftQuery,
  appliedFilterValue,
  clearedDraft,
  draftChanged,
  draftCount,
  draftFromApplied,
  filterChips,
  removeFilterQuery,
  setDraftValue,
  type FilterConfig,
} from "@/lib/tables/filter-draft";
import { sameQuery } from "@/lib/tables/list-url";

/**
 * AUD-04 §5, MW-06: the staged filter sheet's apply model, as pure
 * transitions. Expected queries are written out by hand.
 */

const STATUS: FilterConfig = {
  param: "status",
  label: "Status",
  options: [
    { value: "OPEN", label: "Open" },
    { value: "DONE", label: "Done" },
  ],
};
const PROJECT: FilterConfig = {
  param: "projectId",
  label: "Project",
  options: [
    { value: "p1", label: "North tower" },
    { value: "p2", label: "A very long project name that has to wrap on a 320px phone" },
  ],
};
const FILTERS = [STATUS, PROJECT];

/** The applied values as the toolbar reads them: server value first, then an offered URL value. */
function appliedFrom(url: string, server: Record<string, string> = {}) {
  const params = new URLSearchParams(url);
  return (filter: FilterConfig) => appliedFilterValue(filter.options, server[filter.param], params.get(filter.param));
}

describe("the applied value a control shows", () => {
  it("prefers the server-parsed value, then an offered URL value, else All", () => {
    expect(appliedFilterValue(STATUS.options, "DONE", "OPEN")).toBe("DONE");
    expect(appliedFilterValue(STATUS.options, undefined, "OPEN")).toBe("OPEN");
    expect(appliedFilterValue(STATUS.options, undefined, "BOGUS")).toBe("");
    expect(appliedFilterValue(STATUS.options, "BOGUS", null)).toBe("");
  });

  it("falls back to the first option where All is not allowed (a sort)", () => {
    expect(appliedFilterValue(STATUS.options, undefined, "BOGUS", false)).toBe("OPEN");
  });
});

describe("staging", () => {
  it("opens with the applied values, one per filter", () => {
    expect(draftFromApplied(FILTERS, appliedFrom("status=OPEN&search=roof"))).toEqual({ status: "OPEN", projectId: "" });
  });

  it("changes only the draft; an unoffered value is refused", () => {
    const draft = draftFromApplied(FILTERS, appliedFrom("status=OPEN"));
    const next = setDraftValue(draft, PROJECT, "p2");
    expect(next).toEqual({ status: "OPEN", projectId: "p2" });
    expect(draft).toEqual({ status: "OPEN", projectId: "" });
    expect(setDraftValue(next, PROJECT, "p-foreign")).toBe(next);
    expect(setDraftValue(next, STATUS, "")).toEqual({ status: "", projectId: "p2" });
  });

  it("Clear empties every field, still staged; the counts follow the draft", () => {
    const draft = { status: "OPEN", projectId: "p1" };
    expect(draftCount(FILTERS, draft)).toBe(2);
    const cleared = clearedDraft(FILTERS);
    expect(cleared).toEqual({ status: "", projectId: "" });
    expect(draftCount(FILTERS, cleared)).toBe(0);
    expect(draftChanged(FILTERS, cleared, draft)).toBe(true);
  });

  it("Cancel is the applied values standing: a reopened sheet drafts them again", () => {
    const applied = appliedFrom("status=OPEN");
    let draft = draftFromApplied(FILTERS, applied);
    draft = setDraftValue(draft, STATUS, "DONE");
    expect(draft.status).toBe("DONE");
    // Cancel drops `draft`; the next open starts from what is applied.
    expect(draftFromApplied(FILTERS, applied)).toEqual({ status: "OPEN", projectId: "" });
    expect(draftChanged(FILTERS, draftFromApplied(FILTERS, applied), { status: "OPEN", projectId: "" })).toBe(false);
  });
});

describe("Apply", () => {
  it("writes the whole draft at once, keeps unrelated keys and returns to page 1", () => {
    const query = appliedDraftQuery(
      "status=OPEN&search=roof&sort=due-asc&limit=50&section=mine&page=3",
      FILTERS,
      { status: "DONE", projectId: "p1" },
    );
    expect(sameQuery(query, "status=DONE&projectId=p1&search=roof&sort=due-asc&limit=50&section=mine")).toBe(true);
  });

  it("removes a filter set to All and leaves filters the draft does not name", () => {
    expect(appliedDraftQuery("status=OPEN&projectId=p1&page=2", FILTERS, { status: "" })).toBe("projectId=p1");
  });

  it("an unchanged draft yields the same query apart from the page, so nothing is re-sent", () => {
    const current = "status=OPEN&search=roof";
    expect(sameQuery(appliedDraftQuery(current, FILTERS, { status: "OPEN", projectId: "" }), current)).toBe(true);
  });

  it("honours a custom page parameter", () => {
    expect(appliedDraftQuery("status=OPEN&p=4", FILTERS, { status: "DONE" }, "p")).toBe("status=DONE");
  });
});

describe("chips outside the sheet", () => {
  it("one chip per applied filter, named by its filter and option", () => {
    expect(filterChips(FILTERS, appliedFrom("status=DONE&projectId=p2"))).toEqual([
      { param: "status", label: "Status", value: "DONE", valueLabel: "Done" },
      { param: "projectId", label: "Project", value: "p2", valueLabel: "A very long project name that has to wrap on a 320px phone" },
    ]);
  });

  it("no chip for a URL value the server did not apply", () => {
    expect(filterChips(FILTERS, appliedFrom("status=BOGUS"))).toEqual([]);
  });

  it("removing a chip drops that key only and the page", () => {
    expect(removeFilterQuery("status=DONE&projectId=p2&search=roof&page=2", "status")).toBe("projectId=p2&search=roof");
  });
});
