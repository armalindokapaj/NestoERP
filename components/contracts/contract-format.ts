import { formatAmount } from "@/lib/modules/finance/finance.currency";
import type { ContractCommercialDTO, CurrencyTotal } from "@/lib/modules/contracts/contract.types";
import { englishContracts } from "@/lib/i18n/modules/contracts/labels";
import type { Translate } from "@/lib/i18n/translator";

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
export function commercialLabel(
  commercial: ContractCommercialDTO | null,
  t: Translate<"contracts"> = englishContracts,
): string | null {
  if (!commercial) return null;
  // English: "Not priced".
  if (commercial.contractValue === null || commercial.currency === null) return t("format.notPriced");
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
export function expiryLabel(days: number | null, t: Translate<"contracts"> = englishContracts): string {
  if (days === null) return t("format.noFixedExpiry");
  if (days === 0) return t("format.expiresToday");
  if (days > 0) return t("format.expiresIn", { count: days });
  return t("format.expiredAgo", { count: Math.abs(days) });
}

export { formatAmount };
