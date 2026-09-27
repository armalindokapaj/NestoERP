/**
 * Reading a typed number (AUD-09 §4, FV-06).
 *
 * The one reading of a money amount, a quantity or a percentage that the
 * browser and the server share: a client component validates with it before
 * anything is sent, and the server schemas (`lib/modules/shared/fields.ts`)
 * run the very same function, so the two can never disagree about what
 * `1,234` means. It imports nothing — no database client, no Prisma Decimal —
 * so a form bundle can use it freely.
 *
 * The result is a canonical decimal *string* (`"1234.5"`, `"-3"`), never a
 * JavaScript number: money stays a string all the way to `Prisma.Decimal`, and
 * authoritative totals never pass through floating point (AUD-01).
 *
 * ## The locale rule (stated once; the app's locales are en and sq)
 *
 * - A point is always the decimal point: `1234.5`, `0.125`.
 * - A comma is read as a decimal comma — `12,5` is twelve and a half — except
 *   in `d,ddd` / `dd,ddd` / `ddd,ddd` (a non-zero whole part of one to three
 *   digits, one comma, exactly three digits after it). `1,234` is one thousand
 *   two hundred and thirty-four to an English reader and one point two three
 *   four to an Albanian one, so it is refused with both spellings offered
 *   instead of guessed.
 * - Thousands may be grouped with spaces only (`1 234 567,50`), in groups of
 *   three. A point and a comma in the same number (`1.234,50`, `1,234.50`) or
 *   two of either (`1.234.567`) are refused: which one is the decimal
 *   separator is exactly the ambiguity.
 * - No exponent (`1e5`), no `Infinity`/`NaN`, no leading `+`, no leading or
 *   trailing separator. A minus sign only where the field's domain allows a
 *   negative value.
 * - Empty is not zero. Whether an empty field means "no value" is the field's
 *   decision (`parseOptionalDecimal`, the `optional*` schemas), never a
 *   truthiness test.
 *
 * The rule is identical to `lib/modules/finance/finance.decimal.ts` (the same
 * codes and sentences); that module may re-export this one.
 */

export type DecimalRule = {
  /** The field's label, as the error sentence names it. */
  label: string;
  /** Decimal places accepted. More is refused, never rounded away. */
  scale: number;
  /** Whole-number digits accepted, leading zeros aside: a column's precision minus its scale. */
  maxIntegerDigits: number;
  /** A minus sign is refused unless the domain allows a negative value. */
  allowNegative?: boolean;
  /** Inclusive bounds, as canonical decimal strings ("0.01", "100"). */
  min?: string;
  max?: string;
};

export type DecimalErrorCode =
  | "DECIMAL_REQUIRED"
  | "DECIMAL_MALFORMED"
  | "DECIMAL_AMBIGUOUS_SEPARATOR"
  | "DECIMAL_MIXED_SEPARATORS"
  | "DECIMAL_NEGATIVE"
  | "DECIMAL_TOO_PRECISE"
  | "DECIMAL_TOO_LARGE"
  | "DECIMAL_TOO_SMALL";

export type DecimalParse = { ok: true; value: string } | { ok: false; code: DecimalErrorCode; message: string };

/**
 * The kinds a form field can be, with the precision and bounds of the columns
 * they are stored in (`schema.prisma`): money is `Decimal(18, 2)`; quantities,
 * unit prices and rates `Decimal(18, 4)`; a percentage `Decimal(5, 2)` between
 * 0 and 100. A field whose column differs passes its own rule.
 */
export const DECIMAL_KINDS = {
  money: { scale: 2, maxIntegerDigits: 16 },
  quantity: { scale: 4, maxIntegerDigits: 14 },
  unitPrice: { scale: 4, maxIntegerDigits: 14 },
  percentage: { scale: 2, maxIntegerDigits: 3, min: "0", max: "100" },
  integer: { scale: 0, maxIntegerDigits: 9 },
} as const satisfies Record<string, Omit<DecimalRule, "label">>;

export type DecimalKind = keyof typeof DECIMAL_KINDS;

/** A rule for one field: its kind's precision and bounds, its label, and what the domain adds. */
export function decimalRule(kind: DecimalKind, label: string, overrides: Partial<Omit<DecimalRule, "label">> = {}): DecimalRule {
  return { label, ...DECIMAL_KINDS[kind], ...overrides };
}

/** Space, no-break space and narrow no-break space: the only thousands separators accepted. */
const GROUP_SPACE = /[   ]/;
const GROUP_SPACES = /[   ]/g;
const GROUPED = /^\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?$/;
const AMBIGUOUS_COMMA = /^[1-9]\d{0,2},\d{3}$/;
const PLAIN = /^\d+(?:\.\d+)?$/;
const EXPONENT = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)[eE][+-]?\d+$/;

function example(scale: number): string {
  return scale === 0 ? "1234" : `1234.${"5".padEnd(Math.min(scale, 2), "0")}`;
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

function count(value: string, char: string): number {
  return value.split(char).length - 1;
}

function malformed(rule: DecimalRule, raw: string): DecimalParse {
  return {
    ok: false,
    code: "DECIMAL_MALFORMED",
    message: `${rule.label} "${raw}" is not a number. Use digits and one decimal separator, e.g. ${example(rule.scale)}.`,
  };
}

/**
 * Reads what a person typed into the canonical decimal string the API and the
 * database use, or says precisely why it cannot. Empty input is refused
 * (`DECIMAL_REQUIRED`); use `parseOptionalDecimal` where empty means "none".
 */
export function parseDecimalInput(input: string, rule: DecimalRule): DecimalParse {
  const raw = String(input ?? "").trim();
  if (raw === "") {
    return { ok: false, code: "DECIMAL_REQUIRED", message: `Enter ${article(rule.label)} ${rule.label.toLowerCase()}.` };
  }
  if (EXPONENT.test(raw)) {
    return {
      ok: false,
      code: "DECIMAL_MALFORMED",
      message: `${rule.label} "${raw}" is not a number. Write it in full, without an exponent, e.g. ${example(rule.scale)}.`,
    };
  }

  let body = raw;
  let negative = false;
  if (body.startsWith("-")) {
    negative = true;
    body = body.slice(1);
  }

  if (GROUP_SPACE.test(body)) {
    if (!GROUPED.test(body)) return malformed(rule, raw);
    body = body.replace(GROUP_SPACES, "");
  }

  const points = count(body, ".");
  const commas = count(body, ",");
  if (points > 0 && commas > 0) {
    return {
      ok: false,
      code: "DECIMAL_MIXED_SEPARATORS",
      message: `${rule.label} "${raw}" mixes a point and a comma. Use one decimal separator and no thousands separator, e.g. ${example(rule.scale)}.`,
    };
  }
  if (points > 1 || commas > 1) {
    return {
      ok: false,
      code: "DECIMAL_MIXED_SEPARATORS",
      message: `${rule.label} "${raw}" has more than one separator. Write it without thousands separators, e.g. ${example(rule.scale)}.`,
    };
  }
  if (commas === 1) {
    if (AMBIGUOUS_COMMA.test(body)) {
      const [whole, fraction] = body.split(",");
      return {
        ok: false,
        code: "DECIMAL_AMBIGUOUS_SEPARATOR",
        message: `${rule.label} "${raw}" is ambiguous: write ${whole}${fraction} for ${whole} thousand ${fraction}, or ${whole}.${fraction} for ${whole} point ${fraction}.`,
      };
    }
    body = body.replace(",", ".");
  }

  if (!PLAIN.test(body)) return malformed(rule, raw);

  const [wholeRaw, fraction = ""] = body.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  const isZero = /^0*$/.test(whole) && /^0*$/.test(fraction);

  if (negative && !isZero && !rule.allowNegative) {
    return { ok: false, code: "DECIMAL_NEGATIVE", message: `${rule.label} cannot be negative.` };
  }
  if (fraction.length > rule.scale) {
    return {
      ok: false,
      code: "DECIMAL_TOO_PRECISE",
      message:
        rule.scale === 0
          ? `${rule.label} must be a whole number, e.g. ${example(0)}.`
          : `${rule.label} can have at most ${rule.scale} decimal place${rule.scale === 1 ? "" : "s"}, e.g. ${example(rule.scale)}.`,
    };
  }
  if (whole.length > rule.maxIntegerDigits) {
    return {
      ok: false,
      code: "DECIMAL_TOO_LARGE",
      message: `${rule.label} is too large: at most ${rule.maxIntegerDigits} digits before the decimal point.`,
    };
  }

  // The fraction is kept as typed: "12500.50" stays "12500.50".
  const canonical = `${whole}${fraction ? `.${fraction}` : ""}`;
  const value = negative && !isZero ? `-${canonical}` : canonical;

  if (rule.min !== undefined && compareDecimal(value, rule.min) < 0) {
    return { ok: false, code: "DECIMAL_TOO_SMALL", message: `${rule.label} must be at least ${rule.min}.` };
  }
  if (rule.max !== undefined && compareDecimal(value, rule.max) > 0) {
    return { ok: false, code: "DECIMAL_TOO_LARGE", message: `${rule.label} must be at most ${rule.max}.` };
  }
  return { ok: true, value };
}

/** As `parseDecimalInput`, but an empty input is "no value" (`null`) rather than an error — never zero. */
export function parseOptionalDecimal(input: string | null | undefined, rule: DecimalRule): { ok: true; value: string | null } | Extract<DecimalParse, { ok: false }> {
  if (input === null || input === undefined || String(input).trim() === "") return { ok: true, value: null };
  return parseDecimalInput(String(input), rule);
}

/* -------------------------------------------------------------------------- */
/* Exact comparison of canonical strings                                       */
/* -------------------------------------------------------------------------- */

function scaleOf(value: string): number {
  const fraction = value.split(".")[1];
  return fraction ? fraction.length : 0;
}

function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const digits = `${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`;
  const scaled = BigInt(digits === "" ? "0" : digits);
  return negative ? -scaled : scaled;
}

/** `a` against `b` as exact decimals: -1, 0 or 1. Both must be canonical (`parseDecimalInput`'s output). */
export function compareDecimal(a: string, b: string): number {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const left = toScaled(a, scale);
  const right = toScaled(b, scale);
  return left === right ? 0 : left < right ? -1 : 1;
}
