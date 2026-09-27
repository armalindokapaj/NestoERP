/**
 * Decimal input and exact preview arithmetic (AUD-09 §4, FV-06).
 *
 * The parser is `lib/forms/decimal`'s (re-exported here), the one reading of a
 * typed number every module shares. What this module adds is exact preview
 * arithmetic — AUD-09: candidate for lib/forms. It imports nothing but that
 * parser, so a client component can use it without pulling a database client
 * or Prisma's Decimal into its bundle.
 *
 * ## The locale rule (one rule, stated once)
 *
 * - A point is always the decimal point: `1234.5`, `0.125`.
 * - A comma is read as a decimal comma — `12,5` is twelve and a half — except
 *   in `d,ddd` / `dd,ddd` / `ddd,ddd` (a non-zero whole part, one comma, exactly
 *   three digits after it). `1,234` is one thousand two hundred and thirty-four
 *   to an English reader and one point two three four to an Albanian one, so
 *   it is refused with both spellings offered instead of guessed.
 * - Thousands may be grouped with spaces only (`1 234 567,50`), in groups of
 *   three. A point and a comma in the same number (`1.234,50`, `1,234.50`) or
 *   two of either (`1.234.567`) are refused: which one is the decimal separator
 *   is exactly the ambiguity.
 * - No exponent, no `Infinity`/`NaN`, no leading `+`, no leading or trailing
 *   separator. A minus sign only where the field's domain allows a negative.
 * - Empty is not zero. Whether an empty field means "no value" is the field's
 *   decision (`optional*` in the schemas), never this parser's.
 *
 * ## Precision
 *
 * Money carries two decimals; quantity, unit price and rates four; percentages
 * as their column allows. `maxIntegerDigits` keeps a value inside its column
 * (`Decimal(18, 4)` has fourteen whole digits), so an out-of-range value is a
 * field error rather than a database overflow answered as a 500.
 */

import { parseDecimalInput, type DecimalRule } from "@/lib/forms/decimal";

export {
  compareDecimal,
  parseDecimalInput,
  parseOptionalDecimal,
  type DecimalErrorCode,
  type DecimalParse,
  type DecimalRule,
} from "@/lib/forms/decimal";

/* -------------------------------------------------------------------------- */
/* Exact fixed-point arithmetic for previews and schema bounds                 */
/* -------------------------------------------------------------------------- */

/*
 * A canonical decimal string as a scaled integer. `BigInt` rather than a
 * `number`: `0.1 + 0.2` is not an acceptable preview of an invoice either, and a
 * preview that disagrees with the saved total by a cent teaches people to
 * distrust both (AUD-09 §7, AUD-01).
 */
function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const digits = `${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`;
  const scaled = BigInt(digits === "" ? "0" : digits);
  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Divides by 10^places, rounding half away from zero (Decimal's ROUND_HALF_UP). */
function shiftRound(value: bigint, places: number): bigint {
  if (places <= 0) return value;
  const divisor = BigInt(10) ** BigInt(places);
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * BigInt(2) >= divisor ? quotient + BigInt(1) : quotient;
  return negative ? -rounded : rounded;
}

/** `a × b` rounded to `scale` places, exactly. */
export function multiplyDecimal(a: string, b: string, scale: number): string {
  const product = toScaled(a, 4) * toScaled(b, 4);
  return fromScaled(shiftRound(product, 8 - scale), scale);
}

/** `Σ values` at `scale` places, exactly. */
export function sumDecimal(values: string[], scale: number): string {
  return fromScaled(
    values.reduce((total, value) => total + toScaled(value, scale), BigInt(0)),
    scale,
  );
}

/** `base × percent / 100` rounded to currency precision — `percentOf` on the server. */
export function percentOfDecimal(base: string, percent: string): string {
  const product = toScaled(base, 2) * toScaled(percent, 4);
  return fromScaled(shiftRound(product, 6), 2);
}

/** Whole digits of a canonical decimal string, for bounds on a computed figure. */
export function integerDigits(value: string): number {
  const whole = value.replace(/^-/, "").split(".")[0].replace(/^0+/, "");
  return whole.length;
}

export function isZeroDecimal(value: string): boolean {
  return !/[1-9]/.test(value);
}

export function isPositiveDecimal(value: string): boolean {
  return !value.startsWith("-") && !isZeroDecimal(value);
}


/**
 * A priced line's figures, in the server's own order: subtotal rounded first,
 * tax on the rounded subtotal, total the sum (AUD-01; `calculateLine`). `null`
 * when a figure is not yet a number, so a preview shows nothing rather than a
 * confident zero.
 */
export function pricedLinePreview(
  line: { quantity: string; unitPrice: string; taxRate: string },
  taxRateIsFraction = false,
): { subtotal: string; taxAmount: string; totalAmount: string } | null {
  const quantity = parseDecimalInput(line.quantity, PREVIEW_RULE);
  const unitPrice = parseDecimalInput(line.unitPrice, PREVIEW_RULE);
  const taxRate = parseDecimalInput(line.taxRate, PREVIEW_RULE);
  if (!quantity.ok || !unitPrice.ok || !taxRate.ok) return null;
  const subtotal = multiplyDecimal(quantity.value, unitPrice.value, 2);
  const taxAmount = taxRateIsFraction
    ? multiplyDecimal(subtotal, taxRate.value, 2)
    : percentOfDecimal(subtotal, taxRate.value);
  return { subtotal, taxAmount, totalAmount: sumDecimal([subtotal, taxAmount], 2) };
}

const PREVIEW_RULE: DecimalRule = { label: "Value", scale: 4, maxIntegerDigits: 14, allowNegative: true };

/** The canonical string, or `null` — for previews that must not guess. */
export function previewDecimal(value: string, scale = 4): string | null {
  const parsed = parseDecimalInput(value, { ...PREVIEW_RULE, scale });
  return parsed.ok ? parsed.value : null;
}
