import { AmountText } from "@/components/i18n/format-text";
import { cn } from "@/lib/utils/cn";

/**
 * A monetary amount (PRD #15 §302, §303).
 *
 * Right-aligned and tabular so a column of figures lines up on the decimal
 * point, which is the whole reason financial tables are readable at all. The
 * amount arrives as a decimal string and is formatted for display only — no
 * arithmetic happens in the browser.
 */
export function Money({
  amount,
  currency,
  className,
  emphasis = false,
}: {
  amount: string;
  currency: string;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <span
      className={cn("tabular-nums", emphasis && "font-semibold text-fg", className)}
      title={`${amount} ${currency}`}
    >
      <AmountText amount={amount} currency={currency} />
    </span>
  );
}

/**
 * A variance, where the sign carries meaning (PRD #15 §303).
 *
 * Negative is over budget and reads as a problem; the sign is always printed,
 * so colour never carries the meaning alone.
 */
export function Variance({
  amount,
  currency,
  className,
}: {
  amount: string;
  currency: string;
  className?: string;
}) {
  const negative = amount.startsWith("-");

  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        negative ? "text-danger-strong" : "text-success-strong",
        className,
      )}
      title={`${amount} ${currency}`}
    >
      {negative ? "" : "+"}
      <AmountText amount={amount} currency={currency} />
    </span>
  );
}

/**
 * A currency-grouped total (PRD #15 §36, §150).
 *
 * Several currencies are listed, never summed. An empty list renders a zero in
 * the base currency rather than nothing, because a blank where a number belongs
 * reads as a broken page.
 */
export function CurrencyTotals({
  totals,
  baseCurrency,
  className,
}: {
  totals: { currency: string; amount: string }[];
  baseCurrency: string;
  className?: string;
}) {
  if (totals.length === 0) {
    return (
      <span className={cn("tabular-nums", className)}><AmountText amount="0" currency={baseCurrency} /></span>
    );
  }

  return (
    <span className={cn("flex flex-col gap-0.5", className)}>
      {totals.map((total) => (
        <span key={total.currency} className="tabular-nums">
          <AmountText amount={total.amount} currency={total.currency} />
        </span>
      ))}
    </span>
  );
}
