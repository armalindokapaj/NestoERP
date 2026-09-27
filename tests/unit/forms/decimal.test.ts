import { describe, expect, it } from "vitest";

import { compareDecimal, decimalRule, parseDecimalInput, parseOptionalDecimal, type DecimalRule } from "@/lib/forms/decimal";
import { decimalText, optionalDecimalText } from "@/lib/modules/shared/fields";

/**
 * FV-06: one reading of a typed number (AUD-09 §4). The expectations are the
 * locale rule as written in `lib/forms/decimal.ts`, stated independently here
 * — the parser's own output is never the oracle.
 */

const money = decimalRule("money", "Amount");
const quantity = decimalRule("quantity", "Quantity");
const percent = decimalRule("percentage", "Discount");
const signedMoney: DecimalRule = { ...money, allowNegative: true, label: "Adjustment" };

function value(input: string, rule: DecimalRule = money) {
  const parsed = parseDecimalInput(input, rule);
  return parsed.ok ? parsed.value : parsed.code;
}

describe("canonical values", () => {
  it("keeps plain decimals exactly as typed, trimmed of spaces and leading zeros", () => {
    expect(value("1234.5")).toBe("1234.5");
    expect(value("12500.50")).toBe("12500.50");
    expect(value("  7 ")).toBe("7");
    expect(value("007.10")).toBe("7.10");
    expect(value("0")).toBe("0");
    expect(value("0.00")).toBe("0.00");
  });

  it("reads a decimal comma when it cannot be a thousands separator", () => {
    expect(value("12,5")).toBe("12.5");
    expect(value("1234,56")).toBe("1234.56");
    expect(value("0,75")).toBe("0.75");
    // Four digits after the comma cannot be a group of three: a decimal comma (and too precise for money).
    expect(value("1,2345", quantity)).toBe("1.2345");
  });

  it("accepts thousands grouped with spaces (and no-break spaces) in threes", () => {
    expect(value("1 234 567,50")).toBe("1234567.50");
    expect(value("1 234.5")).toBe("1234.5");
    expect(value("12 345")).toBe("12345");
  });
});

describe("refusals, each with its own code and an example", () => {
  it("refuses 1,234 as ambiguous between en and sq, offering both spellings", () => {
    const parsed = parseDecimalInput("1,234", money);
    expect(parsed).toMatchObject({ ok: false, code: "DECIMAL_AMBIGUOUS_SEPARATOR" });
    expect(!parsed.ok && parsed.message).toContain("1234");
    expect(!parsed.ok && parsed.message).toContain("1.234");
    expect(value("12,345")).toBe("DECIMAL_AMBIGUOUS_SEPARATOR");
    expect(value("999,000")).toBe("DECIMAL_AMBIGUOUS_SEPARATOR");
    // A zero whole part is not a thousands group: 0,125 is a decimal.
    expect(value("0,125", quantity)).toBe("0.125");
  });

  it("refuses mixed or repeated separators rather than guessing which is the decimal", () => {
    expect(value("1,234.56")).toBe("DECIMAL_MIXED_SEPARATORS");
    expect(value("1.234,56")).toBe("DECIMAL_MIXED_SEPARATORS");
    expect(value("1.234.567")).toBe("DECIMAL_MIXED_SEPARATORS");
    expect(value("1,234,567")).toBe("DECIMAL_MIXED_SEPARATORS");
  });

  it("refuses NaN, Infinity, exponents, a plus sign, letters and stray separators", () => {
    for (const input of ["NaN", "Infinity", "-Infinity", "1e5", "1E5", "2.5e-3", "+5", "12abc", "5.", ".5", "1 23", "--1", "0x10"]) {
      expect(value(input), input).toBe("DECIMAL_MALFORMED");
    }
    // Two separators of one kind are the thousands ambiguity again.
    for (const input of ["1..2", ".5.", ",5,"]) expect(value(input), input).toBe("DECIMAL_MIXED_SEPARATORS");
    const exponent = parseDecimalInput("1e5", money);
    expect(!exponent.ok && exponent.message).toMatch(/without an exponent/);
  });

  it("never reads empty as zero", () => {
    expect(value("")).toBe("DECIMAL_REQUIRED");
    expect(value("   ")).toBe("DECIMAL_REQUIRED");
    expect(parseOptionalDecimal("", money)).toEqual({ ok: true, value: null });
    expect(parseOptionalDecimal(null, money)).toEqual({ ok: true, value: null });
    expect(parseOptionalDecimal(undefined, money)).toEqual({ ok: true, value: null });
    // Zero typed is zero.
    expect(parseOptionalDecimal("0", money)).toEqual({ ok: true, value: "0" });
  });

  it("refuses a negative unless the domain allows one; minus zero is zero", () => {
    expect(value("-5")).toBe("DECIMAL_NEGATIVE");
    expect(value("-5", signedMoney)).toBe("-5");
    expect(value("-0")).toBe("0");
    expect(value("-0.00")).toBe("0.00");
  });

  it("refuses more decimals than the kind carries instead of rounding them away", () => {
    expect(value("10.005")).toBe("DECIMAL_TOO_PRECISE");
    expect(value("10.0050", quantity)).toBe("10.0050");
    expect(value("10.00501", quantity)).toBe("DECIMAL_TOO_PRECISE");
    expect(value("1.5", decimalRule("integer", "Days"))).toBe("DECIMAL_TOO_PRECISE");
    expect(value("12.345", percent)).toBe("DECIMAL_TOO_PRECISE");
  });

  it("refuses a value its column cannot hold (overflow is a field error, not a 500)", () => {
    // Decimal(18, 2): sixteen whole digits.
    expect(value("9999999999999999.99")).toBe("9999999999999999.99");
    expect(value("10000000000000000")).toBe("DECIMAL_TOO_LARGE");
    // Decimal(18, 4): fourteen.
    expect(value("99999999999999", quantity)).toBe("99999999999999");
    expect(value("100000000000000", quantity)).toBe("DECIMAL_TOO_LARGE");
  });

  it("applies a kind's bounds exactly: a percentage is 0 to 100", () => {
    expect(value("100", percent)).toBe("100");
    expect(value("100.00", percent)).toBe("100.00");
    expect(value("100.01", percent)).toBe("DECIMAL_TOO_LARGE");
    expect(value("0", percent)).toBe("0");
    expect(value("-0.01", { ...percent, allowNegative: true })).toBe("DECIMAL_TOO_SMALL");
    expect(value("0.00", decimalRule("money", "Price", { min: "0.01" }))).toBe("DECIMAL_TOO_SMALL");
    expect(value("0.01", decimalRule("money", "Price", { min: "0.01" }))).toBe("0.01");
  });
});

describe("exact comparison", () => {
  it("compares canonical strings without floating point", () => {
    expect(compareDecimal("0.3", "0.30")).toBe(0);
    expect(compareDecimal("0.1", "0.3")).toBe(-1);
    expect(compareDecimal("9999999999999999.99", "9999999999999999.98")).toBe(1);
    expect(compareDecimal("-1", "0")).toBe(-1);
    expect(compareDecimal("-1.5", "-1.25")).toBe(-1);
  });
});

describe("the server schemas run the same rule (FV-04, FV-06)", () => {
  it("decimalText accepts what the client accepts and refuses what it refuses, with the same sentence", () => {
    const schema = decimalText(money);
    expect(schema.parse("1234,56")).toBe("1234.56");
    expect(schema.parse(12.5)).toBe("12.5");
    for (const input of ["1,234", "1e5", "NaN", "Infinity", "", "10.005"]) {
      const result = schema.safeParse(input);
      expect(result.success, input).toBe(false);
      const client = parseDecimalInput(input, money);
      expect(!client.ok && result.error?.issues[0]?.message).toBe(!client.ok ? client.message : null);
    }
    // A JSON NaN or Infinity is refused too — never serialised into a null.
    expect(schema.safeParse(Number.NaN).success).toBe(false);
    expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(schema.safeParse(1e21).success).toBe(false);
  });

  it("optionalDecimalText reads empty, null and absent as no value — never zero", () => {
    const schema = optionalDecimalText(money);
    expect(schema.parse("")).toBeUndefined();
    expect(schema.parse(null)).toBeUndefined();
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse("0")).toBe("0");
    expect(schema.safeParse("1,234").success).toBe(false);
  });
});
