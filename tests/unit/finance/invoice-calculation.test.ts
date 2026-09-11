import { describe, expect, it } from "vitest";

import {
  calculateBudgetTotal,
  calculateExpenseTotal,
  calculateInvoice,
  calculateLine,
} from "@/lib/modules/finance/invoices/invoice.calculation";
import { toAmountString } from "@/lib/modules/finance/finance.money";

/** Invoice arithmetic (PRD #15 §53, §54, §206, §342). */
describe("line totals (PRD #15 §53)", () => {
  it("computes subtotal, tax and total from quantity and price", () => {
    const line = calculateLine(
      { description: "Site supervision", quantity: "160", unitPrice: "65", taxRate: "20" },
      0,
    );

    expect(toAmountString(line.subtotal)).toBe("10400.00");
    expect(toAmountString(line.taxAmount)).toBe("2080.00");
    expect(toAmountString(line.totalAmount)).toBe("12480.00");
  });

  it("handles a fractional quantity", () => {
    const line = calculateLine(
      { description: "Consultancy", quantity: "7.5", unitPrice: "120.50", taxRate: "0" },
      0,
    );

    expect(toAmountString(line.subtotal)).toBe("903.75");
    expect(toAmountString(line.totalAmount)).toBe("903.75");
  });

  it("handles a zero unit price without producing NaN", () => {
    const line = calculateLine(
      { description: "Goodwill credit line", quantity: "1", unitPrice: "0", taxRate: "20" },
      0,
    );

    expect(toAmountString(line.totalAmount)).toBe("0.00");
  });
});

describe("invoice totals (PRD #15 §54, §206)", () => {
  it("sums already-rounded lines, so the lines add up to the total", () => {
    // Each line rounds to the cent first; the invoice total is the sum of
    // those. Summing unrounded lines and rounding once would give a total the
    // lines do not add up to, which is what a client notices.
    const result = calculateInvoice([
      { description: "A", quantity: "3", unitPrice: "0.335", taxRate: "0" },
      { description: "B", quantity: "3", unitPrice: "0.335", taxRate: "0" },
    ]);

    expect(toAmountString(result.lines[0].subtotal)).toBe("1.01");
    expect(toAmountString(result.subtotal)).toBe("2.02");
    expect(
      toAmountString(result.lines[0].subtotal.plus(result.lines[1].subtotal)),
    ).toBe(toAmountString(result.subtotal));
  });

  it("splits subtotal and tax across mixed rates", () => {
    const result = calculateInvoice([
      { description: "Standard", quantity: "1", unitPrice: "1000", taxRate: "20" },
      { description: "Zero-rated", quantity: "1", unitPrice: "500", taxRate: "0" },
    ]);

    expect(toAmountString(result.subtotal)).toBe("1500.00");
    expect(toAmountString(result.taxAmount)).toBe("200.00");
    expect(toAmountString(result.totalAmount)).toBe("1700.00");
  });

  it("assigns a stable sort order", () => {
    const result = calculateInvoice([
      { description: "First", quantity: "1", unitPrice: "1", taxRate: "0" },
      { description: "Second", quantity: "1", unitPrice: "1", taxRate: "0" },
    ]);

    expect(result.lines.map((line) => line.sortOrder)).toEqual([0, 1]);
  });
});

describe("expense totals (PRD #15 §92)", () => {
  it("adds net and tax", () => {
    const totals = calculateExpenseTotal("145000", "29000");
    expect(toAmountString(totals.totalAmount)).toBe("174000.00");
  });

  it("accepts a zero tax amount", () => {
    const totals = calculateExpenseTotal("18400", "0");
    expect(toAmountString(totals.totalAmount)).toBe("18400.00");
  });
});

describe("budget totals (PRD #15 §107)", () => {
  it("sums the planned amounts", () => {
    const total = calculateBudgetTotal([
      { plannedAmount: "200000" },
      { plannedAmount: "120000" },
      { plannedAmount: "80000.50" },
    ]);

    expect(toAmountString(total)).toBe("400000.50");
  });

  it("is zero for no lines, rather than NaN", () => {
    expect(toAmountString(calculateBudgetTotal([]))).toBe("0.00");
  });
});
