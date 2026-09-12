import { formatAmount } from "@/lib/modules/finance/finance.currency";
import type { ContractCommercialDTO, CurrencyTotal } from "@/lib/modules/contracts/contract.types";

/**
 * Legal display helpers (PRD #18 §351, §495).
 *
 * Money is formatted from its decimal string and never parsed into a number for
 * arithmetic — the only thing a float touches here is the pixels.
 *
 * `commercialLabel` returns `null` rather than a dash when the reader has no
 * commercial permission, so the caller omits the row entirely instead of
 * rendering an empty space where a figure clearly belongs (PRD #18 §495).
 */
export function commercialLabel(commercial: ContractCommercialDTO | null): string | null {
  if (!commercial) return null;
  if (commercial.contractValue === null || commercial.currency === null) return "Not priced";
  return formatAmount(commercial.contractValue, commercial.currency);
}

/**
 * Currency-grouped totals as text.
 *
 * Several currencies are listed, never summed: V0.1 has no FX engine, so the
 * only honest presentation is side by side (PRD #18 §65, §447).
 */
export function totalsLabel(totals: CurrencyTotal[] | null): string {
  if (!totals || totals.length === 0) return "—";
  return totals.map((total) => formatAmount(total.value, total.currency)).join(" · ");
}

/** "Expires in 18 days", "Expired 4 days ago", "No fixed expiry" (PRD #18 §490, §491). */
export function expiryLabel(days: number | null): string {
  if (days === null) return "No fixed expiry";
  if (days === 0) return "Expires today";
  if (days > 0) return `Expires in ${days} day${days === 1 ? "" : "s"}`;
  const past = Math.abs(days);
  return `Expired ${past} day${past === 1 ? "" : "s"} ago`;
}

export { formatAmount };
