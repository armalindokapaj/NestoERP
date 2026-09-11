import { describe, expect, it } from "vitest";

import { SCORE, normalise, scoreMatch } from "@/lib/core/search/search.types";

/**
 * Ranking has to put the obvious answer first (PRD #26 §43, §44, §48).
 */
describe("normalise", () => {
  it("folds case, accents and repeated whitespace", () => {
    expect(normalise("  Përmet   Tower ")).toBe("permet tower");
    expect(normalise("RIVERSIDE")).toBe("riverside");
  });
});

describe("scoreMatch", () => {
  it("puts an exact business number above everything else", () => {
    const code = scoreMatch("PO-2026-0042", "Some project", "PO-2026-0042");
    const title = scoreMatch("Riverside", "Riverside", null);
    expect(code).toBe(SCORE.EXACT_CODE);
    expect(code).toBeGreaterThan(title);
  });

  it("ranks exact title above prefix, and prefix above substring", () => {
    const exact = scoreMatch("riverside", "Riverside");
    const prefix = scoreMatch("river", "Riverside Tower");
    const contains = scoreMatch("tower", "Riverside Tower Phase 2");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
  });

  it("recognises a match at the start of any word", () => {
    expect(scoreMatch("tower", "Riverside Tower")).toBe(SCORE.WORD_START);
  });

  it("is case and accent insensitive", () => {
    expect(scoreMatch("RIVERSIDE", "riverside")).toBe(SCORE.EXACT_TITLE);
  });

  it("never returns zero, so a weak match still sorts deterministically", () => {
    expect(scoreMatch("zzz", "Riverside")).toBe(SCORE.FUZZY);
  });
});
