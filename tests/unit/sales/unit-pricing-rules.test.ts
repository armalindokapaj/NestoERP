import { describe, expect, it } from "vitest";

import { convertPriceEntry, hasSaleArea, prevailingPrice, prevailingRate, priceFromRate, priceToSave, rateFromPrice, saleArea, saleRate, switchPriceEntry, untouchedTotal, type PriceEntry, type PriceEntrySwitch } from "@/lib/modules/sales/units/unit-pricing.rules";
import { pricePerSqm, saleStatusOf } from "@/lib/modules/sales/units/unit-sales.rules";
import { priceListSaveSchema } from "@/lib/modules/sales/units/unit-pricing.schema";
import { MAX_PRICE_LIST_CHANGES } from "@/lib/modules/sales/units/unit-pricing.types";

/** The price list's arithmetic (2026-11): exact to the cent, never a float. */

const unit = (overrides: Partial<{ saleableArea: string | null; grossArea: string | null; internalArea: string | null; askingPrice: string | null; priceBasis: "SALEABLE_AREA" | "GROSS_AREA" | "INTERNAL_AREA" | "FIXED_UNIT_PRICE" }> = {}) => ({
  saleableArea: "100.00",
  grossArea: null,
  internalArea: null,
  askingPrice: null,
  priceBasis: "SALEABLE_AREA" as const,
  ...overrides,
});

describe("priceFromRate", () => {
  it("multiplies the rate by the area exactly, rounding half up to the cent", () => {
    expect(priceFromRate("1200", "85.37")).toBe("102444.00");
    expect(priceFromRate("1234.56", "85.37")).toBe("105394.39"); // 105,394.3872
    expect(priceFromRate("0.05", "0.10")).toBe("0.01"); // 0.005 rounds up
    expect(priceFromRate("1500.5", "72.4")).toBe("108636.20");
    // 15 whole digits: past a float's precision, still exact.
    expect(priceFromRate("999999999999.99", "1000.00")).toBe("999999999999990.00");
  });

  it("has no price without an area, or with a zero one", () => {
    expect(priceFromRate("1200", null)).toBeNull();
    expect(priceFromRate("1200", "0.00")).toBeNull();
  });

  it("gives back the rate as the unit's price per m²", () => {
    const price = priceFromRate("1234.56", "85.37")!;
    expect(saleRate(unit({ saleableArea: "85.37" }), price)).toBe("1234.56");
    expect(saleRate(unit({ saleableArea: null }), "250000.00")).toBeNull();
  });
});

describe("what a floor and the parking are priced at", () => {
  it("takes the rate most of a floor's units priced by area share, each on its own sale area, and none on a tie", () => {
    const floor = [
      unit({ saleableArea: "80.00", askingPrice: "96000.00" }), // 1200
      unit({ saleableArea: null, grossArea: "100.00", askingPrice: "120000.00", priceBasis: "GROSS_AREA" }), // 1200 on gross
      unit({ saleableArea: "100.00", askingPrice: "135000.00" }), // 1350, priced by hand
      unit({ saleableArea: "100.00", askingPrice: "140000.00", priceBasis: "FIXED_UNIT_PRICE" }), // by the unit, not a rate
      unit({ saleableArea: "100.00" }),
    ];
    expect(prevailingRate(floor)).toBe("1200.00");
    expect(prevailingRate([unit({ askingPrice: "120000.00" }), unit({ askingPrice: "130000.00" })])).toBeNull();
    expect(prevailingRate([unit({ askingPrice: "140000.00", priceBasis: "FIXED_UNIT_PRICE" })])).toBeNull();
  });

  it("takes the parking price most spaces ask", () => {
    expect(prevailingPrice([{ askingPrice: "15000.00" }, { askingPrice: "15000.00" }, { askingPrice: "18000.00" }, { askingPrice: null }])).toBe("15000.00");
    expect(prevailingPrice([{ askingPrice: null }])).toBeNull();
    expect(prevailingPrice([{ askingPrice: "15000.00" }, { askingPrice: "18000.00" }])).toBeNull();
  });
});

describe("the area a unit is sold by (2026-11-09)", () => {
  it("is the saleable area when it is typed and above zero, else the gross area", () => {
    expect(saleArea({ saleableArea: "95.00", grossArea: "105.00" })).toEqual({ area: "95.00", basis: "SALEABLE_AREA" });
    expect(saleArea({ saleableArea: null, grossArea: "80.66" })).toEqual({ area: "80.66", basis: "GROSS_AREA" });
    expect(saleArea({ saleableArea: "0.00", grossArea: "80.66" })).toEqual({ area: "80.66", basis: "GROSS_AREA" });
    expect(saleArea({ saleableArea: "95.00", grossArea: null })).toEqual({ area: "95.00", basis: "SALEABLE_AREA" });
  });

  it("is none — a fixed price — without either", () => {
    expect(saleArea({ saleableArea: null, grossArea: null })).toEqual({ area: null, basis: "FIXED_UNIT_PRICE" });
    expect(saleArea({ saleableArea: "0.00", grossArea: "0.00" })).toEqual({ area: null, basis: "FIXED_UNIT_PRICE" });
    expect(hasSaleArea({ saleableArea: null, grossArea: null })).toBe(false);
    expect(hasSaleArea({ saleableArea: null, grossArea: "0.01" })).toBe(true);
  });

  it("gives the price per m² on that area, whatever basis the price was saved on", () => {
    // Priced on gross before a saleable area was typed: the rate now reads on the saleable area.
    expect(saleRate({ saleableArea: "95.00", grossArea: "105.00" }, "200000.00")).toBe("2105.26");
    expect(saleRate({ saleableArea: null, grossArea: "80.66" }, "161320.00")).toBe("2000.00");
    expect(saleRate({ saleableArea: null, grossArea: null }, "15000.00")).toBeNull();
    expect(saleRate({ saleableArea: "95.00", grossArea: null }, null)).toBeNull();
  });
});

describe("how a unit's sale reads on screen", () => {
  it("is Not Priced while it has no price and is not for sale, or has no sales record yet", () => {
    expect(saleStatusOf(null, null)).toBe("NOT_PRICED");
    expect(saleStatusOf(undefined, undefined)).toBe("NOT_PRICED");
    expect(saleStatusOf("NOT_FOR_SALE", null)).toBe("NOT_PRICED");
  });

  it("keeps Not For Sale for a priced unit held back, and every other status as it is", () => {
    expect(saleStatusOf("NOT_FOR_SALE", "120000.00")).toBe("NOT_FOR_SALE");
    expect(saleStatusOf("FOR_SALE", null)).toBe("FOR_SALE");
    expect(saleStatusOf("ON_HOLD", "1.00")).toBe("ON_HOLD");
    expect(saleStatusOf("RESERVED", null)).toBe("RESERVED");
    expect(saleStatusOf("SOLD", "1.00")).toBe("SOLD");
  });
});

describe("a unit's price typed as a total or per m² of its sale area", () => {
  it("works a total out at a rate, rounding half up to the cent as the price per m² does", () => {
    expect(rateFromPrice("226000.00", "113.00")).toBe("2000.00");
    expect(rateFromPrice("185000", "113.00")).toBe("1637.17"); // 1,637.168…
    expect(rateFromPrice("0.01", "2.00")).toBe("0.01"); // 0.005 rounds up
    expect(rateFromPrice("0.01", "3.00")).toBe("0.00"); // 0.0033 rounds down
    // 15 whole digits: past a float's precision, still exact.
    expect(rateFromPrice("999999999999990.00", "1000.00")).toBe("999999999999.99");
    for (const [price, area] of [["210000.00", "105.00"], ["185000.00", "113.00"], ["102444.00", "85.37"], ["99999.99", "72.40"], ["1.00", "3.00"]] as const) {
      expect(rateFromPrice(price, area)).toBe(pricePerSqm(price, "GROSS_AREA", { grossArea: area }));
    }
  });

  it("has no rate without an area, or with a zero one", () => {
    expect(rateFromPrice("210000", null)).toBeNull();
    expect(rateFromPrice("210000", "0.00")).toBeNull();
  });

  it("turns the value in the box into the other kind when the entry switches", () => {
    expect(convertPriceEntry("226000.00", "113.00", "PER_SQM")).toBe("2000.00");
    expect(convertPriceEntry("2000", "113.00", "TOTAL")).toBe("226000.00");
    expect(convertPriceEntry("1234.56", "85.37", "TOTAL")).toBe("105394.39");
    // Grouped with spaces or with a decimal comma, as the shared decimal rule reads it.
    expect(convertPriceEntry("226 000", "113.00", "PER_SQM")).toBe("2000.00");
    expect(convertPriceEntry("1800,5", "100.00", "TOTAL")).toBe("180050.00");
    // An exact rate goes there and back unchanged.
    expect(convertPriceEntry(convertPriceEntry("226000.00", "113.00", "PER_SQM"), "113.00", "TOTAL")).toBe("226000.00");
  });

  it("leaves what is not an amount, or has no gross area to work on, as typed", () => {
    expect(convertPriceEntry("", "113.00", "PER_SQM")).toBe("");
    expect(convertPriceEntry("  ", "113.00", "TOTAL")).toBe("  ");
    expect(convertPriceEntry("12abc", "113.00", "PER_SQM")).toBe("12abc");
    expect(convertPriceEntry("1,200", "113.00", "TOTAL")).toBe("1,200"); // ambiguous: refused, not guessed
    expect(convertPriceEntry("12.345", "113.00", "TOTAL")).toBe("12.345");
    expect(convertPriceEntry("210000", null, "PER_SQM")).toBe("210000");
    expect(convertPriceEntry("2000", "0.00", "TOTAL")).toBe("2000");
  });
});

describe("switching how the price is typed", () => {
  /** Switches the box through `entries` in turn, as the dialog does, and returns what it ends on. */
  function through(text: string, grossArea: string | null, entries: PriceEntry[]) {
    let state: { text: string; entry: PriceEntry; last: PriceEntrySwitch | null } = { text, entry: entries[0]!, last: null };
    for (const next of entries.slice(1)) {
      const switched = switchPriceEntry(state.text, grossArea, state.entry, next, state.last);
      state = { text: switched.text, entry: next, last: switched.last };
    }
    return state;
  }

  it("restores the total when the rate was only looked at, instead of compounding the rounding", () => {
    // 200,000 on 105 m²: €1,904.76/m², which times 105 is €199,999.80, not the total typed.
    expect(priceFromRate("1904.76", "105.00")).toBe("199999.80");
    expect(through("200000.00", "105.00", ["TOTAL", "PER_SQM"]).text).toBe("1904.76");
    expect(through("200000.00", "105.00", ["TOTAL", "PER_SQM", "TOTAL"]).text).toBe("200000.00");
    // 185,000 on 113 m² would come back as 185,000.21; 99,999.99 on 72.40 as 100,000.33.
    expect(through("185000", "113.00", ["TOTAL", "PER_SQM", "TOTAL"]).text).toBe("185000");
    expect(through("99999.99", "72.40", ["TOTAL", "PER_SQM", "TOTAL", "PER_SQM", "TOTAL"]).text).toBe("99999.99");
  });

  it("restores a typed rate the same way", () => {
    expect(through("1904.7", "105.00", ["PER_SQM", "TOTAL"]).text).toBe("199993.50");
    expect(through("1904.7", "105.00", ["PER_SQM", "TOTAL", "PER_SQM"]).text).toBe("1904.7");
  });

  it("converts again once the value was edited", () => {
    const looked = switchPriceEntry("200000.00", "105.00", "TOTAL", "PER_SQM", null);
    // The rate is retyped: 2,000 × 105 is the new total.
    const back = switchPriceEntry("2000", "105.00", "PER_SQM", "TOTAL", looked.last);
    expect(back).toEqual({ text: "210000.00", last: { from: "2000", fromEntry: "PER_SQM", to: "210000.00" } });
  });

  it("remembers nothing for what is not an amount", () => {
    expect(switchPriceEntry("", "105.00", "TOTAL", "PER_SQM", null)).toEqual({ text: "", last: null });
    expect(switchPriceEntry("12abc", "105.00", "TOTAL", "PER_SQM", null)).toEqual({ text: "12abc", last: null });
    expect(switchPriceEntry("200000", null, "TOTAL", "PER_SQM", null)).toEqual({ text: "200000", last: null });
  });

  it("lets an untouched rate stand for the total it came from, and a typed one for nothing", () => {
    const { last } = switchPriceEntry("200000.00", "105.00", "TOTAL", "PER_SQM", null);
    expect(untouchedTotal("1904.76", "PER_SQM", last)).toBe("200000.00");
    expect(untouchedTotal("1904.77", "PER_SQM", last)).toBeNull();
    expect(untouchedTotal("1904.76", "TOTAL", last)).toBeNull();
    expect(untouchedTotal("1904.76", "PER_SQM", null)).toBeNull();
    // A rate converted into a total is not a total converted into a rate.
    const fromRate = switchPriceEntry("1904.76", "105.00", "PER_SQM", "TOTAL", null);
    expect(untouchedTotal("199999.80", "PER_SQM", fromRate.last)).toBeNull();
  });
});

describe("what a single unit's price is sent with", () => {
  const legacy = { askingPrice: "200000.00", currency: "EUR", priceBasis: "SALEABLE_AREA" as const };
  const unpriced = { askingPrice: null, currency: null, priceBasis: "SALEABLE_AREA" as const };
  const gross = { saleableArea: null, grossArea: "105.00" };
  const saleable = { saleableArea: "95.00", grossArea: "105.00" };
  const none = { saleableArea: null, grossArea: null };

  it("sends an unchanged price exactly as saved, on the basis it was saved on", () => {
    expect(priceToSave("200000.00", "EUR", legacy, gross)).toEqual({ askingPrice: "200000.00", priceBasis: "SALEABLE_AREA" });
    // The same amount written differently is the same price.
    expect(priceToSave("200000", "EUR", legacy, gross)).toEqual({ askingPrice: "200000.00", priceBasis: "SALEABLE_AREA" });
    expect(priceToSave("200 000,0", "EUR", legacy, gross)).toEqual({ askingPrice: "200000.00", priceBasis: "SALEABLE_AREA" });
    // No price before and none now: only the notes or the reason changed.
    expect(priceToSave("", "EUR", unpriced, gross)).toEqual({ askingPrice: "", priceBasis: "SALEABLE_AREA" });
    expect(priceToSave("  ", "ALL", unpriced, none)).toEqual({ askingPrice: "", priceBasis: "SALEABLE_AREA" });
  });

  it("sends a new price on the area it was worked out on: saleable when typed, else gross, else fixed", () => {
    expect(priceToSave("210000", "EUR", legacy, saleable)).toEqual({ askingPrice: "210000", priceBasis: "SALEABLE_AREA" });
    expect(priceToSave("210000", "EUR", legacy, gross)).toEqual({ askingPrice: "210000", priceBasis: "GROSS_AREA" });
    expect(priceToSave("210000", "EUR", unpriced, none)).toEqual({ askingPrice: "210000", priceBasis: "FIXED_UNIT_PRICE" });
    expect(priceToSave("", "EUR", legacy, gross)).toEqual({ askingPrice: "", priceBasis: "GROSS_AREA" });
    // The same amount in another currency is a new price.
    expect(priceToSave("200000.00", "USD", legacy, gross)).toEqual({ askingPrice: "200000.00", priceBasis: "GROSS_AREA" });
    // What the server will refuse goes as typed, for the server to say why.
    expect(priceToSave("1,200", "EUR", legacy, gross)).toEqual({ askingPrice: "1,200", priceBasis: "GROSS_AREA" });
  });
});

describe("the save request", () => {
  const price = { unitId: "cunit00000000000000000001", askingPrice: "120000", priceBasis: "SALEABLE_AREA", expectedVersion: 0 };

  it("reads amounts as the one-unit price does and keeps one optional reason", () => {
    const parsed = priceListSaveSchema.parse({ currency: "EUR", reason: "  ", prices: [price, { ...price, unitId: "cunit00000000000000000002", askingPrice: "" }] });
    expect(parsed.reason).toBeNull();
    expect(parsed.prices.map((row) => row.askingPrice)).toEqual(["120000", null]);
  });

  it("refuses a unit twice, an empty list, too many prices and a currency it does not know", () => {
    expect(priceListSaveSchema.safeParse({ currency: "EUR", prices: [price, price] }).success).toBe(false);
    expect(priceListSaveSchema.safeParse({ currency: "EUR", prices: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_PRICE_LIST_CHANGES + 1 }, (_, index) => ({ ...price, unitId: `cunit${String(index).padStart(20, "0")}` }));
    expect(priceListSaveSchema.safeParse({ currency: "EUR", prices: many }).success).toBe(false);
    expect(priceListSaveSchema.safeParse({ currency: "XYZ", prices: [price] }).success).toBe(false);
    expect(priceListSaveSchema.safeParse({ currency: "EUR", prices: [{ ...price, askingPrice: "1,200" }] }).success).toBe(false);
  });
});
