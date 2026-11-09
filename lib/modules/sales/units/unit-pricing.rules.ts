import { parseOptionalDecimal } from "@/lib/forms/decimal";
import { MONEY_RULE } from "@/lib/modules/finance/finance.fields";

import { pricePerSqm } from "./unit-sales.rules";
import type { UnitPriceBasis } from "./unit-sales.types";
import type { PriceListUnitDTO } from "./unit-pricing.types";

/**
 * The arithmetic of a price list (2026-11). Pure and client-safe: the editor
 * fills prices in with it, and the tests hold it to the cent.
 */

// BigInt() rather than literals: the build targets ES2017.
const ZERO = BigInt(0);
const TWO = BigInt(2);
const FIFTY = BigInt(50);
const HUNDRED = BigInt(100);

const PRICE_RULE = { label: "Price", ...MONEY_RULE };

/** Hundredths of a canonical two-decimal amount ("1200.5" → 120050). */
function hundredths(value: string): bigint {
  const [whole, fraction = ""] = value.trim().split(".");
  return BigInt(whole || "0") * HUNDRED + BigInt((fraction + "00").slice(0, 2));
}

function fromHundredths(value: bigint): string {
  const whole = value / HUNDRED;
  const cents = value % HUNDRED;
  return `${whole}.${cents.toString().padStart(2, "0")}`;
}

/**
 * A unit's price at a rate per square metre: the rate times the area, rounded
 * half up to the cent. Exact on integers — never a float — so 1,200/m² on
 * 85.37 m² is 102,444.00, not 102,443.99999.
 */
export function priceFromRate(rate: string, area: string | null): string | null {
  if (area === null) return null;
  const areaHundredths = hundredths(area);
  if (areaHundredths <= ZERO) return null;
  // (rate¢ / 100) × (area / 100) currency = rate¢ × area / 100 cents.
  const product = hundredths(rate) * areaHundredths;
  return fromHundredths((product + FIFTY) / HUNDRED);
}

/**
 * The rate per m² a price works out at on an area: the price over the area,
 * rounded half up to the cent — `pricePerSqm`'s answer, but on integers, so a
 * fifteen-digit price is as exact as a small one.
 */
export function rateFromPrice(price: string, area: string | null): string | null {
  if (area === null) return null;
  const areaHundredths = hundredths(area);
  if (areaHundredths <= ZERO) return null;
  // (price¢ / 100) / (area / 100) currency = price¢ × 100 / area cents; + ½ before dividing rounds half up.
  const cents = hundredths(price) * HUNDRED;
  return fromHundredths((cents * TWO + areaHundredths) / (TWO * areaHundredths));
}

/**
 * How a unit's asking price is typed (2026-11-09): the total itself, or a
 * price per m² of the unit's gross area that the total is worked out from.
 * Either way only the total is saved; the rate is never stored.
 */
export const PRICE_ENTRIES = ["TOTAL", "PER_SQM"] as const;
export type PriceEntry = (typeof PRICE_ENTRIES)[number];

/** Whether a unit has a gross area to price per m² on: present and above zero. */
export function hasGrossArea(grossArea: string | null): boolean {
  return grossArea !== null && hundredths(grossArea) > ZERO;
}

/**
 * The basis a price is saved on. A price per m² always means per m² of gross
 * area, so a unit with a gross area is priced on it; one without has a fixed
 * price.
 */
export function grossPriceBasis(grossArea: string | null): UnitPriceBasis {
  return hasGrossArea(grossArea) ? "GROSS_AREA" : "FIXED_UNIT_PRICE";
}

/**
 * What the price box holds after switching how the price is typed: a total
 * becomes its rate on the gross area (rounded to the cent), a rate becomes the
 * total it gives. Anything that is not an amount — empty, half typed, invalid —
 * stays as typed, and so does every value when there is no gross area.
 */
export function convertPriceEntry(text: string, grossArea: string | null, to: PriceEntry): string {
  return convertedEntry(text, grossArea, to) ?? text;
}

/** The converted value, or null when the text is not an amount or there is no gross area. */
function convertedEntry(text: string, grossArea: string | null, to: PriceEntry): string | null {
  const parsed = parseOptionalDecimal(text, PRICE_RULE);
  if (!parsed.ok || parsed.value === null) return null;
  return to === "PER_SQM" ? rateFromPrice(parsed.value, grossArea) : priceFromRate(parsed.value, grossArea);
}

/**
 * The last switch of the price box: what it held (`from`, typed as
 * `fromEntry`) and the converted text the switch put there (`to`).
 */
export type PriceEntrySwitch = { from: string; fromEntry: PriceEntry; to: string };

/**
 * Switches how the price is typed without compounding the rounding. A total
 * turned into a rate is rounded to the cent, so turning that rate straight
 * back would move the total by a few cents (€200,000 on 105 m² → €1,904.76 →
 * €199,999.80). Switching back while the box still holds the converted text,
 * unedited, restores what was there instead; only an edited value is
 * converted again.
 */
export function switchPriceEntry(text: string, grossArea: string | null, from: PriceEntry, to: PriceEntry, last: PriceEntrySwitch | null): { text: string; last: PriceEntrySwitch | null } {
  if (from === to) return { text, last };
  if (last && last.fromEntry === to && last.to === text) return { text: last.from, last: null };
  const converted = convertedEntry(text, grossArea, to);
  return converted === null ? { text, last: null } : { text: converted, last: { from: text, fromEntry: from, to: converted } };
}

/**
 * The total a rate box stands for when it still holds, unedited, the rate a
 * total was converted into: that total itself, not the rate times the area —
 * looking at the rate never changes the price. Null for a rate that was typed.
 */
export function untouchedTotal(text: string, entry: PriceEntry, last: PriceEntrySwitch | null): string | null {
  return entry === "PER_SQM" && last?.fromEntry === "TOTAL" && last.to === text ? last.from : null;
}

/**
 * The asking price and basis a single unit's price is sent with. A new price
 * is on the gross area (fixed without one); a price that did not change —
 * the same amount, and for a priced unit the same currency — is sent exactly
 * as it was saved, on the basis it was saved on, because the server counts a
 * new basis, or "200000" against "200000.00", as a price change. So saving
 * only the notes or the reason never records one.
 */
export function priceToSave(total: string, currency: string, saved: { askingPrice: string | null; currency: string | null; priceBasis: UnitPriceBasis }, grossArea: string | null): { askingPrice: string; priceBasis: UnitPriceBasis } {
  const parsed = parseOptionalDecimal(total, PRICE_RULE);
  const same =
    parsed.ok &&
    (parsed.value === null
      ? saved.askingPrice === null
      : saved.askingPrice !== null && hundredths(parsed.value) === hundredths(saved.askingPrice) && currency === saved.currency);
  return same ? { askingPrice: saved.askingPrice ?? "", priceBasis: saved.priceBasis } : { askingPrice: total, priceBasis: grossPriceBasis(grossArea) };
}

/**
 * The price per m² a price list row shows: per m² of gross area — what a price
 * per m² always means (2026-11-09), and the area the row shows beside it — and
 * none for a fixed price.
 */
export function grossRate(unit: Pick<PriceListUnitDTO, "grossArea">, price: string | null, basis: UnitPriceBasis): string | null {
  return basis === "FIXED_UNIT_PRICE" ? null : pricePerSqm(price, "GROSS_AREA", { grossArea: unit.grossArea });
}

/** A unit's price per m² on its own basis, derived as the inventory derives it (E-05E §10). */
export function unitRate(unit: Pick<PriceListUnitDTO, "saleableArea" | "grossArea" | "internalArea">, price: string | null, basis: UnitPriceBasis): string | null {
  return pricePerSqm(price, basis, { saleableArea: unit.saleableArea, grossArea: unit.grossArea, internalArea: unit.internalArea });
}

/**
 * The rate more of a floor's priced units share on a basis than any other —
 * what the floor "is" at. Null when none is priced on it, or when two rates are
 * equally common: a floor of one unit at the floor's rate and one priced by hand
 * has no rate to suggest.
 */
export function prevailingRate(units: Array<Pick<PriceListUnitDTO, "saleableArea" | "grossArea" | "internalArea" | "askingPrice" | "priceBasis">>, basis: UnitPriceBasis): string | null {
  const tally = new Map<string, number>();
  for (const unit of units) {
    if (unit.priceBasis !== basis) continue;
    const rate = unitRate(unit, unit.askingPrice, basis);
    if (rate !== null) tally.set(rate, (tally.get(rate) ?? 0) + 1);
  }
  return mostCommon(tally);
}

/** The key counted most often; null when there is none or the lead is shared. */
function mostCommon(tally: Map<string, number>): string | null {
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked.length > 1 && ranked[0]![1] === ranked[1]![1])) return null;
  return ranked[0]![0];
}

/** The one price more of the given units ask than any other — the parking price — or null. */
export function prevailingPrice(units: Array<Pick<PriceListUnitDTO, "askingPrice">>): string | null {
  const tally = new Map<string, number>();
  for (const unit of units) if (unit.askingPrice !== null) tally.set(unit.askingPrice, (tally.get(unit.askingPrice) ?? 0) + 1);
  return mostCommon(tally);
}
