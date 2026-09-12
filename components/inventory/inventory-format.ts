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
export function formatQuantity(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  const [whole, fraction] = value.split(".");
  const trimmed = (fraction ?? "").replace(/0+$/, "");
  const sign = whole!.startsWith("-") ? "-" : "";
  const digits = sign ? whole!.slice(1) : whole!;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${sign}${grouped}${trimmed ? `.${trimmed}` : ""}`;
}

/** A quantity with its unit, which is the only way a quantity means anything. */
export function withUnit(value: string | null | undefined, unit: string): string {
  const quantity = formatQuantity(value);
  return quantity === "—" ? quantity : `${quantity} ${unit}`;
}

/** A signed quantity, where the sign carries the direction (PRD #20 §71). */
export function formatSigned(value: string, unit?: string): string {
  const negative = value.trim().startsWith("-");
  const body = formatQuantity(negative ? value.trim().slice(1) : value);
  return `${negative ? "−" : "+"}${body}${unit ? ` ${unit}` : ""}`;
}

export const stockLevelTones: Record<StockLevel, StatusTone> = {
  OUT_OF_STOCK: "danger",
  BELOW_MINIMUM: "danger",
  LOW: "warning",
  OK: "success",
  NOT_TRACKED: "default",
};

/**
 * The line a document posts against stock, said once (PRD #20 §311, §314, §316).
 *
 * Posting is the irreversible half of every stock document, so the confirmation
 * says what will actually change rather than "are you sure".
 */
export const postWarnings: Record<string, string> = {
  receipts: "This will increase stock in the locations named on the lines.",
  issues: "This will reduce stock in the locations named on the lines.",
  returns: "This will increase stock in the locations named on the lines.",
  transfers: "Source stock decreases and destination stock increases, in one step.",
  adjustments:
    "This directly changes recorded stock and cannot be edited after posting.",
};
