import { parseOptionalDecimal } from "@/lib/forms/decimal";
import { MONEY_RULE } from "@/lib/modules/finance/finance.fields";

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
 * price per m² of the unit's sale area that the total is worked out from.
 * Either way only the total is saved; the rate is never stored.
 */
export const PRICE_ENTRIES = ["TOTAL", "PER_SQM"] as const;
export type PriceEntry = (typeof PRICE_ENTRIES)[number];

/** The two areas a unit's sale area is chosen from: canonical two-decimal strings, or null. */
export type SaleAreas = { saleableArea: string | null; grossArea: string | null };

/** The area a unit is sold by and the basis that names it; a fixed price has no area. */
export type SaleArea = { area: string | null; basis: UnitPriceBasis };

function positive(area: string | null | undefined): area is string {
  return area !== null && area !== undefined && /^\d+(\.\d+)?$/.test(area.trim()) && hundredths(area) > ZERO;
}

/**
 * The area a unit is sold by — one rule, the same on every screen (the user's
 * decision, 2026-11-09): its saleable area when someone typed one above zero,
 * otherwise its gross area. It drives the Sales area column, the area filters
 * and sorts, every price per m² shown, a price typed per m² and the price
 * list's floor rate. The basis is what a price per m² is saved on: the
 * saleable or the gross area, whichever was used, and a fixed price when the
 * unit has neither.
 */
export function saleArea(areas: SaleAreas): SaleArea {
  if (positive(areas.saleableArea)) return { area: areas.saleableArea, basis: "SALEABLE_AREA" };
  if (positive(areas.grossArea)) return { area: areas.grossArea, basis: "GROSS_AREA" };
  return { area: null, basis: "FIXED_UNIT_PRICE" };
}

/** Whether a unit has an area to price per m² on. */
export function hasSaleArea(areas: SaleAreas): boolean {
  return saleArea(areas).area !== null;
}

/**
 * A unit's price per m²: the total over its sale area, rounded half up to the
 * cent — whatever basis the price was saved on, so every screen shows the same
 * figure. None without a price or a sale area.
 */
export function saleRate(areas: SaleAreas, price: string | null): string | null {
  if (price === null) return null;
  return rateFromPrice(price, saleArea(areas).area);
}

/**
 * What the price box holds after switching how the price is typed: a total
 * becomes its rate on the unit's sale area (rounded to the cent), a rate
 * becomes the total it gives. Anything that is not an amount — empty, half
 * typed, invalid — stays as typed, and so does every value when there is no
 * area.
 */
export function convertPriceEntry(text: string, area: string | null, to: PriceEntry): string {
  return convertedEntry(text, area, to) ?? text;
}

/** The converted value, or null when the text is not an amount or there is no area. */
function convertedEntry(text: string, area: string | null, to: PriceEntry): string | null {
  const parsed = parseOptionalDecimal(text, PRICE_RULE);
  if (!parsed.ok || parsed.value === null) return null;
  return to === "PER_SQM" ? rateFromPrice(parsed.value, area) : priceFromRate(parsed.value, area);
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
export function switchPriceEntry(text: string, area: string | null, from: PriceEntry, to: PriceEntry, last: PriceEntrySwitch | null): { text: string; last: PriceEntrySwitch | null } {
  if (from === to) return { text, last };
  if (last && last.fromEntry === to && last.to === text) return { text: last.from, last: null };
  const converted = convertedEntry(text, area, to);
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
 * is on the unit's sale area — saleable, else gross, fixed without either; a
 * price that did not change — the same amount, and for a priced unit the same
 * currency — is sent exactly as it was saved, on the basis it was saved on,
 * because the server counts a new basis, or "200000" against "200000.00", as a
 * price change. So saving only the notes or the reason never records one.
 */
export function priceToSave(total: string, currency: string, saved: { askingPrice: string | null; currency: string | null; priceBasis: UnitPriceBasis }, areas: SaleAreas): { askingPrice: string; priceBasis: UnitPriceBasis } {
  const parsed = parseOptionalDecimal(total, PRICE_RULE);
  const same =
    parsed.ok &&
    (parsed.value === null
      ? saved.askingPrice === null
      : saved.askingPrice !== null && hundredths(parsed.value) === hundredths(saved.askingPrice) && currency === saved.currency);
  return same ? { askingPrice: saved.askingPrice ?? "", priceBasis: saved.priceBasis } : { askingPrice: total, priceBasis: saleArea(areas).basis };
}

/**
 * The rate per m² more of a floor's units priced by area share than any other —
 * what the floor "is" at — each on its own sale area. Null when none is priced
 * by area, or when two rates are equally common: a floor of one unit at the
 * floor's rate and one priced by hand has no rate to suggest. A fixed price
 * (a parking space, a unit with no area) is not a rate.
 */
export function prevailingRate(units: Array<SaleAreas & Pick<PriceListUnitDTO, "askingPrice" | "priceBasis">>): string | null {
  const tally = new Map<string, number>();
  for (const unit of units) {
    if (unit.priceBasis === "FIXED_UNIT_PRICE") continue;
    const rate = saleRate(unit, unit.askingPrice);
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
