import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  add,
  clampAtZero,
  percentOf,
  percentageString,
  roundMoney,
  subtract,
  toAmountString,
} from "@/lib/modules/finance/finance.money";

/**
 * Money arithmetic (PRD #15 §30, §31, §206).
 *
 * These tests exist because the whole module rests on one claim: no financial
 * figure ever passes through a JavaScript float. The interesting cases are the
 * ones where a float would visibly be wrong.
 */
describe("decimal arithmetic (PRD #15 §31)", () => {
  it("adds amounts a float would get wrong", () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754.
    expect(toAmountString(add("0.10", "0.20"))).toBe("0.30");
  });

  it("keeps precision across many additions", () => {
    const values = Array.from({ length: 100 }, () => "0.01");
    expect(toAmountString(add(...values))).toBe("1.00");
  });

  it("subtracts without drift", () => {
    expect(toAmountString(subtract("1000.00", "999.99"))).toBe("0.01");
  });

  it("never emits a float artefact in the API representation", () => {
    expect(toAmountString(new Prisma.Decimal("12500.5"))).toBe("12500.50");
    expect(toAmountString("0")).toBe("0.00");
    expect(toAmountString(null)).toBe("0.00");
  });
});

describe("rounding (PRD #15 §206)", () => {
  it("rounds half away from zero at currency precision", () => {
    expect(roundMoney("0.125").toString()).toBe("0.13");
    expect(roundMoney("0.135").toString()).toBe("0.14");
  });

  it("leaves an already-rounded amount alone", () => {
    expect(roundMoney("99.99").toString()).toBe("99.99");
  });
});

describe("percentages (PRD #15 §53)", () => {
  it("computes tax at currency precision", () => {
    expect(percentOf("100.00", "20").toString()).toBe("20");
    expect(percentOf("96000.00", "20").toString()).toBe("19200");
  });

  it("rounds an awkward rate once, not twice", () => {
    // 33.33 % of 10.00 is 3.333, which must become 3.33 exactly once.
    expect(percentOf("10.00", "33.33").toString()).toBe("3.33");
  });

  it("handles a zero rate", () => {
    expect(percentOf("500.00", "0").toString()).toBe("0");
  });
});

describe("clamping (PRD #15 §79)", () => {
  it("never reports a negative outstanding balance", () => {
    // Overpayment is refused at the point of payment, so a negative here would
    // be a bug — and showing zero is better than showing a negative receivable.
    expect(toAmountString(clampAtZero("-25.00"))).toBe("0.00");
    expect(toAmountString(clampAtZero("25.00"))).toBe("25.00");
  });
});

describe("utilisation percentage (PRD #15 §151)", () => {
  it("computes a forecast against a budget", () => {
    expect(percentageString("174600.00", "185000.00")).toBe("94.4");
  });

  it("answers null rather than Infinity when there is no budget", () => {
    // "Utilisation of a budget that does not exist" has no honest number.
    expect(percentageString("1000.00", "0")).toBeNull();
  });

  it("reports over-budget honestly rather than capping at 100", () => {
    expect(percentageString("444400.00", "340000.00")).toBe("130.7");
  });
});
