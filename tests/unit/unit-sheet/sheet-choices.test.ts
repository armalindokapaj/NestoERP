import { describe, expect, it } from "vitest";

import { allChangeIds, applyBody, chosenCount, exportQuery, filenameFromDisposition, hasDecisions, initialChoices, pickClash, putOnSaleCandidates, setTicked, tickState, unpickedCount } from "@/components/project-structure/unit-sheet/sheet-choices";
import type { SheetLinkDTO, SheetPreviewDTO } from "@/lib/modules/unit-sheet/unit-sheet.types";

/**
 * What a person chooses in a Sync now preview, and the confirm it sends
 * (2026-11-10): every change and new unit starts ticked, a clash starts
 * unpicked and waits when left so, only the units with something chosen are
 * sent with the versions the preview saw. And the query Export sends: the
 * tab's own address, narrowed to what the list shows.
 */

const LINK: SheetLinkDTO = {
  spreadsheetId: "1abc",
  gid: "0",
  url: "https://docs.google.com/spreadsheets/d/1abc/edit#gid=0",
  title: "Riverside units",
  linkedAt: "2026-11-10T09:00:00.000Z",
  linkedBy: { memberId: "m1", name: "Ana Hoxha" },
  lastSyncedAt: null,
  lastSyncedBy: null,
  version: 4,
};

const price = (total: string | null) => ({ entry: "TOTAL" as const, total, rate: null, area: null });

function preview(overrides: Partial<SheetPreviewDTO> = {}): SheetPreviewDTO {
  return {
    link: LINK,
    linkVersion: 4,
    sheetHash: "h".repeat(64),
    readAt: "2026-11-10T10:00:00.000Z",
    sheet: { title: "Riverside units", rows: 4, columns: [], unknownColumns: [], hasCodeColumn: true, typed: true },
    firstSync: false,
    counts: { changes: 3, changedUnits: 2, clashes: 2, newUnits: 1, newerInNesto: 0, skipped: 0, notInSheet: 0, unchangedUnits: 0 },
    changes: [
      {
        unitId: "u501",
        label: "T-501",
        row: 2,
        currency: "EUR",
        version: 3,
        salesVersion: 1,
        status: "FOR_SALE",
        fields: [
          { id: "u501:internalArea", field: "internalArea", from: "64.72", to: "70.00", price: null },
          { id: "u501:bedrooms", field: "bedrooms", from: "2", to: "3", price: null },
        ],
      },
      { unitId: "u502", label: "T-502", row: 3, currency: "EUR", version: 5, salesVersion: 0, status: "NOT_FOR_SALE", fields: [{ id: "u502:price", field: "price", from: null, to: "90000.00", price: price("90000.00") }] },
    ],
    clashes: [
      {
        unitId: "u503",
        label: "T-503",
        row: 4,
        currency: "EUR",
        version: 7,
        salesVersion: 2,
        status: "NOT_FOR_SALE",
        fields: [
          { id: "u503:bathrooms", field: "bathrooms", sheet: "2", nesto: "1", price: null },
          { id: "u503:price", field: "price", sheet: "120000.00", nesto: "110000.00", price: price("120000.00") },
        ],
      },
    ],
    newUnits: [
      {
        id: "new:504",
        row: 5,
        code: "504",
        label: "T-504",
        building: { id: "b_t", name: "Tower" },
        floor: { id: "f_t5", name: "Floor 5" },
        type: { id: "type_apt", name: "Apartment" },
        fields: [{ field: "internalArea", value: "45.50" }],
        price: price("68250.00"),
      },
    ],
    newerInNesto: [],
    skipped: [],
    notInSheet: [],
    unknownColumns: [],
    unitTypes: [{ id: "type_apt", name: "Apartment", code: "APARTMENT" }],
    putOnSale: { allowed: true, candidates: 2 },
    capabilities: { canLink: true, canSync: true, canDownload: true, canManagePrice: true, canCreateUnit: true, canPutOnSale: true },
    ...overrides,
  };
}

describe("a preview's choices", () => {
  it("start with every change and new unit ticked, every clash unpicked, and Also put on sale ticked", () => {
    const choices = initialChoices(preview());
    expect([...choices.accept].sort()).toEqual(["new:504", "u501:bedrooms", "u501:internalArea", "u502:price"]);
    expect(choices.clashes.size).toBe(0);
    expect(choices.putOnSale).toBe(true);
    expect(chosenCount(preview(), choices)).toBe(4);
    expect(unpickedCount(preview(), choices)).toBe(2);
    expect(allChangeIds(preview())).toEqual(["u501:internalArea", "u501:bedrooms", "u502:price"]);
  });

  it("tick a unit's fields one by one: some ticked reads as part-ticked, none as unticked", () => {
    const ids = ["u501:internalArea", "u501:bedrooms"];
    let choices = initialChoices(preview());
    expect(tickState(choices, ids)).toBe(true);
    choices = setTicked(choices, ["u501:bedrooms"], false);
    expect(tickState(choices, ids)).toBe("indeterminate");
    choices = setTicked(choices, ids, false);
    expect(tickState(choices, ids)).toBe(false);
    expect(chosenCount(preview(), choices)).toBe(2);
  });

  it("count a clash picked for the sheet as a change and one kept as NESTO has it as none; a pick can be taken back", () => {
    let choices = pickClash(initialChoices(preview()), "u503:bathrooms", "SHEET");
    choices = pickClash(choices, "u503:price", "NESTO");
    expect(chosenCount(preview(), choices)).toBe(5);
    expect(unpickedCount(preview(), choices)).toBe(0);
    choices = pickClash(choices, "u503:price", null);
    expect(unpickedCount(preview(), choices)).toBe(1);
  });

  it("send only the units with something chosen, with the versions the preview saw; an unpicked clash is not sent", () => {
    let choices = setTicked(initialChoices(preview()), ["u502:price", "new:504"], false);
    let body = applyBody(preview(), choices);
    expect(body).toEqual({ sheetHash: "h".repeat(64), linkVersion: 4, units: [{ id: "u501", version: 3, salesVersion: 1 }], accept: ["u501:internalArea", "u501:bedrooms"], clashes: {}, putOnSale: true });

    choices = pickClash(choices, "u503:price", "NESTO");
    choices = { ...choices, putOnSale: false };
    body = applyBody(preview(), choices);
    expect(body.units).toEqual([
      { id: "u501", version: 3, salesVersion: 1 },
      { id: "u503", version: 7, salesVersion: 2 },
    ]);
    expect(body.clashes).toEqual({ "u503:price": "NESTO" });
    expect(body.putOnSale).toBe(false);
  });

  it("say which units not for sale would get a price: ticked prices, prices picked from the sheet and priced new units", () => {
    let choices = initialChoices(preview());
    // T-502 (not for sale, ticked price) and the new T-504 with a price.
    expect(putOnSaleCandidates(preview(), choices)).toBe(2);
    choices = pickClash(choices, "u503:price", "SHEET");
    expect(putOnSaleCandidates(preview(), choices)).toBe(3);
    choices = pickClash(choices, "u503:price", "NESTO");
    choices = setTicked(choices, ["u502:price"], false);
    expect(putOnSaleCandidates(preview(), choices)).toBe(1);
    // A price cleared from the sheet puts nothing on sale.
    const cleared = preview({ changes: [{ ...preview().changes[1]!, fields: [{ id: "u502:price", field: "price", from: "90000.00", to: null, price: price(null) }] }], newUnits: [] });
    expect(putOnSaleCandidates(cleared, initialChoices(cleared))).toBe(0);
  });

  it("know when there is nothing to decide", () => {
    expect(hasDecisions(preview())).toBe(true);
    expect(hasDecisions(preview({ changes: [], clashes: [], newUnits: [] }))).toBe(false);
  });
});

describe("Export's query", () => {
  it("on Units: the tab's search and filters, its building or floor as the list reads them, without the page, the open unit or a one-off tick", () => {
    const query = new URLSearchParams(exportQuery("?q=501&bedrooms=2&building=b_t&floor=f_t5&page=3&unit=u501&tick=no-area&sort=price_desc", "units"));
    expect(Object.fromEntries(query)).toEqual({ q: "501", bedrooms: "2", floorId: "f_t5", sort: "price_desc", view: "units" });
    expect(Object.fromEntries(new URLSearchParams(exportQuery("?building=b_t", "units")))).toEqual({ buildingId: "b_t", view: "units" });
    expect(exportQuery("", "units")).toBe("view=units");
  });

  it("on Sales: the status chip and the panel's building and floor as they are; a forged view is replaced", () => {
    const query = new URLSearchParams(exportQuery("?commercialStatus=NOT_PRICED&buildingId=b_t&priceMin=1000&page=2&view=units&select=all", "sales"));
    expect(Object.fromEntries(query)).toEqual({ commercialStatus: "NOT_PRICED", buildingId: "b_t", priceMin: "1000", view: "sales" });
  });
});

describe("the name a download answered with", () => {
  it("takes the UTF-8 name first, then the plain one, and nothing from a missing or broken header", () => {
    expect(filenameFromDisposition(`attachment; filename="Riverside Residences - units - 2026-11-10.xlsx"; filename*=UTF-8''Riverside%20Residences%20%E2%80%93%20units%20%E2%80%93%202026-11-10.xlsx`)).toBe("Riverside Residences – units – 2026-11-10.xlsx");
    expect(filenameFromDisposition(`attachment; filename="A-PRJ-001-units-2026-11-10.xlsx"`)).toBe("A-PRJ-001-units-2026-11-10.xlsx");
    expect(filenameFromDisposition(`attachment; filename="plain.xlsx"; filename*=UTF-8''%E2%80`)).toBe("plain.xlsx");
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition("attachment")).toBeNull();
  });
});
