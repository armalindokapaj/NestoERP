import { describe, expect, it } from "vitest";

import { convertPriceEntry, grossPriceBasis, hasGrossArea, prevailingPrice, prevailingRate, priceFromRate, rateFromPrice, unitRate } from "@/lib/modules/sales/units/unit-pricing.rules";
import { pricePerSqm } from "@/lib/modules/sales/units/unit-sales.rules";
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
    expect(unitRate(unit({ saleableArea: "85.37" }), price, "SALEABLE_AREA")).toBe("1234.56");
    expect(unitRate(unit(), "250000.00", "FIXED_UNIT_PRICE")).toBeNull();
  });
});

describe("what a floor and the parking are priced at", () => {
  it("takes the rate most of a floor's units share on the basis, and none on a tie", () => {
    const floor = [
      unit({ saleableArea: "80.00", askingPrice: "96000.00" }), // 1200
      unit({ saleableArea: "100.00", askingPrice: "120000.00" }), // 1200
      unit({ saleableArea: "100.00", askingPrice: "135000.00" }), // 1350, priced by hand
      unit({ saleableArea: "100.00", askingPrice: "140000.00", priceBasis: "FIXED_UNIT_PRICE" }),
      unit({ saleableArea: "100.00" }),
    ];
    expect(prevailingRate(floor, "SALEABLE_AREA")).toBe("1200.00");
    expect(prevailingRate(floor, "GROSS_AREA")).toBeNull();
    expect(prevailingRate([unit({ askingPrice: "120000.00" }), unit({ askingPrice: "130000.00" })], "SALEABLE_AREA")).toBeNull();
  });

  it("takes the parking price most spaces ask", () => {
    expect(prevailingPrice([{ askingPrice: "15000.00" }, { askingPrice: "15000.00" }, { askingPrice: "18000.00" }, { askingPrice: null }])).toBe("15000.00");
    expect(prevailingPrice([{ askingPrice: null }])).toBeNull();
    expect(prevailingPrice([{ askingPrice: "15000.00" }, { askingPrice: "18000.00" }])).toBeNull();
  });
});

describe("a unit's price typed as a total or per m² of gross area", () => {
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

  it("has no rate without a gross area, or with a zero one", () => {
    expect(rateFromPrice("210000", null)).toBeNull();
    expect(rateFromPrice("210000", "0.00")).toBeNull();
    expect(hasGrossArea(null)).toBe(false);
    expect(hasGrossArea("0.00")).toBe(false);
    expect(hasGrossArea("0.01")).toBe(true);
  });

  it("saves a price on the gross area when the unit has one, else as a fixed price", () => {
    expect(grossPriceBasis("113.00")).toBe("GROSS_AREA");
    expect(grossPriceBasis(null)).toBe("FIXED_UNIT_PRICE");
    expect(grossPriceBasis("0.00")).toBe("FIXED_UNIT_PRICE");
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
