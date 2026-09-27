import { formatAmount } from "@/lib/modules/finance/finance.currency";
import type { CurrencyTotal, MoneyDTO } from "@/lib/modules/procurement/procurement.types";
import type { Translate } from "@/lib/i18n/translator";

/**
 * Procurement display helpers (PRD #19 §282).
 *
 * Money is formatted from its decimal string and never parsed into a number for
 * arithmetic — the only thing a float touches here is the pixels.
 */
export function moneyLabel(value: MoneyDTO | null): string | null {
  if (!value) return null;
  return formatAmount(value.amount, value.currency);
}

/** Several currencies are listed, never summed (PRD #19 §190). */
export function totalsLabel(totals: CurrencyTotal[] | null): string {
  if (!totals || totals.length === 0) return "—";
  return totals.map((total) => formatAmount(total.value, total.currency)).join(" · ");
}

/** "3 of 8 received", said in words rather than only as a bar (PRD #19 §289). */
export function receivedLabel(t: Translate<"procurement">, fraction: number): string {
  if (fraction <= 0) return t("format.nothingReceived");
  if (fraction >= 1) return t("format.fullyReceived");
  return t("format.percentReceived", { percent: Math.round(fraction * 100) });
}

export function dueLabel(t: Translate<"procurement">, days: number | null): string {
  if (days === null) return t("format.noDateSet");
  if (days === 0) return t("format.dueToday");
  if (days > 0) return t("format.dueIn", { count: days });
  return t("format.overdue", { count: Math.abs(days) });
}

export { formatAmount };
