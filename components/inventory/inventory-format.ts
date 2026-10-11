import type { Locale } from "@/lib/i18n/config";
import { decimalText } from "@/lib/i18n/format";
import type { StockLevel } from "@/lib/modules/inventory/inventory.status";
import type { StatusTone } from "@/lib/utils/status";

/**
 * How Inventory renders numbers (PRD #20 §328).
 *
 * Quantities arrive as decimal strings and are never parsed into JavaScript
 * numbers to be displayed — only to be formatted. Trailing zeros are trimmed so
 * "12.0000" reads as "12", but the value itself is never rounded: if the ledger
 * holds 0.0001 tonnes, the page says 0.0001 tonnes.
 */
export function formatQuantity(value: string | null | undefined, locale: Locale): string {
  if (value === null || value === undefined || value === "") return "—";

  const [whole, fraction] = value.split(".");
  const trimmed = (fraction ?? "").replace(/0+$/, "");
  const sign = whole!.startsWith("-") ? "-" : "";
  const digits = sign ? whole!.slice(1) : whole!;

  return decimalText(`${sign}${digits}${trimmed ? `.${trimmed}` : ""}`, locale);
}

/** A quantity with its unit, which is the only way a quantity means anything. */
export function withUnit(value: string | null | undefined, unit: string, locale: Locale): string {
  const quantity = formatQuantity(value, locale);
  return quantity === "—" ? quantity : `${quantity} ${unit}`;
}

/** A signed quantity, where the sign carries the direction (PRD #20 §71). */
export function formatSigned(value: string, unit: string | undefined, locale: Locale): string {
  const negative = value.trim().startsWith("-");
  const body = formatQuantity(negative ? value.trim().slice(1) : value, locale);
  return `${negative ? "−" : "+"}${body}${unit ? ` ${unit}` : ""}`;
}

export const stockLevelTones: Record<StockLevel, StatusTone> = {
  OUT_OF_STOCK: "danger",
  BELOW_MINIMUM: "danger",
  LOW: "warning",
  OK: "success",
  NOT_TRACKED: "default",
};

