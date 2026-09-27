import type { Currency, Unit } from "@/lib/3d/viewer/types";
import { formatPrice } from "@/lib/3d/viewer/utils";

export function convertUnitPrice(amountInUnitCurrency: number, unitCurrency: string, displayCurrency: Currency, eurToAllRate: number): number {
  if (unitCurrency === displayCurrency) return amountInUnitCurrency;
  if (unitCurrency === "EUR" && displayCurrency === "ALL") return amountInUnitCurrency * eurToAllRate;
  if (unitCurrency === "ALL" && displayCurrency === "EUR") return amountInUnitCurrency / eurToAllRate;
  return amountInUnitCurrency;
}

/**
 * A unit's price as the lists print it. NESTO addition: a unit priced in a
 * currency other than EUR or ALL keeps its own currency, and a price hidden
 * from this reader (or not set) prints `onRequest`.
 */
export function unitPriceLabel(unit: Pick<Unit, "price" | "currency">, displayCurrency: Currency, eurToAllRate: number, onRequest: string): string {
  if (unit.price == null) return onRequest;
  if (unit.currency !== "EUR" && unit.currency !== "ALL") return formatPrice(unit.price, unit.currency);
  return formatPrice(convertUnitPrice(unit.price, unit.currency, displayCurrency, eurToAllRate), displayCurrency);
}

const SQM_TO_SQFT = 10.7639;

export function formatUnitArea(areaSqm: number, unit: "m2" | "ft2"): string {
  if (unit === "ft2") return `${Math.round(areaSqm * SQM_TO_SQFT)} ft²`;
  return `${areaSqm} m²`;
}

export function areaToDisplay(areaSqm: number, unit: "m2" | "ft2"): number {
  return unit === "ft2" ? Math.round(areaSqm * SQM_TO_SQFT) : areaSqm;
}

export function areaFromDisplay(value: number, unit: "m2" | "ft2"): number {
  return unit === "ft2" ? Math.round(value / SQM_TO_SQFT) : value;
}
