import { pricePerSqm } from "./unit-sales.rules";
import type { UnitPriceBasis } from "./unit-sales.types";
import { AREA_OF_BASIS, type AreaPriceBasis, type PriceListUnitDTO } from "./unit-pricing.types";

/**
 * The arithmetic of a price list (2026-11). Pure and client-safe: the editor
 * fills prices in with it, and the tests hold it to the cent.
 */

// BigInt() rather than literals: the build targets ES2017.
const ZERO = BigInt(0);
const FIFTY = BigInt(50);
const HUNDRED = BigInt(100);

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

/** The area a basis divides by, for one unit. */
export function areaFor(unit: Pick<PriceListUnitDTO, "saleableArea" | "grossArea" | "internalArea">, basis: AreaPriceBasis): string | null {
  return unit[AREA_OF_BASIS[basis]];
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
export function prevailingRate(units: Array<Pick<PriceListUnitDTO, "saleableArea" | "grossArea" | "internalArea" | "askingPrice" | "priceBasis">>, basis: AreaPriceBasis): string | null {
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

/**
 * The area basis a project's floors are priced on: the one its priced units
 * use most, else the first area most of its units have (saleable, then gross,
 * then internal), else saleable.
 */
export function defaultAreaBasis(units: Array<Pick<PriceListUnitDTO, "saleableArea" | "grossArea" | "internalArea" | "askingPrice" | "priceBasis">>): AreaPriceBasis {
  const order: AreaPriceBasis[] = ["SALEABLE_AREA", "GROSS_AREA", "INTERNAL_AREA"];
  const used = order.map((basis) => units.filter((unit) => unit.askingPrice !== null && unit.priceBasis === basis).length);
  const mostUsed = Math.max(...used);
  if (mostUsed > 0) return order[used.indexOf(mostUsed)]!;
  const present = order.map((basis) => units.filter((unit) => areaFor(unit, basis) !== null).length);
  const mostPresent = Math.max(...present);
  return mostPresent > 0 ? order[present.indexOf(mostPresent)]! : "SALEABLE_AREA";
}
