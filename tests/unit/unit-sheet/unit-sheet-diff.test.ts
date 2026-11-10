import { describe, expect, it } from "vitest";

import { changeId, compareField, comparePrice, diffSheet, type FieldOutcome, type MatchedUnit, newUnitBaseline, nextBaseline, planUnits, type SheetDiff, type UnitBaseline } from "@/lib/modules/unit-sheet/unit-sheet.diff";
import type { SheetField } from "@/lib/modules/unit-sheet/unit-sheet.types";
import { baselines, grid, input, unit, units } from "./sheet-fixtures";

/**
 * Comparing a sheet with NESTO (2026-11-10): every case of the three-way
 * comparison, prices from either column, new units, and the baseline a
 * confirmed sync leaves — so that what was not taken comes back, and a clash
 * kept as NESTO has it comes back as newer in NESTO.
 */

function outcomesOf(diff: SheetDiff, unitId: string): FieldOutcome[] {
  return diff.matched.find((matched) => matched.unit.id === unitId)?.outcomes ?? [];
}
function outcome(diff: SheetDiff, unitId: string, field: SheetField): FieldOutcome | undefined {
  return outcomesOf(diff, unitId).find((one) => one.field === field);
}
const reasons = (diff: SheetDiff) => diff.skipped.map((skip) => [skip.row, skip.reason, skip.field]);

describe("the three-way comparison of one field", () => {
  it("with no baseline, every difference is a change from the sheet", () => {
    expect(compareField("70.00", "64.72", undefined)).toBe("change");
    expect(compareField("64.72", "64.72", undefined)).toBe("agree");
  });

  it("sheet moved, NESTO did not: a change; NESTO moved, the sheet did not: newer in NESTO", () => {
    expect(compareField("70.00", "64.72", { s: "64.72", n: "64.72" })).toBe("change");
    expect(compareField("64.72", "66.00", { s: "64.72", n: "64.72" })).toBe("newer");
  });

  it("both moved to different values: a clash; to the same value: nothing", () => {
    expect(compareField("70.00", "66.00", { s: "64.72", n: "64.72" })).toBe("clash");
    expect(compareField("70.00", "70.00", { s: "64.72", n: "64.72" })).toBe("agree");
  });

  it("neither moved yet they differ (NESTO saved it differently): the sheet is behind", () => {
    expect(compareField("64.72", "65.00", { s: "64.72", n: "65.00" })).toBe("newer");
  });
});

describe("a sheet against the project", () => {
  it("first sync: differences are changes, equal values agree, by T-501 and by the bare code with a Building column", () => {
    const diff = diffSheet(input(grid(["Unit", "Building", "Internal area (m²)", "Bedrooms"], [["T-501", "", 70, 2], [502, "Tower", 50, 3]])));
    expect(outcome(diff, "u501", "internalArea")).toMatchObject({ kind: "change", from: "64.72", to: "70.00" });
    expect(outcome(diff, "u501", "bedrooms")).toEqual({ kind: "agree", field: "bedrooms" });
    expect(outcome(diff, "u502", "bedrooms")).toMatchObject({ kind: "change", from: "1", to: "3" });
    expect(outcome(diff, "u502", "internalArea")).toEqual({ kind: "agree", field: "internalArea" });
    expect(diff.skipped).toEqual([]);
  });

  it("a column the sheet does not have is a field it does not manage — never an empty one", () => {
    const diff = diffSheet(input(grid(["Unit", "Bedrooms"], [["T-501", 2]])));
    expect(outcomesOf(diff, "u501").map((one) => one.field)).toEqual(["bedrooms"]);
  });

  it("an empty cell in a column it has asks for the value to be cleared", () => {
    const diff = diffSheet(input(grid(["Unit", "Internal area (m²)", "Orientation"], [["T-501", null, null]])));
    expect(outcome(diff, "u501", "internalArea")).toMatchObject({ kind: "change", from: "64.72", to: null });
    expect(outcome(diff, "u501", "orientation")).toMatchObject({ kind: "change", from: "NE", to: null });
  });

  it("with a baseline: a sheet-only change, a NESTO-only change, a clash and a shared change", () => {
    const base = baselines({ u501: { internalArea: { s: "60.00", n: "60.00" }, bedrooms: { s: "2", n: "2" }, bathrooms: { s: "1", n: "2" }, balconyArea: { s: "5.00", n: "5.00" } } });
    // NESTO has internal 64.72 (moved), bedrooms 2 (not), bathrooms 1 (moved from 2), balcony 8.00 (moved).
    const sheet = grid(["Unit", "Internal area (m²)", "Bedrooms", "Bathrooms", "Balcony area (m²)"], [["T-501", 60, 3, 3, 8]]);
    const diff = diffSheet(input(sheet, { baselines: base }));
    expect(outcome(diff, "u501", "internalArea")).toMatchObject({ kind: "newer", sheet: "60.00", nesto: "64.72" });
    expect(outcome(diff, "u501", "bedrooms")).toMatchObject({ kind: "change", from: "2", to: "3" });
    expect(outcome(diff, "u501", "bathrooms")).toMatchObject({ kind: "clash", sheet: "3", nesto: "1" });
    expect(outcome(diff, "u501", "balconyArea")).toEqual({ kind: "agree", field: "balconyArea" });
  });

  it("reads headers in Albanian, without accents, and in any case", () => {
    const diff = diffSheet(input(grid(["njesia", "SIPERFAQJA E BRENDSHME (M2)", "Dhoma gjumi", "Orientimi"], [["T-501", 70, 2, "Verilindje"]])));
    expect(outcome(diff, "u501", "internalArea")).toMatchObject({ kind: "change", to: "70.00" });
    expect(outcome(diff, "u501", "orientation")).toEqual({ kind: "agree", field: "orientation" });
    expect(diff.check.unknownColumns).toEqual([]);
  });

  it("lists unknown columns once and ignores them; the worked-out columns are read only", () => {
    const diff = diffSheet(input(grid(["Unit", "Notes", "Net area (m²) – worked out", "Gross area (m²) – worked out, typed for land", "Bedrooms", "Bedrooms"], [["T-501", "corner", 1, 2, 2, 3]])));
    expect(diff.check.unknownColumns).toEqual([
      { column: "B", header: "Notes" },
      { column: "F", header: "Bedrooms" },
    ]);
    expect(diff.check.columns.filter((column) => column.readOnly).map((column) => column.key)).toEqual(["netArea", "grossArea"]);
    // The net area is never read, and the gross area is read only for land: T-501 is an apartment.
    expect(outcomesOf(diff, "u501").map((one) => one.field)).toEqual(["bedrooms"]);
  });

  it("reads land's typed gross area, and only land's", () => {
    const diff = diffSheet(input(grid(["Unit", "Gross area (m²)"], [["T-L1", 650], ["T-502", 999]])));
    expect(outcome(diff, "ul1", "grossArea")).toMatchObject({ kind: "change", from: "500.00", to: "650.00" });
    expect(outcomesOf(diff, "u502")).toEqual([]);
  });

  it("reads a decimal comma written as text, whatever the sheet's locale, and refuses what it cannot read", () => {
    const diff = diffSheet(input(grid(["Unit", "Internal area (m²)", "Balcony area (m²)", "Bedrooms"], [["T-501", "64,72", "1,234", "two"]], false)));
    expect(outcome(diff, "u501", "internalArea")).toEqual({ kind: "agree", field: "internalArea" });
    expect(outcome(diff, "u501", "balconyArea")).toBeUndefined();
    expect(reasons(diff)).toEqual([
      [2, "invalid_value", "balconyArea"],
      [2, "invalid_value", "bedrooms"],
    ]);
    expect(diff.skipped[0]!.value).toBe("1,234");
  });

  it("applies the unit forms' ranges: bedrooms 0-3, bathrooms 1-3, storage 0 or 1, areas 0 or more with two decimals", () => {
    const diff = diffSheet(input(grid(["Unit", "Bedrooms", "Bathrooms", "Storage", "Internal area (m²)", "Terrace area (m²)"], [["T-501", 4, 0, 2, -5, 12.345]])));
    expect(reasons(diff).map(([, reason, field]) => [reason, field])).toEqual([
      ["invalid_value", "internalArea"],
      ["invalid_value", "terraceArea"],
      ["invalid_value", "bedrooms"],
      ["invalid_value", "bathrooms"],
      ["invalid_value", "storage"],
    ]);
    expect(outcomesOf(diff, "u501")).toEqual([]);
  });

  it("matches the type by its name or code in either language, and refuses an unknown or a retired one", () => {
    const diff = diffSheet(input(grid(["Unit", "Type"], [["T-501", "Apartament"], ["T-502", "parking"], ["B-101", "Duplex"], ["T-P1", "Castle"]])));
    expect(outcome(diff, "u501", "type")).toEqual({ kind: "agree", field: "type" });
    expect(outcome(diff, "u502", "type")).toMatchObject({ kind: "change", from: "type_apt", to: "type_park" });
    expect(reasons(diff)).toEqual([
      [4, "invalid_value", "type"],
      [5, "invalid_value", "type"],
    ]);
  });

  it("skips a code matching two units, unless the Building column tells them apart", () => {
    const list = [...units(), unit("uX", "T-501", "b_b")];
    // "T-501" is T's unit 501 and Block B's unit whose own code is "T-501".
    const ambiguous = diffSheet(input(grid(["Unit", "Bedrooms"], [["T-501", 3]]), { units: list }));
    expect(reasons(ambiguous)).toEqual([[2, "ambiguous_code", null]]);
    const resolved = diffSheet(input(grid(["Unit", "Building", "Bedrooms"], [["T-501", "Block B", 3]]), { units: list }));
    expect(resolved.matched.map((matched) => matched.unit.id)).toEqual(["uX"]);
  });

  it("skips both rows of a unit the sheet names twice, an archived unit, and a unit the sheet puts in another building", () => {
    const diff = diffSheet(input(grid(["Unit", "Building", "Bedrooms"], [["T-501", "", 3], ["501", "T", 1], ["T-503", "", 1], ["T-502", "Block B", 1]])));
    expect(reasons(diff)).toEqual([
      [2, "duplicate_row", null],
      [3, "duplicate_row", null],
      [4, "archived", null],
      [5, "building_mismatch", null],
    ]);
    expect(diff.matched).toEqual([]);
    expect(diff.notInSheet.map((one) => one.id)).toEqual(["u101", "up1", "ul1"]);
  });

  it("says a row with data but no code has none; an empty row is no row", () => {
    const diff = diffSheet(input(grid(["Unit", "Bedrooms"], [[null, 2], [null, null], ["T-501", 2]])));
    expect(reasons(diff)).toEqual([[2, "no_code", null]]);
    expect(diff.check.rows).toBe(2);
  });

  it("refuses to compare a sheet with no Unit column", () => {
    const diff = diffSheet(input(grid(["Code", "Bedrooms"], [["T-501", 2]])));
    expect(diff.check.hasCodeColumn).toBe(false);
    expect(diff.matched).toEqual([]);
  });
});

describe("prices", () => {
  const P = ["Unit", "Total price", "Price per m²"];

  it("a new total is that total; a new price per m² is that rate on the sale area — saleable when typed", () => {
    const byTotal = diffSheet(input(grid(P, [["T-501", 170000, 2000]])));
    expect(outcome(byTotal, "u501", "price")).toMatchObject({ kind: "change", from: "160000.00", to: "170000.00", price: { entry: "TOTAL", total: "170000.00", rate: "2125.00", area: "80.00" } });
    // Untouched total, new rate: 2,100 × 80.00 saleable.
    const byRate = diffSheet(input(grid(P, [["T-501", 160000, 2100]])));
    expect(outcome(byRate, "u501", "price")).toMatchObject({ kind: "change", to: "168000.00", price: { entry: "PER_SQM", total: "168000.00", rate: "2100.00", area: "80.00" } });
  });

  it("…else on the gross area, as it will be after this sync's area changes", () => {
    // T-502 has no saleable area; its internal area goes to 60, so its gross is 60.
    const diff = diffSheet(input(grid(["Unit", "Internal area (m²)", "Price per m²"], [["T-502", 60, 1000]])));
    expect(outcome(diff, "u502", "price")).toMatchObject({ kind: "change", from: null, to: "60000.00", price: { entry: "PER_SQM", area: "60.00" } });
  });

  it("agrees with a file as it was downloaded: the total and its rate on today's area", () => {
    const diff = diffSheet(input(grid(P, [["T-501", 160000, 2000], ["T-P1", 15000, null], ["T-502", null, null]])));
    expect(outcome(diff, "u501", "price")).toEqual({ kind: "agree", field: "price" });
    // A parking space has no area, so no rate; an empty rate agrees.
    expect(outcome(diff, "up1", "price")).toEqual({ kind: "agree", field: "price" });
    expect(outcome(diff, "u502", "price")).toEqual({ kind: "agree", field: "price" });
  });

  it("both columns changed must agree to the cent, or neither is used", () => {
    const consistent = diffSheet(input(grid(P, [["T-501", 168000, 2100]])));
    expect(outcome(consistent, "u501", "price")).toMatchObject({ kind: "change", price: { entry: "TOTAL", total: "168000.00" } });
    const inconsistent = diffSheet(input(grid(P, [["T-501", 168000, 2500]])));
    expect(outcome(inconsistent, "u501", "price")).toBeUndefined();
    expect(reasons(inconsistent)).toEqual([[2, "price_inconsistent", "price"]]);
  });

  it("only the column that changed counts, measured against the baseline", () => {
    const base = baselines({ u501: { price: { s: "160000.00", r: "2000.00", n: "160000.00" } } });
    // The area moved since: the sheet's rate is stale but untouched, so the total stands.
    const diff = diffSheet(input(grid(["Unit", "Saleable area (m²)", "Total price", "Price per m²"], [["T-501", 100, 160000, 2000]]), { baselines: base }));
    expect(outcome(diff, "u501", "price")).toEqual({ kind: "agree", field: "price" });
  });

  it("a sheet may keep its prices in either column: an empty cell beside a filled one says nothing", () => {
    const diff = diffSheet(input(grid(P, [["T-501", 170000, null], ["T-502", null, 1000], ["B-101", null, null]])));
    expect(outcome(diff, "u501", "price")).toMatchObject({ kind: "change", to: "170000.00", price: { entry: "TOTAL" } });
    expect(outcome(diff, "u502", "price")).toMatchObject({ kind: "change", to: "50000.00", price: { entry: "PER_SQM", rate: "1000.00" } });
    expect(outcome(diff, "u101", "price")).toEqual({ kind: "agree", field: "price" });
    expect(diff.skipped).toEqual([]);
    // Only a Price per m² column, emptied, on a priced unit with an area: the price is cleared.
    const rateOnly = diffSheet(input(grid(["Unit", "Price per m²"], [["T-501", null], ["T-P1", null]])));
    expect(outcome(rateOnly, "u501", "price")).toMatchObject({ kind: "change", to: null });
    expect(outcome(rateOnly, "up1", "price")).toEqual({ kind: "agree", field: "price" });
  });

  it("a rate on a unit with no area is skipped; an emptied total clears the price", () => {
    const diff = diffSheet(input(grid(P, [["T-P1", 15000, 300], ["T-501", null, null]])));
    expect(reasons(diff)).toEqual([[2, "no_area", "price"]]);
    expect(outcome(diff, "u501", "price")).toMatchObject({ kind: "change", from: "160000.00", to: null });
  });

  it("a price clash, and newer in NESTO", () => {
    const base = baselines({ u501: { price: { s: "150000.00", n: "150000.00" } } });
    const clash = diffSheet(input(grid(["Unit", "Total price"], [["T-501", 155000]]), { baselines: base }));
    expect(outcome(clash, "u501", "price")).toMatchObject({ kind: "clash", sheet: "155000.00", nesto: "160000.00" });
    const newer = diffSheet(input(grid(["Unit", "Total price"], [["T-501", 150000]]), { baselines: base }));
    expect(outcome(newer, "u501", "price")).toMatchObject({ kind: "newer", sheet: "150000.00", nesto: "160000.00" });
  });

  it("a reader without the price grant gets the price skipped; a sold unit's price does not change", () => {
    const denied = diffSheet(input(grid(["Unit", "Total price"], [["T-501", 170000]]), { can: { managePrice: false, createUnit: true } }));
    expect(reasons(denied)).toEqual([[2, "price_not_allowed", "price"]]);
    const sold = diffSheet(input(grid(["Unit", "Total price"], [["T-501", 170000]]), { units: units().map((one) => (one.id === "u501" ? { ...one, status: "SOLD" as const } : one)) }));
    expect(reasons(sold)).toEqual([[2, "sold", "price"]]);
  });

  it("comparePrice works on cents, never floats", () => {
    expect(comparePrice({ read: { hasTotal: false, hasRate: true, total: null, rate: "1904.76" }, nesto: "200000.00", base: undefined, areaNow: "105.00", areaAfter: "105.00" })).toEqual({ kind: "agree" });
  });
});

describe("new units", () => {
  const N = ["Unit", "Building", "Floor", "Type", "Internal area (m²)", "Bedrooms", "Total price"];

  it("a row NESTO does not have becomes a new unit on a building, floor and type that exist", () => {
    const diff = diffSheet(input(grid(N, [["T-504", "T", "Kati 5", "Apartament", 55.5, 1, 120000]])));
    expect(diff.newUnits).toHaveLength(1);
    expect(diff.newUnits[0]).toMatchObject({ id: "new:504", row: 2, unitCode: "504", label: "T-504", building: { id: "b_t" }, floor: { id: "f_t5" }, type: { id: "type_apt" }, values: { internalArea: "55.50", bedrooms: "1" }, price: { entry: "TOTAL", total: "120000.00" } });
  });

  it("refuses a new unit without a known building, floor or type, a retired type, a code taken, and repeats", () => {
    const rows: Array<Array<string | number | null>> = [
      ["X-1", null, "Floor 5", "Apartment"],
      ["X-2", "Castle", "Floor 5", "Apartment"],
      ["T-600", "Tower", "Floor 99", "Apartment"],
      ["T-601", "Tower", "Floor 5", "Spaceship"],
      ["T-602", "Tower", "Floor 5", "Duplex"],
      // Tower's "T-101" would be unit 101, which Block B's B-101 already is: codes are unique in a project.
      ["T-101", "Tower", "Floor 5", "Apartment"],
      ["T-700", "Tower", "Floor 5", "Apartment"],
      ["700", "Tower", "Floor 5", "Apartment"],
    ];
    const diff = diffSheet(input(grid(["Unit", "Building", "Floor", "Type"], rows)));
    expect(diff.newUnits).toEqual([]);
    expect(reasons(diff).map(([row, reason]) => [row, reason])).toEqual([
      [2, "missing_building"],
      [3, "unknown_building"],
      [4, "unknown_floor"],
      [5, "unknown_type"],
      [6, "retired_type"],
      [7, "code_taken"],
      [8, "duplicate_row"],
      [9, "duplicate_row"],
    ]);
  });

  it("are left out, with the reason, for a reader who may not add units", () => {
    const diff = diffSheet(input(grid(N, [["T-504", "T", "Floor 5", "Apartment", 55.5, 1, null]]), { can: { managePrice: true, createUnit: false } }));
    expect(diff.newUnits).toEqual([]);
    expect(reasons(diff)).toEqual([[2, "not_allowed_create", null]]);
  });

  it("keep their price out, with the reason, for a reader without the price grant", () => {
    const diff = diffSheet(input(grid(N, [["T-504", "T", "Floor 5", "Apartment", 55.5, 1, 99000]]), { can: { managePrice: false, createUnit: true } }));
    expect(diff.newUnits[0]!.price).toBeNull();
    expect(reasons(diff)).toEqual([[2, "price_not_allowed", "price"]]);
  });
});

describe("the baseline a confirmed sync leaves", () => {
  /** Plays a confirm: what was chosen is saved into NESTO, then the baseline is worked out as the service does. */
  function confirm(diff: SheetDiff, previous: Map<string, UnitBaseline>, choices: { accept: string[]; clashes?: Record<string, "SHEET" | "NESTO"> }) {
    const plans = planUnits(diff, { accept: new Set(choices.accept), clashes: new Map(Object.entries(choices.clashes ?? {})) });
    const after = new Map<string, UnitBaseline>(previous);
    const nowUnits = units().map((one) => {
      const plan = plans.find((candidate) => candidate.unit.id === one.id);
      if (!plan) return one;
      return { ...one, values: { ...one.values, ...plan.structure, ...(plan.price ? { price: plan.price.total } : {}) } };
    });
    for (const matched of diff.matched as MatchedUnit[]) {
      const plan = plans.find((candidate) => candidate.unit.id === matched.unit.id);
      const saved = new Set<SheetField>([...(Object.keys(plan?.structure ?? {}) as SheetField[]), ...(plan?.price ? (["price"] as const) : [])]);
      after.set(matched.unit.id, nextBaseline({ previous: previous.get(matched.unit.id), outcomes: matched.outcomes, sheet: matched.sheet, saved, keptNesto: new Set(plan?.keepNesto ?? []), current: nowUnits.find((one) => one.id === matched.unit.id)!.values }));
    }
    return { baselines: after, units: nowUnits };
  }

  it("a change left unticked is offered again; a change taken is not", () => {
    const sheet = grid(["Unit", "Internal area (m²)", "Bedrooms"], [["T-501", 70, 3]]);
    const first = diffSheet(input(sheet));
    const { baselines: after, units: now } = confirm(first, new Map(), { accept: [changeId("u501", "bedrooms")] });
    const second = diffSheet(input(sheet, { baselines: after, units: now }));
    expect(outcome(second, "u501", "internalArea")).toMatchObject({ kind: "change", to: "70.00" });
    expect(outcome(second, "u501", "bedrooms")).toEqual({ kind: "agree", field: "bedrooms" });
  });

  it("a clash kept as NESTO has it comes back as newer in NESTO, not as a clash", () => {
    const base = baselines({ u501: { bathrooms: { s: "2", n: "2" } } });
    const sheet = grid(["Unit", "Bathrooms"], [["T-501", 3]]);
    const first = diffSheet(input(sheet, { baselines: base }));
    expect(outcome(first, "u501", "bathrooms")).toMatchObject({ kind: "clash", sheet: "3", nesto: "1" });
    const { baselines: after, units: now } = confirm(first, base, { accept: [], clashes: { [changeId("u501", "bathrooms")]: "NESTO" } });
    expect(after.get("u501")?.bathrooms).toEqual({ s: "3", n: "2" });
    const second = diffSheet(input(sheet, { baselines: after, units: now }));
    expect(outcome(second, "u501", "bathrooms")).toMatchObject({ kind: "newer", sheet: "3", nesto: "1" });
    // The sheet catches up (Download, import): nothing left to do, and the two agree from then on.
    const caughtUp = diffSheet(input(grid(["Unit", "Bathrooms"], [["T-501", 1]]), { baselines: after, units: now }));
    expect(outcome(caughtUp, "u501", "bathrooms")).toEqual({ kind: "agree", field: "bathrooms" });
  });

  it("a clash picked as the sheet's is saved, and agreed from then on; an unpicked clash stays a clash", () => {
    const base = baselines({ u501: { bathrooms: { s: "2", n: "2" }, bedrooms: { s: "1", n: "1" } } });
    const sheet = grid(["Unit", "Bathrooms", "Bedrooms"], [["T-501", 3, 3]]);
    const first = diffSheet(input(sheet, { baselines: base }));
    const { baselines: after, units: now } = confirm(first, base, { accept: [], clashes: { [changeId("u501", "bathrooms")]: "SHEET" } });
    const second = diffSheet(input(sheet, { baselines: after, units: now }));
    expect(outcome(second, "u501", "bathrooms")).toEqual({ kind: "agree", field: "bathrooms" });
    expect(outcome(second, "u501", "bedrooms")).toMatchObject({ kind: "clash" });
  });

  it("a new unit's first baseline leaves out a price that was not saved", () => {
    const current = { ...units()[1]!.values, price: null };
    expect(newUnitBaseline({ bedrooms: { s: "1" }, price: { s: "99000.00" } }, current, new Set(["bedrooms"]))).toEqual({ bedrooms: { s: "1", n: "1" } });
    expect(newUnitBaseline({ price: { s: "99000.00" } }, { ...current, price: "99000.00" }, new Set(["price"]))).toEqual({ price: { s: "99000.00", n: "99000.00" } });
  });
});
