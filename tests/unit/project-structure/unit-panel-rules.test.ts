import { describe, expect, it } from "vitest";

import { rowFromInventory, rowFromUnit } from "@/components/project-structure/unit-list/unit-list-row";
import type { UnitDTO } from "@/lib/modules/project-structure/structure.types";
import { focusTarget, isPlainClick, neighbours, offersAdd, openUnitOf, stepFromKey, withOpenUnit, type PanelRowFacts } from "@/lib/modules/project-structure/unit-panel.rules";
import { putOnSaleWithPrice, saleStatusOffers } from "@/lib/modules/sales/units/unit-sales.rules";
import type { InventoryRowDTO } from "@/lib/modules/sales/units/unit-sales.types";

/**
 * The unit side panel's rules and the "Also put it on sale" tick, without a
 * browser (2026-11-09).
 */

describe("the open unit in the address", () => {
  it("adds and drops `unit` and keeps the list's own query", () => {
    expect(withOpenUnit("https://nesto.test/projects/p1/units?floor=f1&sort=-price", "u7")).toBe("/projects/p1/units?floor=f1&sort=-price&unit=u7");
    expect(withOpenUnit("https://nesto.test/projects/p1/units?floor=f1&unit=u7", "u8")).toBe("/projects/p1/units?floor=f1&unit=u8");
    expect(withOpenUnit("https://nesto.test/projects/p1/sales?unit=u7&commercialStatus=FOR_SALE", null)).toBe("/projects/p1/sales?commercialStatus=FOR_SALE");
    expect(openUnitOf("?floor=f1&unit=u7")).toBe("u7");
    expect(openUnitOf("?floor=f1&unit=")).toBeNull();
    expect(openUnitOf("")).toBeNull();
  });
});

describe("previous and next", () => {
  const ids = ["a", "b", "c"];
  it("step through the list as it is shown", () => {
    expect(neighbours(ids, "a")).toEqual({ index: 0, total: 3, previous: null, next: "b" });
    expect(neighbours(ids, "b")).toEqual({ index: 1, total: 3, previous: "a", next: "c" });
    expect(neighbours(ids, "c")).toEqual({ index: 2, total: 3, previous: "b", next: null });
  });

  it("have nowhere to go for a unit not on the page", () => {
    expect(neighbours(ids, "z")).toEqual({ index: -1, total: 3, previous: null, next: null });
    expect(neighbours([], null)).toEqual({ index: -1, total: 0, previous: null, next: null });
  });

  it("answer Alt+↑ and Alt+↓, except in a select or a text box", () => {
    const key = (key: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({ key, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
    expect(stepFromKey(key("ArrowUp"), { tagName: "BUTTON" })).toBe(-1);
    expect(stepFromKey(key("ArrowDown"), { tagName: "input" })).toBe(1);
    expect(stepFromKey(key("ArrowDown"), null)).toBe(1);
    expect(stepFromKey(key("ArrowDown", { altKey: false }), { tagName: "DIV" })).toBeNull();
    expect(stepFromKey(key("ArrowDown", { shiftKey: true }), { tagName: "DIV" })).toBeNull();
    expect(stepFromKey(key("ArrowDown"), { tagName: "SELECT" })).toBeNull();
    expect(stepFromKey(key("ArrowUp"), { tagName: "TEXTAREA" })).toBeNull();
    expect(stepFromKey(key("ArrowLeft"), { tagName: "DIV" })).toBeNull();
  });
});

describe("what opens the panel", () => {
  const click = (extra: Partial<{ button: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; defaultPrevented: boolean }> = {}) => ({ button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
  it("is a plain left click; a modified or middle click opens the full page", () => {
    expect(isPlainClick(click())).toBe(true);
    expect(isPlainClick(click({ metaKey: true }))).toBe(false);
    expect(isPlainClick(click({ ctrlKey: true }))).toBe(false);
    expect(isPlainClick(click({ shiftKey: true }))).toBe(false);
    expect(isPlainClick(click({ button: 1 }))).toBe(false);
    expect(isPlainClick(click({ defaultPrevented: true }))).toBe(false);
  });
});

describe("an empty cell's Add", () => {
  const apartment: PanelRowFacts = { category: "RESIDENTIAL", bedrooms: null, grossArea: null, saleArea: null, askingPrice: null, status: "NOT_FOR_SALE", archived: false };
  const all = { details: true, price: true };

  it("is offered for the gaps the missing line counts, to somebody who may fill them", () => {
    expect(["bedrooms", "gross", "area", "price"].map((field) => offersAdd(apartment, field as never, all))).toEqual([true, true, true, true]);
    expect(offersAdd(apartment, "bedrooms", { details: false, price: true })).toBe(false);
    expect(offersAdd(apartment, "gross", { details: false, price: true })).toBe(false);
    expect(offersAdd(apartment, "price", { details: true, price: false })).toBe(false);
  });

  it("is not offered once the cell has a value", () => {
    const filled = { ...apartment, bedrooms: 2, grossArea: "80.66", saleArea: "80.66", askingPrice: "161320.00" };
    expect(["bedrooms", "gross", "area", "price"].map((field) => offersAdd(filled, field as never, all))).toEqual([false, false, false, false]);
    // Zero bedrooms is a value, not a gap.
    expect(offersAdd({ ...apartment, bedrooms: 0 }, "bedrooms", all)).toBe(false);
  });

  it("follows the type: no bedrooms for parking or storage, no area for parking", () => {
    const parking = { ...apartment, category: "PARKING" as const };
    expect([offersAdd(parking, "bedrooms", all), offersAdd(parking, "gross", all), offersAdd(parking, "area", all), offersAdd(parking, "price", all)]).toEqual([false, false, false, true]);
    expect(offersAdd({ ...apartment, category: "STORAGE" }, "bedrooms", all)).toBe(false);
    expect(offersAdd({ ...apartment, category: "STORAGE" }, "gross", all)).toBe(true);
  });

  it("is never offered on an archived unit, nor a price on a sold one", () => {
    expect(["bedrooms", "gross", "area", "price"].some((field) => offersAdd({ ...apartment, archived: true }, field as never, all))).toBe(false);
    expect(offersAdd({ ...apartment, status: "SOLD" }, "price", all)).toBe(false);
    expect(offersAdd({ ...apartment, status: "RESERVED" }, "price", all)).toBe(true);
  });

  it("puts the cursor in the field it names", () => {
    expect([focusTarget("bedrooms"), focusTarget("gross"), focusTarget("area"), focusTarget("price")]).toEqual(["bedrooms", "internalArea", "saleableArea", "price"]);
  });

  it("reads the same facts from a Units row and a Sales row", () => {
    const unit = {
      id: "u1",
      projectId: "p1",
      unitCode: "501",
      label: "T-501",
      unitType: { id: "t1", name: "Apartment", code: "APARTMENT", category: "RESIDENTIAL", isActive: true },
      building: { id: "b1", name: "Tower", code: "T" },
      floor: { id: "f1", name: "Floor 5", number: 5, levelType: "STANDARD" },
      orientation: null,
      areas: { internalArea: null, balconyArea: null, terraceArea: null, netArea: null, commonAreaAllocation: null, grossArea: null, saleableArea: null, outdoorArea: null, gardenArea: null },
      bedrooms: null,
      bathrooms: null,
      storage: null,
      attributes: {},
      description: null,
      sortOrder: 1,
      isActive: true,
      version: 3,
      createdAt: "",
      updatedAt: "",
      publication: { status: "PUBLISHED", versionNumber: 1 },
      commercialStatus: "NOT_FOR_SALE",
      askingPrice: null,
      salesVersion: 0,
    } satisfies UnitDTO;
    const inventory = {
      id: "u1",
      version: 3,
      salesVersion: 0,
      floorId: "f1",
      isActive: true,
      grossArea: null,
      unitCode: "501",
      label: "T-501",
      unitType: "Apartment",
      unitTypeCategory: "RESIDENTIAL",
      building: "Tower",
      floor: "Floor 5",
      saleArea: null,
      saleAreaBasis: "FIXED_UNIT_PRICE",
      bedrooms: null,
      bathrooms: null,
      orientation: null,
      status: "NOT_FOR_SALE",
      saleStatus: "NOT_PRICED",
      publicationStatus: "PUBLISHED",
      askingPrice: null,
      currency: null,
      pricePerSqm: null,
      client: null,
      deal: null,
      reservationExpiresAt: null,
    } satisfies InventoryRowDTO;
    const fromUnits = rowFromUnit(unit);
    const fromSales = rowFromInventory(inventory);
    expect(fromUnits.category).toBe("RESIDENTIAL");
    expect(fromSales.category).toBe("RESIDENTIAL");
    for (const field of ["bedrooms", "gross", "area", "price"] as const) expect(offersAdd(fromUnits, field, all)).toBe(offersAdd(fromSales, field, all));
  });
});

describe("Also put it on sale", () => {
  it("is offered on a unit not for sale — or with no sales record — that can be offered, to somebody who may change the status", () => {
    expect(putOnSaleWithPrice({ canManageStatus: true, status: "NOT_FOR_SALE", sellable: true })).toBe(true);
    expect(putOnSaleWithPrice({ canManageStatus: true, status: null, sellable: true })).toBe(true);
    expect(putOnSaleWithPrice({ canManageStatus: true, status: undefined, sellable: true })).toBe(true);
  });

  it("is not offered without the grant, on an unpublished or inactive unit, or once the unit is offered", () => {
    expect(putOnSaleWithPrice({ canManageStatus: false, status: "NOT_FOR_SALE", sellable: true })).toBe(false);
    expect(putOnSaleWithPrice({ canManageStatus: true, status: "NOT_FOR_SALE", sellable: false })).toBe(false);
    for (const status of ["FOR_SALE", "ON_HOLD", "RESERVED", "SOLD"] as const) expect(putOnSaleWithPrice({ canManageStatus: true, status, sellable: true })).toBe(false);
  });
});

describe("the sale-status changes offered", () => {
  const every = { canManageStatus: true, canManagePrice: true, canReserve: true, canExtend: true, canRelease: true, canMarkSold: true, canReopen: true, canCorrect: true };
  const none = Object.fromEntries(Object.keys(every).map((key) => [key, false])) as typeof every;
  const offered = (status: Parameters<typeof saleStatusOffers>[0]["status"], options: { sellable?: boolean; reservation?: boolean; caps?: typeof every } = {}) =>
    Object.entries(saleStatusOffers({ status, sellable: options.sellable ?? true, hasReservation: options.reservation ?? false, capabilities: options.caps ?? every }))
      .filter(([, on]) => on)
      .map(([key]) => key);

  it("follow the commercial machine", () => {
    expect(offered("NOT_FOR_SALE")).toEqual(["putOnSale", "price"]);
    expect(offered("FOR_SALE")).toEqual(["takeOff", "hold", "reserve", "price"]);
    expect(offered("ON_HOLD")).toEqual(["releaseHold", "reserve", "price"]);
    expect(offered("RESERVED", { reservation: true })).toEqual(["extend", "release", "sold", "correct", "price"]);
    expect(offered("SOLD")).toEqual(["reopen"]);
  });

  it("need a sellable unit to put it on sale or reserve it, and each its own grant", () => {
    expect(offered("NOT_FOR_SALE", { sellable: false })).toEqual(["price"]);
    expect(offered("FOR_SALE", { sellable: false })).toEqual(["takeOff", "hold", "price"]);
    expect(offered("FOR_SALE", { caps: none })).toEqual([]);
    expect(offered("FOR_SALE", { caps: { ...none, canReserve: true } })).toEqual(["reserve"]);
  });
});
