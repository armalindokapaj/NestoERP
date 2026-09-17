import { describe, expect, it } from "vitest";

import { permissionsForRole } from "@/config/role-defaults";
import { ROLE_KEYS, type RoleKey } from "@/config/roles";
import { attributesFor, defaultFloorName, findCodeConflicts, floorKeyOf, floorRank, generateUnitCodes, levelTypeForNumber, placeFloors, planFloorRange, structureKey, suggestCopiedCode, unitWarnings } from "@/lib/modules/project-structure/structure.rules";
import { bulkFloorsSchema, createFloorSchema, createUnitSchema, parseUnitListQuery, updateUnitSchema } from "@/lib/modules/project-structure/structure.schema";
import type { FloorLevelType } from "@/lib/modules/project-structure/structure.types";

/**
 * Structure rules that need no database (E-05B §12-§15, §22-§24, §37-§39,
 * §41-§44, §66, §72-§74, §98, §112, §113, §124-§126).
 *
 * The browser previews with these and the server enforces with the same
 * functions, so what a wizard shows before saving is what the save decides.
 */

const holders = (permission: string) => ROLE_KEYS.filter((role: RoleKey) => (permissionsForRole(role) as readonly string[]).includes(permission)).sort();
const floor = (levelType: FloorLevelType, number: number | null, name = defaultFloorName(levelType, number)) => ({ levelType, number, name });
const names = (floors: Array<{ name: string }>) => floors.map((row) => row.name);

describe("normalisation (§112, §113)", () => {
  it("compares codes and names trimmed, collapsed, NFKC-folded and upper-cased", () => {
    expect(structureKey("a-901")).toBe(structureKey("A-901"));
    expect(structureKey("a-901")).toBe("A-901");
    // Full-width characters a keyboard in another script produces fold to the same code.
    expect(structureKey("Ａ－９０１")).toBe("A-901");
    expect(structureKey("  block \t  a  ")).toBe("BLOCK A");
    expect(structureKey("ﬁfth ﬂoor")).toBe("FIFTH FLOOR");
    expect(structureKey("A-901")).not.toBe(structureKey("A-9O1"));
  });
});

describe("floor numbering and identity (§12-§14)", () => {
  it("names a floor from its number unless somebody types another", () => {
    expect([-2, -1, 0, 1, 9].map((number) => defaultFloorName(levelTypeForNumber(number), number))).toEqual(["Basement 2", "Basement 1", "Ground Floor", "Floor 1", "Floor 9"]);
    expect([-2, -1, 0, 1, 9].map(levelTypeForNumber)).toEqual(["BASEMENT", "BASEMENT", "GROUND", "STANDARD", "STANDARD"]);
    expect(defaultFloorName("ROOF", null)).toBe("Roof");
    expect(defaultFloorName("MEZZANINE", 0)).toBe("Mezzanine");
  });

  it("keys a numbered floor by level type and number, and an unnumbered one by its name", () => {
    expect(floorKeyOf("STANDARD", 9, "Floor 9")).toBe("STANDARD:9");
    // Renaming Floor 9 does not make it a second Floor 9.
    expect(floorKeyOf("STANDARD", 9, "Ninth floor")).toBe(floorKeyOf("STANDARD", 9, "Floor 9"));
    // A mezzanine at level 0 sits beside the ground floor, not on top of it.
    expect(floorKeyOf("MEZZANINE", 0, "Mezzanine")).not.toBe(floorKeyOf("GROUND", 0, "Ground Floor"));
    expect(floorKeyOf("ROOF", null, "Roof")).toBe(floorKeyOf("ROOF", null, "  roof "));
    expect(floorKeyOf("ROOF", null, "Roof")).not.toBe(floorKeyOf("ROOF", null, "Roof terrace"));
  });
});

describe("floor order (§15)", () => {
  it("places basements deepest first, then ground, mezzanine, standard floors, roof and technical levels", () => {
    const added = [floor("ROOF", null), floor("STANDARD", 2), floor("TECHNICAL", null), floor("BASEMENT", -1), floor("GROUND", 0), floor("STANDARD", 1), floor("MEZZANINE", 0), floor("BASEMENT", -2)];
    expect(names(placeFloors([], added))).toEqual(["Basement 2", "Basement 1", "Ground Floor", "Mezzanine", "Floor 1", "Floor 2", "Roof", "Technical Floor"]);
    expect(floorRank("BASEMENT", -2)).toBeLessThan(floorRank("BASEMENT", -1));
    expect(floorRank("STANDARD", 500)).toBeLessThan(floorRank("ROOF", null));
  });

  it("slots a basement and the ground floor in below floors that already exist", () => {
    const existing = [floor("STANDARD", 1), floor("STANDARD", 2), floor("STANDARD", 3)];
    expect(names(placeFloors(existing, [floor("BASEMENT", -1), floor("GROUND", 0)]))).toEqual(["Basement 1", "Ground Floor", "Floor 1", "Floor 2", "Floor 3"]);
  });

  it("keeps an order somebody set by hand and puts new floors beside it", () => {
    const handOrdered = [floor("STANDARD", 3), floor("STANDARD", 1), floor("STANDARD", 2)];
    const placed = placeFloors(handOrdered, [floor("STANDARD", 4), floor("BASEMENT", -1)]);
    expect(names(placed)).toEqual(["Basement 1", "Floor 3", "Floor 1", "Floor 2", "Floor 4"]);
    // The existing rows themselves are the same objects, in the same relative order.
    expect(placed.filter((row) => handOrdered.includes(row))).toEqual(handOrdered);
    expect(handOrdered).toHaveLength(3);
  });

  it("plans a range from two basements to Floor 12 (§37, §38)", () => {
    const plan = planFloorRange(-2, 12);
    expect(plan).toHaveLength(15);
    expect(plan[0]).toEqual({ number: -2, levelType: "BASEMENT", name: "Basement 2" });
    expect(plan[1]).toEqual({ number: -1, levelType: "BASEMENT", name: "Basement 1" });
    expect(plan[2]).toEqual({ number: 0, levelType: "GROUND", name: "Ground Floor" });
    expect(plan.at(-1)).toEqual({ number: 12, levelType: "STANDARD", name: "Floor 12" });
    expect(new Set(plan.map((draft) => floorKeyOf(draft.levelType, draft.number, draft.name))).size).toBe(15);
    expect(planFloorRange(3, 1)).toEqual([]);
  });
});

describe("unit code patterns (§41-§44)", () => {
  it("generates prefix, padded number and suffix", () => {
    expect(generateUnitCodes({ prefix: "A-", start: 901, end: 908, padding: 0, suffix: "" })).toEqual(["A-901", "A-902", "A-903", "A-904", "A-905", "A-906", "A-907", "A-908"]);
    const parking = generateUnitCodes({ prefix: "P-", start: 1, end: 50, padding: 3, suffix: "" });
    expect(parking).toHaveLength(50);
    expect([parking[0], parking[9], parking[49]]).toEqual(["P-001", "P-010", "P-050"]);
    expect(generateUnitCodes({ prefix: "B2-", start: 501, end: 508, padding: 4, suffix: "" })).toEqual(["B2-0501", "B2-0502", "B2-0503", "B2-0504", "B2-0505", "B2-0506", "B2-0507", "B2-0508"]);
    expect(generateUnitCodes({ prefix: "S", start: 1, end: 2, padding: 2, suffix: "-L" })).toEqual(["S01-L", "S02-L"]);
    // Padding never cuts a number that is already wider.
    expect(generateUnitCodes({ prefix: "", start: 1000, end: 1000, padding: 2, suffix: "" })).toEqual(["1000"]);
  });

  it("tells a code the project already has from one the batch repeats, whatever the case", () => {
    const conflicts = findCodeConflicts(["A-901", "a-902", "A-903", " a-901 ", "A-902"], [structureKey("A-902")]);
    expect(conflicts).toEqual([
      { index: 1, value: "a-902", reason: "EXISTS" },
      { index: 3, value: " a-901 ", reason: "REPEATED" },
      { index: 4, value: "A-902", reason: "EXISTS" },
    ]);
    expect(findCodeConflicts(["A-901", "A-902"], [])).toEqual([]);
  });

  it("suggests a copied unit's code from the target floor's number (§98)", () => {
    expect(suggestCopiedCode("A-801", 8, 9)).toBe("A-901");
    expect(suggestCopiedCode("B2-0501", 5, 6)).toBe("B2-0601");
    expect(suggestCopiedCode("A-904", 9, 10)).toBe("A-1004");
    // A code that does not carry the floor number comes back for the person to edit.
    expect(suggestCopiedCode("P-A01", 8, 9)).toBe("P-A01");
    expect(suggestCopiedCode("SHOP", 8, 9)).toBe("SHOP");
    expect(suggestCopiedCode("A-8", 8, 9)).toBe("A-8");
    // Basements and unnumbered levels are not guessed at.
    expect(suggestCopiedCode("P-101", -1, -2)).toBe("P-101");
    expect(suggestCopiedCode("R-01", null, 9)).toBe("R-01");
  });
});

describe("fields by type (§22, §71, §74)", () => {
  it("keeps the attributes each category shows", () => {
    expect(attributesFor("PARKING")).toEqual(["covered", "evReady"]);
    expect(attributesFor("COMMERCIAL")).toEqual(["frontage", "ceilingHeight"]);
    expect(attributesFor("STORAGE")).toEqual(["ceilingHeight"]);
    expect(attributesFor("RESIDENTIAL")).toEqual([]);
  });

  it("warns, never refuses: bedrooms on parking, a saleable area below the internal one", () => {
    expect(unitWarnings("PARKING", { bedrooms: 2 })).toEqual(["A parking unit does not usually have bedrooms."]);
    expect(unitWarnings("PARKING", { bedrooms: 0, rooms: null })).toEqual([]);
    expect(unitWarnings("RESIDENTIAL", { rooms: 3, bedrooms: 2, bathrooms: 1 })).toEqual([]);
    expect(unitWarnings("RESIDENTIAL", { internalArea: "92.40", saleableArea: "90.00" })).toEqual(["The saleable area is smaller than the internal area."]);
    expect(unitWarnings("RESIDENTIAL", { internalArea: "92.40", saleableArea: "113.00" })).toEqual([]);
    expect(unitWarnings("RESIDENTIAL", { internalArea: "92.40", saleableArea: null })).toEqual([]);
  });
});

describe("validation (§72, §73, §124-§126)", () => {
  const base = { unitCode: "A-901", unitTypeId: "utype_apartment" };

  it("keeps areas as exact strings and blanks as null", () => {
    const parsed = createUnitSchema.parse({ ...base, internalArea: "92.40", saleableArea: 113, grossArea: "", balconyArea: " 12.5 ", bedrooms: "", rooms: "3" });
    expect(parsed).toMatchObject({ internalArea: "92.40", saleableArea: "113", grossArea: null, balconyArea: "12.5", terraceArea: null, bedrooms: null, rooms: 3, name: null, position: null, orientation: null, attributes: null });
    expect(typeof parsed.internalArea).toBe("string");
  });

  it("refuses a negative area, a third decimal, half a bedroom and an area past DECIMAL(12,2)", () => {
    expect(createUnitSchema.safeParse({ ...base, internalArea: "-1" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, internalArea: -1 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, saleableArea: "12.345" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, saleableArea: "12345678901" }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, bedrooms: 2.5 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, bedrooms: -1 }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, unitCode: "   " }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, unitTypeId: "" }).success).toBe(false);
  });

  it("validates attributes against their fixed schema", () => {
    expect(createUnitSchema.parse({ ...base, attributes: { covered: true, frontage: "9.40" } }).attributes).toEqual({ covered: true, frontage: "9.40" });
    expect(createUnitSchema.safeParse({ ...base, attributes: { sauna: true } }).success).toBe(false);
    expect(createUnitSchema.safeParse({ ...base, attributes: { frontage: "9.405" } }).success).toBe(false);
  });

  it("makes an edit name the version it read", () => {
    expect(updateUnitSchema.safeParse({ ...base, isActive: true }).success).toBe(false);
    expect(updateUnitSchema.safeParse({ ...base, isActive: true, expectedVersion: 1 }).success).toBe(true);
  });

  it("numbers basements below zero and every standard floor", () => {
    expect(createFloorSchema.safeParse({ number: -1, name: "Basement 1", levelType: "BASEMENT" }).success).toBe(true);
    expect(createFloorSchema.safeParse({ number: 1, name: "Basement 1", levelType: "BASEMENT" }).success).toBe(false);
    expect(createFloorSchema.safeParse({ number: null, name: "Floor", levelType: "STANDARD" }).success).toBe(false);
    expect(createFloorSchema.safeParse({ number: "", name: "Roof", levelType: "ROOF" }).success).toBe(true);
    expect(createFloorSchema.safeParse({ number: 1.5, name: "Floor 1.5", levelType: "STANDARD" }).success).toBe(false);
    expect(bulkFloorsSchema.parse({ floors: planFloorRange(1, 3) })).toMatchObject({ confirmLarge: false, dryRun: false });
    expect(bulkFloorsSchema.safeParse({ floors: planFloorRange(1, 201) }).success).toBe(false);
  });

  it("reads the unit list query, dropping junk instead of failing (§66)", () => {
    const query = parseUnitListQuery(
      new URLSearchParams("q=%20%20A-9%20&floorId=flr_riverside_a_1&buildingId=../etc&orientation=UP&bedrooms=two&bathrooms=1&saleableAreaMin=80&saleableAreaMax=abc&sort=weird&page=0&limit=500&unknown=1"),
    );
    expect(query).toEqual({
      q: "A-9",
      floorId: "flr_riverside_a_1",
      buildingId: undefined,
      unitTypeId: undefined,
      orientation: undefined,
      position: undefined,
      bedrooms: undefined,
      bathrooms: 1,
      internalAreaMin: undefined,
      internalAreaMax: undefined,
      saleableAreaMin: "80",
      saleableAreaMax: undefined,
      sort: undefined,
      page: 1,
      limit: 50,
    });
    const fromRecord = parseUnitListQuery({ orientation: ["NE", "SW"], sort: "-saleableArea", page: "3", bedrooms: "" });
    expect(fromRecord).toMatchObject({ orientation: "NE", sort: "-saleableArea", page: 3, limit: 50 });
    expect(fromRecord.bedrooms).toBeUndefined();
  });
});

describe("default role policy (§58, §59, §138)", () => {
  const WRITES = ["project.structure.manage", "project.building.create", "project.building.update", "project.building.delete", "project.floor.create", "project.floor.update", "project.floor.delete", "project.unit.create", "project.unit.update", "project.unit.delete", "project.unit.move"];

  it("gives the structure to the Owner, Project Manager, Admin, Architect and Architecture Manager, and to nobody else", () => {
    for (const permission of WRITES) expect(holders(permission), permission).toEqual(["ADMIN", "ARCHITECT", "ARCHITECTURE_MANAGER", "OWNER", "PROJECT_MANAGER"]);
    expect(holders("project.unit_type.manage")).toEqual(["ADMIN", "OWNER"]);
  });

  it("lets everybody who can open a project read its structure, Sales and Finance included", () => {
    for (const role of ROLE_KEYS) {
      const granted = permissionsForRole(role) as readonly string[];
      expect(granted.includes("project.structure.view"), role).toBe(granted.includes("project.view"));
    }
    expect(holders("project.structure.view")).toEqual(expect.arrayContaining(["ENGINEER", "SALES", "FINANCE", "VIEWER", "CEO"]));
  });
});
