/**
 * Currency and unit safety (PRD #27 §98-§102, §123-§125).
 *
 * The rule these functions exist to enforce: NESTO has no FX engine and no unit
 * conversion, so it must never present EUR + USD as a single number, or add
 * kilograms to pieces. Grouping is honest; a fabricated total is not
 * (PRD #27 §99, §418).
 */

export type CurrencyGroup = { currency: string; total: string };
export type UnitGroup = { unit: string; total: string };

export type ReportWarning = { code: string; message: string };

/** Sums with Decimal-safe string arithmetic, one bucket per currency. */
export function groupByCurrency(
  rows: Array<{ currency: string; amount: string | number }>,
): { groups: CurrencyGroup[]; warnings: ReportWarning[] } {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const amount = typeof row.amount === "string" ? Number.parseFloat(row.amount) : row.amount;
    if (Number.isNaN(amount)) continue;
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + amount);
  }

  const groups = [...totals.entries()]
    .map(([currency, total]) => ({ currency, total: total.toFixed(2) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  const warnings: ReportWarning[] =
    groups.length > 1
      ? [
          {
            code: "MULTIPLE_CURRENCIES",
            message: "Totals are shown by currency because NESTO does not convert between them.",
          },
        ]
      : [];

  return { groups, warnings };
}

export function groupByUnit(
  rows: Array<{ unit: string; quantity: string | number }>,
): { groups: UnitGroup[]; warnings: ReportWarning[] } {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const quantity = typeof row.quantity === "string" ? Number.parseFloat(row.quantity) : row.quantity;
    if (Number.isNaN(quantity)) continue;
    totals.set(row.unit, (totals.get(row.unit) ?? 0) + quantity);
  }

  const groups = [...totals.entries()]
    .map(([unit, total]) => ({ unit, total: String(total) }))
    .sort((a, b) => a.unit.localeCompare(b.unit));

  const warnings: ReportWarning[] =
    groups.length > 1
      ? [
          {
            code: "MIXED_UNITS",
            message: "Quantities are shown by unit and are not combined.",
          },
        ]
      : [];

  return { groups, warnings };
}

/**
 * Refuses to produce a single total across currencies.
 *
 * Callers that genuinely need one number must first filter to one currency —
 * there is no correct answer otherwise (PRD #27 §99).
 */
export function assertSingleCurrency(rows: Array<{ currency: string }>): string {
  const currencies = new Set(rows.map((row) => row.currency));
  if (currencies.size > 1) throw new Error("MULTIPLE_CURRENCIES_UNSUPPORTED");
  return [...currencies][0] ?? "";
}
