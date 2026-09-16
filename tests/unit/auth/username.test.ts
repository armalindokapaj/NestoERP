import { describe, expect, it } from "vitest";

import {
  normaliseUsername,
  RESERVED_USERNAMES,
  suggestUsername,
  usernameProblem,
} from "@/lib/auth/username";

/** PRD #50 §7-§9. */

describe("normalisation", () => {
  it("trims and lowercases, so one account is one account", () => {
    expect(normaliseUsername("  Owner  ")).toBe("owner");
    expect(normaliseUsername("OWNER")).toBe("owner");
  });

  it("collapses characters that only look different", () => {
    // A fullwidth A is not an A until NFKC says so; without this, `ａdmin`
    // would be a second account indistinguishable from the first in any list.
    expect(normaliseUsername("ＡＤＭＩＮ")).toBe("admin");
    expect(usernameProblem("ＡＤＭＩＮ")).toBe("RESERVED");
  });
});

describe("shape", () => {
  it.each([
    ["owner", null],
    ["a.b_c-d", null],
    ["arta.krasniqi", null],
    ["ab", "SHAPE"],
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["has space", "SHAPE"],
    ["ends.", "SHAPE"],
    [".starts", "SHAPE"],
    ["has@at", "SHAPE"],
    ["x".repeat(40), "SHAPE"],
  ])("%s", (input, expected) => {
    expect(usernameProblem(input)).toBe(expected);
  });

  it("refuses an address as a username, so the two identifiers cannot be confused", () => {
    expect(usernameProblem("owner@nesto.test")).toBe("SHAPE");
  });
});

describe("reserved names", () => {
  it("refuses every name the platform keeps", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(usernameProblem(name), name).toBe("RESERVED");
    }
  });

  it("refuses them however they are typed", () => {
    expect(usernameProblem("  SuPPorT ")).toBe("RESERVED");
  });
});

describe("suggestions", () => {
  it("builds one from a name", () => {
    expect(suggestUsername("Arta", "Krasniqi")).toBe("arta.krasniqi");
  });

  it("strips what a username may not contain", () => {
    expect(suggestUsername("Anne-Marie", "O'Brien")).toBe("annemarie.obrien");
  });

  it("folds accents rather than dropping the letters under them", () => {
    // Ünal must suggest unal, not nal: these are ordinary names here.
    expect(suggestUsername("Éa", "Ünal")).toBe("ea.unal");
    expect(suggestUsername("Besnik", "Krasniqi")).toBe("besnik.krasniqi");
  });

  it("still returns something usable for a name too short to use", () => {
    const suggestion = suggestUsername("Jo", "");
    expect(usernameProblem(suggestion)).toBeNull();
  });

  it("never suggests something the shape rules would refuse", () => {
    for (const [first, last] of [["Ana", "Li"], ["X", "Y"], ["Éa", "Ünal"], ["", ""]]) {
      const suggestion = suggestUsername(first, last);
      expect(usernameProblem(suggestion), `${first} ${last} -> ${suggestion}`).toBeNull();
    }
  });
});
