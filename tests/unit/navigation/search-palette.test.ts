import { describe, expect, it } from "vitest";

import { groupOfType, markMatch, matchScore, SEARCH_SCOPES, stepScope } from "@/lib/core/search/palette";

/**
 * The search palette's own rules (docs/ui/UI-08-search.md): its filters by
 * kind, how a page or an action answers what was typed, and where the typed
 * text sits in a title.
 */

describe("filters by kind", () => {
  it("are All first and Pages last, and Tab steps through them, wrapping round", () => {
    expect(SEARCH_SCOPES[0]!.key).toBe("all");
    expect(SEARCH_SCOPES.at(-1)!.key).toBe("pages");
    expect(stepScope("all", 1)).toBe("projects");
    expect(stepScope("all", -1)).toBe("pages");
    expect(stepScope("pages", 1)).toBe("all");
  });

  it("put a record in its filter's group: a unit is a Unit, a person People; a kind without a filter has none", () => {
    expect(groupOfType("project")).toBe("projects");
    expect(groupOfType("project_unit")).toBe("units");
    expect(groupOfType("member")).toBe("people");
    expect(groupOfType("person")).toBe("people");
    expect(groupOfType("invoice")).toBeNull();
  });
});

describe("pages and actions answering what was typed", () => {
  it("rank a name that starts with it, then a word that does, then one containing it, then a keyword", () => {
    expect(matchScore("sal", "Sales units")).toBeGreaterThan(matchScore("sal", "Units for sale"));
    expect(matchScore("sal", "Units for sale")).toBeGreaterThan(matchScore("sal", "Proposals"));
    expect(matchScore("diary", "Daily log", ["site diary"])).toBeGreaterThan(0);
    expect(matchScore("xyz", "Daily log")).toBe(0);
    expect(matchScore("", "Daily log")).toBe(0);
  });

  it("ignore accents and case, so Albanian names are found as typed on any keyboard", () => {
    expect(matchScore("shitj", "Shitjet")).toBe(3);
    expect(matchScore("nje", "Njësitë")).toBe(3);
  });
});

describe("the typed text marked in a title", () => {
  it("cuts the title around the first match, keeping the title's own letters", () => {
    expect(markMatch("Tailor of Tirana", "tir")).toEqual(["Tailor of ", "Tir", "ana"]);
    expect(markMatch("Njësitë e shitjes", "njesi")).toEqual(["", "Njësi", "të e shitjes"]);
  });

  it("leaves a title that does not contain it whole", () => {
    expect(markMatch("T-501", "tirana")).toEqual(["T-501"]);
    expect(markMatch("T-501", "")).toEqual(["T-501"]);
  });
});
