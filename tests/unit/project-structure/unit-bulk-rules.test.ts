import { describe, expect, it } from "vitest";

import { activeCount, EMPTY_FILTERS, filterParams, filtersFromQuery, panelCount, SORTS } from "@/components/project-structure/unit-filters";
import { UNIT_SORTS } from "@/lib/modules/project-structure/structure.types";
import {
  afterChange,
  goesOnSaleWithPrice,
  pageState,
  refreshUnits,
  saleStatusCount,
  saleStatusSkip,
  setUnits,
  toggleUnit,
  unitRefs,
  type SelectedUnit,
  type Selection,
} from "@/lib/modules/project-structure/unit-bulk.rules";
import { bulkAskingPrice } from "@/lib/modules/sales/units/unit-pricing.rules";

/**
 * Ticking units and changing them together (2026-11-09): the selection's own
 * rules, what a sale-status change and a price do to each ticked unit, and the
 * one filter set both unit lists share.
 */

const unit = (id: string, patch: Partial<SelectedUnit> = {}): SelectedUnit => ({ id, label: `T-${id}`, floorId: "f1", version: 1, salesVersion: 0, status: "NOT_FOR_SALE", priced: false, archived: false, ...patch });
const empty: Selection = new Map();

describe("the selection", () => {
  it("ticks and unticks a unit, and many at once, keeping the rest", () => {
    const one = toggleUnit(empty, unit("501"));
    expect([...one.keys()]).toEqual(["501"]);
    expect(toggleUnit(one, unit("501")).size).toBe(0);
    const page = setUnits(one, [unit("502"), unit("503")], true);
    expect([...page.keys()]).toEqual(["501", "502", "503"]);
    expect([...setUnits(page, [unit("501"), unit("503")], false).keys()]).toEqual(["502"]);
  });

  it("says whether the page is ticked: all, some or none", () => {
    const ticked = setUnits(empty, [unit("501"), unit("502")], true);
    expect(pageState(ticked, ["501", "502"])).toBe("all");
    expect(pageState(ticked, ["501", "502", "503"])).toBe("some");
    expect(pageState(ticked, ["504"])).toBe("none");
    expect(pageState(empty, [])).toBe("none");
  });

  it("carries the versions a list or a change brings back, and leaves an unchanged selection as it was", () => {
    const ticked = setUnits(empty, [unit("501"), unit("502")], true);
    const fresh = refreshUnits(ticked, [{ id: "501", version: 3, salesVersion: 2, status: "FOR_SALE" }, { id: "999", version: 9 }]);
    expect(fresh.get("501")).toMatchObject({ version: 3, salesVersion: 2, status: "FOR_SALE", label: "T-501" });
    expect(fresh.has("999")).toBe(false);
    expect(refreshUnits(ticked, [unit("502")])).toBe(ticked);
    const after = afterChange(ticked, { updated: [{ id: "502", label: "T-502", version: 2, salesVersion: 0, status: "NOT_FOR_SALE", priced: false }], skipped: [] });
    expect(after.get("502")?.version).toBe(2);
    expect(after.get("501")?.version).toBe(1);
  });

  it("sends the unit's own version for its own changes and its sales record's for Sales'", () => {
    const units = [unit("501", { version: 4, salesVersion: 7 })];
    expect(unitRefs(units, "details")).toEqual([{ id: "501", version: 4 }]);
    expect(unitRefs(units, "move")).toEqual([{ id: "501", version: 4 }]);
    expect(unitRefs(units, "archive")).toEqual([{ id: "501", version: 4 }]);
    expect(unitRefs(units, "price")).toEqual([{ id: "501", version: 7 }]);
    expect(unitRefs(units, "status")).toEqual([{ id: "501", version: 7 }]);
  });
});

describe("a sale-status change on ticked units", () => {
  it("puts only a unit not for sale on sale, and takes only one for sale off it", () => {
    expect(saleStatusSkip("put_on_sale", "NOT_FOR_SALE")).toBeNull();
    expect(saleStatusSkip("put_on_sale", "FOR_SALE")).toBe("already");
    expect(saleStatusSkip("put_on_sale", "ON_HOLD")).toBe("on_hold");
    expect(saleStatusSkip("put_on_sale", "RESERVED")).toBe("reserved");
    expect(saleStatusSkip("put_on_sale", "SOLD")).toBe("sold");
    expect(saleStatusSkip("take_off_sale", "FOR_SALE")).toBeNull();
    expect(saleStatusSkip("take_off_sale", "NOT_FOR_SALE")).toBe("already");
    expect(saleStatusSkip("take_off_sale", "ON_HOLD")).toBe("on_hold");
  });

  it("counts the units a change would move; an archived unit does not go on sale", () => {
    const units = [unit("1"), unit("2", { archived: true }), unit("3", { status: "FOR_SALE" }), unit("4", { status: "SOLD" })];
    expect(saleStatusCount("put_on_sale", units)).toBe(1);
    expect(saleStatusCount("take_off_sale", units)).toBe(1);
  });

  it("offers 'Also put it on sale' only for a unit in use that is not for sale", () => {
    expect(goesOnSaleWithPrice(unit("1"))).toBe(true);
    expect(goesOnSaleWithPrice(unit("2", { archived: true }))).toBe(false);
    expect(goesOnSaleWithPrice(unit("3", { status: "ON_HOLD" }))).toBe(false);
  });
});

describe("one price for many units", () => {
  it("gives every unit the same total, on its own sale area's basis", () => {
    expect(bulkAskingPrice("TOTAL", "250000", { saleableArea: "100.00", grossArea: "120.00" })).toEqual({ askingPrice: "250000", priceBasis: "SALEABLE_AREA" });
    expect(bulkAskingPrice("TOTAL", "250000", { saleableArea: null, grossArea: "80.66" })).toEqual({ askingPrice: "250000", priceBasis: "GROSS_AREA" });
    expect(bulkAskingPrice("TOTAL", "15000", { saleableArea: null, grossArea: null })).toEqual({ askingPrice: "15000", priceBasis: "FIXED_UNIT_PRICE" });
  });

  it("works a rate out on each unit's sale area — saleable, else gross — and has none without an area", () => {
    expect(bulkAskingPrice("PER_SQM", "2000", { saleableArea: "113.00", grossArea: "120.00" })).toEqual({ askingPrice: "226000.00", priceBasis: "SALEABLE_AREA" });
    expect(bulkAskingPrice("PER_SQM", "2000", { saleableArea: "0.00", grossArea: "80.66" })).toEqual({ askingPrice: "161320.00", priceBasis: "GROSS_AREA" });
    expect(bulkAskingPrice("PER_SQM", "1200", { saleableArea: "85.37", grossArea: null })).toEqual({ askingPrice: "102444.00", priceBasis: "SALEABLE_AREA" });
    expect(bulkAskingPrice("PER_SQM", "2000", { saleableArea: null, grossArea: null })).toBeNull();
  });
});

describe("the one filter set of both unit lists", () => {
  it("offers the same sort list, Sales adding the reservation expiry", () => {
    expect(SORTS.units).toEqual(UNIT_SORTS);
    expect(SORTS.sales).toEqual([...UNIT_SORTS, "expiry"]);
    for (const key of ["structure", "code", "floor", "type", "area", "gross", "bedrooms", "price", "pricePerSqm"]) expect(SORTS.units).toContain(key);
  });

  it("sends only what a tab uses, by the API's names", () => {
    const filters = { ...EMPTY_FILTERS, q: " T-501 ", buildingId: "b1", floorId: "f1", unitTypeId: "t1", areaMin: "50", priceMax: "300000", pricePerSqmMin: "1500", publication: "ARCHIVED", commercialStatus: "FOR_SALE", sort: "-price" as const };
    expect(Object.fromEntries(filterParams(filters, "units"))).toEqual({ q: "T-501", unitTypeId: "t1", areaMin: "50", priceMax: "300000", pricePerSqmMin: "1500", publicationStatus: "ARCHIVED", sort: "-price" });
    expect(Object.fromEntries(filterParams(filters, "sales"))).toEqual({ q: "T-501", commercialStatus: "FOR_SALE", buildingId: "b1", floorId: "f1", unitTypeId: "t1", areaMin: "50", priceMax: "300000", pricePerSqmMin: "1500", sort: "-price" });
    expect(filterParams(EMPTY_FILTERS, "sales").toString()).toBe("");
  });

  it("counts the panel's fields set, and everything that narrows the list", () => {
    const filters = { ...EMPTY_FILTERS, q: "501", areaMin: "50", areaMax: "90", publication: "ARCHIVED", commercialStatus: "SOLD" };
    expect(panelCount(filters, "units")).toBe(2);
    expect(panelCount(filters, "sales")).toBe(1);
    expect(activeCount(filters, "units")).toBe(3);
    expect(activeCount(filters, "sales")).toBe(3);
  });

  it("reads the first state from a parsed URL on either tab", () => {
    expect(filtersFromQuery({ q: "501", bedrooms: 2, publicationStatus: "ARCHIVED", sort: "expiry" })).toEqual({ ...EMPTY_FILTERS, q: "501", bedrooms: "2", publication: "ARCHIVED", sort: "expiry" });
  });
});
