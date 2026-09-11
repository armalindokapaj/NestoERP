import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  acceptsPayment,
  canTransitionInvoice,
  expenseSettlement,
  invoiceSettlement,
  isInvoiceArchivable,
  isInvoiceEditable,
} from "@/lib/modules/finance/invoices/invoice.status";
import {
  acceptsDisbursement,
  canTransitionExpense,
  countsAsActualCost,
  isExpenseArchivable,
} from "@/lib/modules/finance/expenses/expense.status";
import {
  budgetRisk,
  canTransitionBudget,
  isBudgetArchivable,
  isBudgetOpen,
} from "@/lib/modules/finance/budgets/budget.status";
import {
  canTransitionCommitment,
  countsAsOpenCommitment,
  isCommitmentArchivable,
  isSourced,
} from "@/lib/modules/finance/commitments/commitment.status";

const d = (value: string) => new Prisma.Decimal(value);

/** Finance lifecycle rules (PRD #15 §245–§248). */
describe("invoice transitions (PRD #15 §245)", () => {
  it("walks the ordinary path", () => {
    expect(canTransitionInvoice("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(canTransitionInvoice("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransitionInvoice("APPROVED", "SENT")).toBe(true);
  });

  it("lets a rejected invoice be fixed and resubmitted", () => {
    expect(canTransitionInvoice("REJECTED", "DRAFT")).toBe(true);
    expect(canTransitionInvoice("REJECTED", "PENDING_APPROVAL")).toBe(true);
  });

  it("never skips approval", () => {
    expect(canTransitionInvoice("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionInvoice("DRAFT", "SENT")).toBe(false);
    expect(canTransitionInvoice("PENDING_APPROVAL", "SENT")).toBe(false);
  });

  it("does not reach ARCHIVED through an ordinary transition", () => {
    // Archiving is its own action with its own guard, and restore reads
    // preArchiveStatus rather than picking a status to land on.
    expect(canTransitionInvoice("DRAFT", "ARCHIVED")).toBe(false);
    expect(canTransitionInvoice("CANCELLED", "ARCHIVED")).toBe(false);
    expect(canTransitionInvoice("ARCHIVED", "DRAFT")).toBe(false);
  });

  it("freezes an issued invoice", () => {
    expect(isInvoiceEditable("DRAFT")).toBe(true);
    expect(isInvoiceEditable("REJECTED")).toBe(true);
    expect(isInvoiceEditable("APPROVED")).toBe(false);
    expect(isInvoiceEditable("SENT")).toBe(false);
  });

  it("keeps live financial records out of the archive (PRD #15 §68)", () => {
    expect(isInvoiceArchivable("DRAFT")).toBe(true);
    expect(isInvoiceArchivable("CANCELLED")).toBe(true);
    // Money somebody owes stays visible.
    expect(isInvoiceArchivable("APPROVED")).toBe(false);
    expect(isInvoiceArchivable("SENT")).toBe(false);
  });

  it("accepts payment only once sent (PRD #15 §66)", () => {
    expect(acceptsPayment("SENT")).toBe(true);
    for (const status of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "CANCELLED"] as const) {
      expect(acceptsPayment(status)).toBe(false);
    }
  });
});

describe("invoice settlement (PRD #15 §42, §44, §45)", () => {
  const future = new Date("2026-12-31T12:00:00.000Z");
  const past = new Date("2026-01-01T12:00:00.000Z");
  const now = new Date("2026-06-01T12:00:00.000Z");

  it("is UNPAID when nothing has been received", () => {
    expect(
      invoiceSettlement({ status: "SENT", paid: d("0"), outstanding: d("100"), dueDate: future, now }),
    ).toBe("UNPAID");
  });

  it("is PARTIALLY_PAID when something has", () => {
    expect(
      invoiceSettlement({ status: "SENT", paid: d("40"), outstanding: d("60"), dueDate: future, now }),
    ).toBe("PARTIALLY_PAID");
  });

  it("is PAID when nothing is outstanding, whatever the workflow status", () => {
    // A fully paid invoice stays SENT: issuance and settlement are two facts.
    expect(
      invoiceSettlement({ status: "SENT", paid: d("100"), outstanding: d("0"), dueDate: past, now }),
    ).toBe("PAID");
  });

  it("is OVERDUE only for a sent invoice past its due date", () => {
    expect(
      invoiceSettlement({ status: "SENT", paid: d("0"), outstanding: d("100"), dueDate: past, now }),
    ).toBe("OVERDUE");

    // A draft with a past due date is a drafting mistake, not a debt.
    expect(
      invoiceSettlement({ status: "DRAFT", paid: d("0"), outstanding: d("100"), dueDate: past, now }),
    ).toBe("UNPAID");
  });

  it("prefers PAID over OVERDUE when the money arrived late", () => {
    expect(
      invoiceSettlement({ status: "SENT", paid: d("100"), outstanding: d("0"), dueDate: past, now }),
    ).toBe("PAID");
  });
});

describe("expense settlement (PRD #15 §91)", () => {
  it("has no overdue state", () => {
    expect(expenseSettlement({ paid: d("0"), outstanding: d("50") })).toBe("UNPAID");
    expect(expenseSettlement({ paid: d("20"), outstanding: d("30") })).toBe("PARTIALLY_PAID");
    expect(expenseSettlement({ paid: d("50"), outstanding: d("0") })).toBe("PAID");
  });
});

describe("expense transitions (PRD #15 §246)", () => {
  it("recognises cost at approval, not payment (PRD #15 §118)", () => {
    expect(countsAsActualCost("APPROVED")).toBe(true);
    expect(countsAsActualCost("PENDING_APPROVAL")).toBe(false);
    expect(countsAsActualCost("CANCELLED")).toBe(false);
  });

  it("pays out only an approved expense (PRD #15 §100)", () => {
    expect(acceptsDisbursement("APPROVED")).toBe(true);
    expect(acceptsDisbursement("DRAFT")).toBe(false);
  });

  it("keeps approved cost visible (PRD #15 §102)", () => {
    // Budget vs actual is calculated from approved expenses, so hiding one
    // would silently move every variance figure that depends on it.
    expect(isExpenseArchivable("APPROVED")).toBe(false);
    expect(isExpenseArchivable("CANCELLED")).toBe(true);
  });

  it("never skips approval", () => {
    expect(canTransitionExpense("DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionExpense("PENDING_APPROVAL", "APPROVED")).toBe(true);
  });
});

describe("budget transitions (PRD #15 §247)", () => {
  it("gives an approved budget no outgoing transition at all", () => {
    // The only way forward is a revision, which is a new version.
    expect(canTransitionBudget("APPROVED", "DRAFT")).toBe(false);
    expect(canTransitionBudget("APPROVED", "PENDING_APPROVAL")).toBe(false);
    expect(canTransitionBudget("APPROVED", "REJECTED")).toBe(false);
  });

  it("counts draft and pending as the one open version (PRD #15 §110)", () => {
    expect(isBudgetOpen("DRAFT")).toBe(true);
    expect(isBudgetOpen("PENDING_APPROVAL")).toBe(true);
    expect(isBudgetOpen("APPROVED")).toBe(false);
  });

  it("never archives the current budget (PRD #15 §116)", () => {
    // It is the denominator of every variance figure on the project.
    expect(isBudgetArchivable({ status: "DRAFT", isCurrent: false })).toBe(true);
    expect(isBudgetArchivable({ status: "APPROVED", isCurrent: true })).toBe(false);
    expect(isBudgetArchivable({ status: "DRAFT", isCurrent: true })).toBe(false);
  });
});

describe("budget risk (PRD #15 §123)", () => {
  it("bands the forecast", () => {
    expect(budgetRisk(76.9)).toBe("GREEN");
    expect(budgetRisk(90)).toBe("GREEN");
    expect(budgetRisk(94.4)).toBe("WARNING");
    expect(budgetRisk(100)).toBe("WARNING");
    expect(budgetRisk(130.7)).toBe("CRITICAL");
  });

  it("has no band without a budget to measure against", () => {
    expect(budgetRisk(null)).toBeNull();
  });
});

describe("commitment transitions (PRD #15 §248)", () => {
  it("closes an approved commitment so it stops counting (PRD #15 §134)", () => {
    expect(canTransitionCommitment("APPROVED", "CLOSED")).toBe(true);
    expect(countsAsOpenCommitment("APPROVED")).toBe(true);
    expect(countsAsOpenCommitment("CLOSED")).toBe(false);
    expect(countsAsOpenCommitment("CANCELLED")).toBe(false);
  });

  it("keeps a live approved commitment out of the archive (PRD #15 §136)", () => {
    expect(isCommitmentArchivable("APPROVED")).toBe(false);
    expect(isCommitmentArchivable("CLOSED")).toBe(true);
    expect(isCommitmentArchivable("CANCELLED")).toBe(true);
  });

  it("recognises a commitment another module owns (PRD #15 §128)", () => {
    expect(isSourced({ sourceModule: "procurement" })).toBe(true);
    expect(isSourced({ sourceModule: null })).toBe(false);
  });
});
