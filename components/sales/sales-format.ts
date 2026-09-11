import { formatAmount } from "@/lib/modules/finance/finance.currency";
import type { CurrencyTotal } from "@/lib/modules/sales/sales.types";

/**
 * Sales display helpers (PRD #17 §276, §277, §407).
 *
 * Money is formatted from its decimal string and never parsed into a number for
 * arithmetic — the only thing a float touches here is the pixels.
 */

/** `€100,000 · 60% · €60,000 weighted` (PRD #17 §277). */
export function weightedLabel(value: string, weighted: string, currency: string): string {
  return `${formatAmount(value, currency)} · ${formatAmount(weighted, currency)} weighted`;
}

/**
 * A currency-grouped total as text.
 *
 * Several currencies are listed, never summed: V0.1 has no FX engine, so the
 * only honest presentation is side by side (PRD #17 §31, §172).
 */
export function totalsLabel(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return "—";
  return totals.map((total) => formatAmount(total.value, total.currency)).join(" · ");
}

export function weightedTotalsLabel(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return "—";
  return totals.map((total) => formatAmount(total.weightedValue, total.currency)).join(" · ");
}

/**
 * The screen-reader sentence for a pipeline card (PRD #17 §406).
 *
 * Stage, probability and value as words, because a Kanban column's meaning must
 * not depend on where a card happens to sit.
 */
export function cardDescription(input: {
  name: string;
  stage: string;
  probability: string;
  value: string;
  currency: string;
}): string {
  return `${input.name}. Stage: ${input.stage}. Probability: ${input.probability} percent. Value: ${formatAmount(input.value, input.currency)}.`;
}

export { formatAmount };
