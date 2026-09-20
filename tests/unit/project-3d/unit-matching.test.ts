import { describe, expect, it } from "vitest";

import { autoMatchUnitNodes, normalizeUnitMatchKey } from "@/lib/3d/shared/unit-matching";

describe("3D unit-node matching", () => {
  it("normalizes the source Unit_ convention and punctuation", () => {
    expect(normalizeUnitMatchKey("Unit_A-10.01")).toBe("a1001");
    expect(normalizeUnitMatchKey("a 10-01")).toBe("a1001");
  });

  it("matches canonical unit codes without replacing a manual choice", () => {
    expect(autoMatchUnitNodes(
      ["Unit_A-101", "Unit_B_202", "Unit_UNKNOWN"],
      [{ id: "unit-a", unitCode: "A 101" }, { id: "unit-b", unitCode: "B-202" }],
      { "Unit_A-101": "manual" },
    )).toEqual({ "Unit_A-101": "manual", "Unit_B_202": "unit-b" });
  });
});
