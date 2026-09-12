import { formatAmount } from "@/lib/modules/finance/finance.currency";
import type { CurrencyTotal, MoneyDTO } from "@/lib/modules/procurement/procurement.types";

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
export function receivedLabel(fraction: number): string {
  if (fraction <= 0) return "Nothing received";
  if (fraction >= 1) return "Fully received";
  return `${Math.round(fraction * 100)}% received`;
}

export function dueLabel(days: number | null): string {
  if (days === null) return "No date set";
  if (days === 0) return "Due today";
  if (days > 0) return `Due in ${days} day${days === 1 ? "" : "s"}`;
  const late = Math.abs(days);
  return `${late} day${late === 1 ? "" : "s"} overdue`;
}

export { formatAmount };
