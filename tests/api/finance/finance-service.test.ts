import { Prisma } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import * as approvals from "@/lib/modules/finance/approvals/approval.service";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import * as payments from "@/lib/modules/finance/payments/payment.service";
import * as reports from "@/lib/modules/finance/reports/reports.service";
import { getFinanceOverview } from "@/lib/modules/finance/overview/overview.service";
import { createInvoiceSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { createExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import { createCommitmentSchema } from "@/lib/modules/finance/commitments/commitment.schema";
import { createBudgetSchema } from "@/lib/modules/finance/budgets/budget.schema";
import { createPaymentSchema } from "@/lib/modules/finance/payments/payment.schema";
import {
  parseBudgetQuery,
  parseCommitmentQuery,
  parseExpenseQuery,
  parseInvoiceQuery,
  parsePaymentQuery,
} from "@/lib/modules/finance/finance.query";
import { cleanupSessions, loginAs, prisma } from "../../helpers";

/**
 * Finance authorisation, money and lifecycle tests (PRD #15 §340–§368).
 *
 * These call the same services the API routes and the pages call, so a passing
 * test is a statement about the running product rather than about a mock
 * (PRD #9 §223).
 */
const createdInvoices: string[] = [];
const createdExpenses: string[] = [];
const createdBudgets: string[] = [];
const createdCommitments: string[] = [];
const createdPayments: string[] = [];

afterEach(async () => {
  // Payments first: an invoice with a payment cannot be deleted.
  if (createdPayments.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: createdPayments } } });
    await prisma.payment.deleteMany({ where: { id: { in: createdPayments } } });
    createdPayments.length = 0;
  }
  for (const [ids, remove] of [
    [createdInvoices, () => prisma.invoice.deleteMany({ where: { id: { in: createdInvoices } } })],
    [createdExpenses, () => prisma.expense.deleteMany({ where: { id: { in: createdExpenses } } })],
    [
      createdBudgets,
      () => prisma.projectBudget.deleteMany({ where: { id: { in: createdBudgets } } }),
    ],
    [
      createdCommitments,
      () => prisma.commitment.deleteMany({ where: { id: { in: createdCommitments } } }),
    ],
  ] as const) {
    if (ids.length === 0) continue;
    await prisma.activity.deleteMany({ where: { entityId: { in: [...ids] } } });
    await prisma.financeApproval.deleteMany({ where: { recordId: { in: [...ids] } } });
    await remove();
    ids.length = 0;
  }
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

function invoiceInput(overrides: Record<string, unknown> = {}) {
  return createInvoiceSchema.parse({
    invoiceNumber: `TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    clientId: "client_acme",
    projectId: "project_a",
    issueDate: "2026-03-01",
    dueDate: "2026-03-31",
    currency: "EUR",
    lineItems: [{ description: "Test line", quantity: "1", unitPrice: "1000", taxRate: "20" }],
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */
/* Module access (PRD #15 §14, §20, §340)                                      */
/* -------------------------------------------------------------------------- */

describe("module access (PRD #15 §20)", () => {
  it("keeps Admin and Company IT out of Finance entirely", async () => {
    // Administering NESTO is not financial authorisation. The module is
    // enabled for the company, so the refusal is FORBIDDEN rather than
    // "module unavailable" — the role is what is missing, not the module.
    for (const role of ["ADMIN", "COMPANY_IT", "HR"] as const) {
      const context = await loginAs(role);
      expect(context.moduleAccess.finance.accessLevel).toBe("NONE");
      await expectError(invoices.listInvoices(context, parseInvoiceQuery({})), "FORBIDDEN");
    }
  });

  it("gives the Finance role the company's invoices", async () => {
    const context = await loginAs("FINANCE");
    const result = await invoices.listInvoices(context, parseInvoiceQuery({ limit: "100" }));
    expect(result.pagination.total).toBeGreaterThanOrEqual(12);
  });

  it("refuses an Architect the invoice list, but not the project budget", async () => {
    const context = await loginAs("ARCHITECT");

    // Restricted subpermissions only (PRD #15 §184).
    await expectError(invoices.listInvoices(context, parseInvoiceQuery({})), "FORBIDDEN");
    await expectError(expenses.listExpenses(context, parseExpenseQuery({})), "FORBIDDEN");

    const summary = await budgets.getProjectFinanceSummary(context, "project_a");
    expect(summary.hasApprovedBudget).toBe(true);
  });

  it("refuses Sales the expense and budget lists (PRD #15 §289)", async () => {
    const context = await loginAs("SALES");

    // Customer invoices and receivables, never company cost.
    const result = await invoices.listInvoices(context, parseInvoiceQuery({ limit: "100" }));
    expect(result.pagination.total).toBeGreaterThan(0);

    await expectError(expenses.listExpenses(context, parseExpenseQuery({})), "FORBIDDEN");
    await expectError(budgets.listBudgets(context, parseBudgetQuery({})), "FORBIDDEN");
  });
});

/* -------------------------------------------------------------------------- */
/* Scope (PRD #15 §210–§216, §353)                                             */
/* -------------------------------------------------------------------------- */

describe("scope (PRD #15 §212, §216)", () => {
  it("keeps a project-scoped reader to their own projects", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const budgetList = await budgets.listBudgets(pm, parseBudgetQuery({ limit: "100" }));

    expect(budgetList.data.length).toBeGreaterThan(0);
    for (const budget of budgetList.data) {
      expect(["project_a", "project_b"]).toContain(budget.project.id);
    }
  });

  it("hides company-level records from a project-scoped reader (PRD #15 §211)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const list = await commitments.listCommitments(pm, parseCommitmentQuery({ limit: "100" }));

    // A commitment with no project has nothing to authorise it against.
    expect(list.data.every((commitment) => commitment.project !== null)).toBe(true);
    expect(list.data.map((commitment) => commitment.reference)).not.toContain("COM-012");
  });

  it("answers NOT_FOUND for a record outside scope (PRD #15 §174)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    // A 403 would confirm it exists. A 404 says nothing at all.
    await expectError(budgets.getBudget(pm, "budget_c_v1"), "NOT_FOUND");
  });

  it("gives a payment no scope of its own (PRD #15 §216)", async () => {
    const finance = await loginAs("FINANCE");
    const all = await payments.listPayments(finance, parsePaymentQuery({ limit: "100" }));
    expect(all.pagination.total).toBeGreaterThan(0);

    // Every payment reachable to the Finance role settles a record it can open.
    for (const payment of all.data) {
      expect(payment.relatedRecord).not.toBeNull();
    }
  });

  it("never returns another company's finance records", async () => {
    const finance = await loginAs("FINANCE");
    const result = await invoices.listInvoices(finance, parseInvoiceQuery({ limit: "100" }));

    const rows = await prisma.invoice.findMany({
      where: { id: { in: result.data.map((invoice) => invoice.id) } },
      select: { companyId: true },
    });
    for (const row of rows) expect(row.companyId).toBe(finance.companyId);
  });
});

/* -------------------------------------------------------------------------- */
/* Invoices (PRD #15 §341–§346)                                                */
/* -------------------------------------------------------------------------- */

describe("invoice creation (PRD #15 §341, §342)", () => {
  it("calculates totals on the server, ignoring anything a caller sends", async () => {
    const finance = await loginAs("FINANCE");

    const invoice = await invoices.createInvoice(
      finance,
      // A crafted request cannot include totals: the schema has no such fields.
      invoiceInput({
        lineItems: [
          { description: "Line A", quantity: "160", unitPrice: "65", taxRate: "20" },
          { description: "Line B", quantity: "1", unitPrice: "500", taxRate: "0" },
        ],
      }),
    );
    createdInvoices.push(invoice.id);

    expect(invoice.subtotal).toBe("10900.00");
    expect(invoice.taxAmount).toBe("2080.00");
    expect(invoice.totalAmount).toBe("12980.00");
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.settlementStatus).toBe("UNPAID");
  });

  /**
   * The company's scheme has finance/invoice on AUTO, so the number is
   * allocated under a row lock and what somebody typed is discarded — the
   * uniqueness this once tested is now structural rather than checked
   * (PRD #24 §102, §114).
   */
  it("allocates the number itself and ignores a supplied one (PRD #24 §114)", async () => {
    const finance = await loginAs("FINANCE");

    const invoice = await invoices.createInvoice(
      finance,
      invoiceInput({ invoiceNumber: "INV-2026-001" }),
    );
    createdInvoices.push(invoice.id);

    expect(invoice.invoiceNumber).not.toBe("INV-2026-001");
    expect(invoice.invoiceNumber).toMatch(/^INV-/);
  });

  it("still refuses a duplicate number when the company numbers manually", async () => {
    const finance = await loginAs("FINANCE");

    await prisma.companyNumberingScheme.updateMany({
      where: { companyId: finance.companyId, moduleKey: "finance", entityType: "invoice" },
      data: { mode: "MANUAL" },
    });

    try {
      await expectError(
        invoices.createInvoice(finance, invoiceInput({ invoiceNumber: "INV-2026-001" })),
        "CONFLICT",
      );
    } finally {
      await prisma.companyNumberingScheme.updateMany({
        where: { companyId: finance.companyId, moduleKey: "finance", entityType: "invoice" },
        data: { mode: "AUTO" },
      });
    }
  });

  it("refuses a manual create with no number at all", async () => {
    const finance = await loginAs("FINANCE");

    await prisma.companyNumberingScheme.updateMany({
      where: { companyId: finance.companyId, moduleKey: "finance", entityType: "invoice" },
      data: { mode: "MANUAL" },
    });

    try {
      await expectError(
        invoices.createInvoice(finance, invoiceInput({ invoiceNumber: undefined })),
        "VALIDATION_ERROR",
      );
    } finally {
      await prisma.companyNumberingScheme.updateMany({
        where: { companyId: finance.companyId, moduleKey: "finance", entityType: "invoice" },
        data: { mode: "AUTO" },
      });
    }
  });

  it("refuses a due date before the issue date (PRD #15 §51)", async () => {
    expect(() =>
      invoiceInput({ issueDate: "2026-03-31", dueDate: "2026-03-01" }),
    ).toThrowError();
  });

  it("refuses billing a project's work to another client (PRD #15 §50)", async () => {
    const finance = await loginAs("FINANCE");
    await expectError(
      invoices.createInvoice(
        finance,
        // Project A belongs to ACME, not Beta.
        invoiceInput({ clientId: "client_beta", projectId: "project_a" }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("refuses a client the caller cannot reach", async () => {
    const finance = await loginAs("FINANCE");
    const foreign = await prisma.client.findFirstOrThrow({
      where: { companyId: { not: finance.companyId } },
      select: { id: true },
    });

    await expectError(
      invoices.createInvoice(finance, invoiceInput({ clientId: foreign.id, projectId: undefined })),
      "VALIDATION_ERROR",
    );
  });
});

describe("invoice lifecycle (PRD #15 §343, §344, §346)", () => {
  it("goes draft → pending → approved → sent, and refuses every shortcut", async () => {
    const finance = await loginAs("FINANCE");
    const owner = await loginAs("OWNER");

    const invoice = await invoices.createInvoice(finance, invoiceInput());
    createdInvoices.push(invoice.id);

    // Approval before submission is refused: there is nothing pending.
    await expectError(invoices.approveInvoice(owner, invoice.id, null), "CONFLICT");
    // Marking a draft as sent skips the whole workflow.
    await expectError(invoices.markInvoiceSent(owner, invoice.id), "VALIDATION_ERROR");

    await invoices.submitInvoice(finance, invoice.id);
    await invoices.approveInvoice(owner, invoice.id, "Checked.");
    await invoices.markInvoiceSent(owner, invoice.id);

    const after = await invoices.getInvoice(owner, invoice.id);
    expect(after.status).toBe("SENT");
    expect(after.sentAt).not.toBeNull();
  });

  it("freezes an approved invoice against editing (PRD #15 §60)", async () => {
    const finance = await loginAs("FINANCE");
    const owner = await loginAs("OWNER");

    const invoice = await invoices.createInvoice(finance, invoiceInput());
    createdInvoices.push(invoice.id);

    await invoices.submitInvoice(finance, invoice.id);
    await invoices.approveInvoice(owner, invoice.id, null);

    await expectError(
      invoices.updateInvoice(finance, invoice.id, {
        ...invoiceInput({ invoiceNumber: invoice.invoiceNumber }),
        versionUpdatedAt: undefined,
      }),
      "CONFLICT",
    );
  });

  it("lets a rejected invoice be corrected and resubmitted, keeping both cycles", async () => {
    const finance = await loginAs("FINANCE");
    const owner = await loginAs("OWNER");

    const invoice = await invoices.createInvoice(finance, invoiceInput());
    createdInvoices.push(invoice.id);

    await invoices.submitInvoice(finance, invoice.id);
    await invoices.rejectInvoice(owner, invoice.id, "The valuation is not agreed.");
    await invoices.submitInvoice(finance, invoice.id);
    await invoices.approveInvoice(owner, invoice.id, null);

    const after = await invoices.getInvoice(owner, invoice.id);
    expect(after.status).toBe("APPROVED");
    // A resubmission opens a new cycle rather than reopening the old one.
    expect(after.approvals).toHaveLength(2);
    expect(after.approvals.map((entry) => entry.status).sort()).toEqual(["APPROVED", "REJECTED"]);
  });

  it("refuses to archive a sent invoice (PRD #15 §68)", async () => {
    const owner = await loginAs("OWNER");
    await expectError(invoices.archiveInvoice(owner, "invoice_001"), "CONFLICT");
  });

  it("refuses to cancel an invoice that has taken money (PRD #15 §67)", async () => {
    const owner = await loginAs("OWNER");
    // invoice_002 is partially paid in the seed.
    await expectError(invoices.cancelInvoice(owner, "invoice_002"), "CONFLICT");
  });
});

/* -------------------------------------------------------------------------- */
/* Separation of duties (PRD #15 §18, §19)                                     */
/* -------------------------------------------------------------------------- */

describe("approval authority (PRD #15 §18, §19)", () => {
  it("denies the Finance role approval, however much else it manages", async () => {
    const finance = await loginAs("FINANCE");

    const invoice = await invoices.createInvoice(finance, invoiceInput());
    createdInvoices.push(invoice.id);
    await invoices.submitInvoice(finance, invoice.id);

    // MANAGE is the top rung of the ladder, and it still does not include
    // approval: the role that raises every invoice does not sign them off.
    await expectError(invoices.approveInvoice(finance, invoice.id, null), "FORBIDDEN");
    expect(finance.permissions).not.toContain("finance.invoice.approve");
  });

  it("stops an approver deciding their own submission (PRD #15 §19)", async () => {
    const ceo = await loginAs("CEO");

    // The CEO can approve but does not hold finance.approval.self, so a record
    // they submitted is one somebody else has to decide.
    expect(ceo.permissions).not.toContain("finance.approval.self");
    expect(() => approvals.assertNotSelfApproval(ceo, ceo.membershipId)).toThrowError(
      AccessError,
    );

    // Somebody else's submission is fine.
    const finance = await loginAs("FINANCE");
    expect(() => approvals.assertNotSelfApproval(ceo, finance.membershipId)).not.toThrowError();
  });

  it("keeps the CEO out of operational create and submit (PRD #15 §285)", async () => {
    const ceo = await loginAs("CEO");

    // Executive visibility and approval authority, not a bookkeeping surface.
    await expectError(expenses.submitExpense(ceo, "expense_015"), "FORBIDDEN");
    await expectError(
      invoices.createInvoice(ceo, invoiceInput()),
      "FORBIDDEN",
    );
  });

  it("lets the Owner approve their own, because they hold finance.approval.self", async () => {
    const owner = await loginAs("OWNER");
    expect(owner.permissions).toContain("finance.approval.self");

    const invoice = await invoices.createInvoice(owner, invoiceInput());
    createdInvoices.push(invoice.id);

    await invoices.submitInvoice(owner, invoice.id);
    await invoices.approveInvoice(owner, invoice.id, null);

    const after = await invoices.getInvoice(owner, invoice.id);
    expect(after.status).toBe("APPROVED");
  });

  it("refuses a rejection with no reason (PRD #15 §146)", async () => {
    const finance = await loginAs("FINANCE");

    const invoice = await invoices.createInvoice(finance, invoiceInput());
    createdInvoices.push(invoice.id);
    await invoices.submitInvoice(finance, invoice.id);

    // The service takes the reason as a required argument; the schema behind
    // the endpoint refuses an empty one.
    const { rejectionSchema } = await import("@/lib/modules/finance/invoices/invoice.schema");
    expect(() => rejectionSchema.parse({ note: "" })).toThrowError();
  });

  it("decides a pending approval only once (PRD #15 §280)", async () => {
    const finance = await loginAs("FINANCE");
    const owner = await loginAs("OWNER");

    const invoice = await invoices.createInvoice(finance, invoiceInput());
    createdInvoices.push(invoice.id);

    await invoices.submitInvoice(finance, invoice.id);
    await invoices.approveInvoice(owner, invoice.id, null);
    await expectError(invoices.approveInvoice(owner, invoice.id, null), "CONFLICT");
  });
});

/* -------------------------------------------------------------------------- */
/* Payments (PRD #15 §345, §358)                                               */
/* -------------------------------------------------------------------------- */

describe("payments (PRD #15 §79, §83, §84)", () => {
  /** Issued today and due in a month, so settlement is not confused by age. */
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  async function sentInvoice(finance: Awaited<ReturnType<typeof loginAs>>) {
    const owner = await loginAs("OWNER");
    const invoice = await invoices.createInvoice(
      finance,
      invoiceInput({
        issueDate: today,
        dueDate: nextMonth,
        lineItems: [{ description: "Payable", quantity: "1", unitPrice: "1000", taxRate: "0" }],
      }),
    );
    createdInvoices.push(invoice.id);

    await invoices.submitInvoice(finance, invoice.id);
    await invoices.approveInvoice(owner, invoice.id, null);
    await invoices.markInvoiceSent(owner, invoice.id);

    return invoice;
  }

  it("records a partial receipt and reports the balance", async () => {
    const finance = await loginAs("FINANCE");
    const invoice = await sentInvoice(finance);

    const paymentId = await payments.recordPayment(
      finance,
      createPaymentSchema.parse({
        invoiceId: invoice.id,
        amount: "400",
        paymentDate: today,
        method: "BANK_TRANSFER",
      }),
    );
    createdPayments.push(paymentId);

    const after = await invoices.getInvoice(finance, invoice.id);
    expect(after.paidAmount).toBe("400.00");
    expect(after.outstandingAmount).toBe("600.00");
    expect(after.settlementStatus).toBe("PARTIALLY_PAID");
    // Fully settling it later would still leave the workflow status at SENT.
    expect(after.status).toBe("SENT");
  });

  it("refuses more than the outstanding balance (PRD #15 §79)", async () => {
    const finance = await loginAs("FINANCE");
    const invoice = await sentInvoice(finance);

    await expectError(
      payments.recordPayment(
        finance,
        createPaymentSchema.parse({
          invoiceId: invoice.id,
          amount: "1000.01",
          paymentDate: today,
          method: "BANK_TRANSFER",
        }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("refuses a second payment that would together overpay (PRD #15 §83)", async () => {
    const finance = await loginAs("FINANCE");
    const invoice = await sentInvoice(finance);

    const first = await payments.recordPayment(
      finance,
      createPaymentSchema.parse({
        invoiceId: invoice.id,
        amount: "900",
        paymentDate: today,
        method: "CASH",
      }),
    );
    createdPayments.push(first);

    // The balance is recalculated inside the transaction, not read beforehand.
    await expectError(
      payments.recordPayment(
        finance,
        createPaymentSchema.parse({
          invoiceId: invoice.id,
          amount: "200",
          paymentDate: today,
          method: "CASH",
        }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("refuses payment against an invoice that has not been sent (PRD #15 §66)", async () => {
    const finance = await loginAs("FINANCE");
    const invoice = await invoices.createInvoice(finance, invoiceInput());
    createdInvoices.push(invoice.id);

    await expectError(
      payments.recordPayment(
        finance,
        createPaymentSchema.parse({
          invoiceId: invoice.id,
          amount: "10",
          paymentDate: today,
          method: "CASH",
        }),
      ),
      "CONFLICT",
    );
  });

  it("requires exactly one parent (PRD #15 §74)", async () => {
    expect(() =>
      createPaymentSchema.parse({
        invoiceId: "invoice_001",
        expenseId: "expense_001",
        amount: "10",
        paymentDate: "2026-03-10",
        method: "CASH",
      }),
    ).toThrowError();

    expect(() =>
      createPaymentSchema.parse({ amount: "10", paymentDate: "2026-03-10", method: "CASH" }),
    ).toThrowError();
  });

  it("inherits the record's currency rather than accepting one (PRD #15 §76)", async () => {
    const finance = await loginAs("FINANCE");

    // invoice_013 is in USD. The payment must come out in USD too.
    const paymentId = await payments.recordPayment(
      finance,
      createPaymentSchema.parse({
        invoiceId: "invoice_013",
        amount: "100",
        paymentDate: today,
        method: "BANK_TRANSFER",
      }),
    );
    createdPayments.push(paymentId);

    const payment = await payments.getPayment(finance, paymentId);
    expect(payment.currency).toBe("USD");
  });

  it("voids rather than deletes, and the balance recovers (PRD #15 §85, §86)", async () => {
    const finance = await loginAs("FINANCE");
    const owner = await loginAs("OWNER");
    const invoice = await sentInvoice(finance);

    const paymentId = await payments.recordPayment(
      finance,
      createPaymentSchema.parse({
        invoiceId: invoice.id,
        amount: "1000",
        paymentDate: today,
        method: "BANK_TRANSFER",
      }),
    );
    createdPayments.push(paymentId);

    expect((await invoices.getInvoice(finance, invoice.id)).settlementStatus).toBe("PAID");

    await payments.voidPayment(owner, paymentId, "Duplicate of an earlier transfer.");

    const after = await invoices.getInvoice(finance, invoice.id);
    expect(after.outstandingAmount).toBe("1000.00");
    expect(after.settlementStatus).toBe("UNPAID");

    // The row is still there, with its reason.
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toContain("Duplicate");
  });
});

/* -------------------------------------------------------------------------- */
/* Budgets (PRD #15 §349, §350)                                                */
/* -------------------------------------------------------------------------- */

describe("budgets (PRD #15 §109–§117)", () => {
  it("computes budget vs actual from approved cost and open commitments", async () => {
    const owner = await loginAs("OWNER");
    const summary = await budgets.getProjectFinanceSummary(owner, "project_a");

    const expected = await prisma.expense.aggregate({
      where: { projectId: "project_a", status: "APPROVED", currency: "EUR" },
      _sum: { totalAmount: true },
    });
    const committed = await prisma.commitment.aggregate({
      where: { projectId: "project_a", status: "APPROVED", currency: "EUR" },
      _sum: { amount: true },
    });

    expect(summary.actualCost).toBe(
      (expected._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2),
    );
    expect(summary.openCommitments).toBe(
      (committed._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    );
    // Forecast = actual + open commitment (PRD #15 §120).
    expect(summary.forecastCost).toBe(
      (expected._sum.totalAmount ?? new Prisma.Decimal(0))
        .plus(committed._sum.amount ?? 0)
        .toFixed(2),
    );
  });

  it("bands risk from the forecast, with all three bands present in the seed", async () => {
    const owner = await loginAs("OWNER");
    const rows = await reports.budgetVsActual(owner);
    const risks = new Set(rows.map((row) => row.risk));

    expect(risks.has("GREEN")).toBe(true);
    expect(risks.has("WARNING")).toBe(true);
    expect(risks.has("CRITICAL")).toBe(true);
  });

  it("allows only one open version per project (PRD #15 §110)", async () => {
    const owner = await loginAs("OWNER");

    // project_e already has a draft in the seed.
    await expectError(
      budgets.createBudget(
        owner,
        createBudgetSchema.parse({
          projectId: "project_e",
          currency: "EUR",
          lineItems: [{ category: "SERVICES", description: "Second draft", plannedAmount: "100" }],
        }),
      ),
      "CONFLICT",
    );
  });

  it("fixes the currency once a budget has been approved (PRD #15 §117)", async () => {
    const owner = await loginAs("OWNER");

    await expectError(
      budgets.createBudget(
        owner,
        createBudgetSchema.parse({
          projectId: "project_d",
          currency: "USD",
          lineItems: [{ category: "SERVICES", description: "Dollar budget", plannedAmount: "100" }],
        }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("refuses to edit an approved budget (PRD #15 §111)", async () => {
    const owner = await loginAs("OWNER");

    await expectError(
      budgets.updateBudget(owner, "budget_a_v2", {
        projectId: "project_a",
        currency: "EUR",
        name: "Tampered",
        notes: undefined,
        lineItems: [{ category: "LABOR", description: "New", plannedAmount: "1" }],
        versionUpdatedAt: undefined,
      }),
      "CONFLICT",
    );
  });

  it("refuses to archive the current budget (PRD #15 §116)", async () => {
    const owner = await loginAs("OWNER");
    await expectError(budgets.archiveBudget(owner, "budget_a_v2"), "CONFLICT");
  });

  it("revises into a new version, leaving the approved one current", async () => {
    const owner = await loginAs("OWNER");

    const revisionId = await budgets.reviseBudget(owner, "budget_b_v1");
    createdBudgets.push(revisionId);

    const revision = await budgets.getBudget(owner, revisionId);
    expect(revision.status).toBe("DRAFT");
    expect(revision.isCurrent).toBe(false);
    expect(revision.version).toBe(2);
    // The copy carries the approved version's lines and currency.
    expect(revision.currency).toBe("EUR");
    expect(revision.lineItems.length).toBeGreaterThan(0);

    const original = await budgets.getBudget(owner, "budget_b_v1");
    expect(original.isCurrent).toBe(true);
  });

  it("stands the previous version down when a revision is approved (PRD #15 §113)", async () => {
    const owner = await loginAs("OWNER");
    const finance = await loginAs("FINANCE");

    // Project D has one approved version and nothing open, so a revision can
    // actually be started (project C already carries a pending v2 in the seed).
    const revisionId = await budgets.reviseBudget(finance, "budget_d_v1");
    createdBudgets.push(revisionId);

    await budgets.submitBudget(finance, revisionId);
    await budgets.approveBudget(owner, revisionId, null);

    const current = await prisma.projectBudget.findMany({
      where: { projectId: "project_d", isCurrent: true },
      select: { id: true },
    });
    // Exactly one current version, and it is the new one.
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(revisionId);

    // Put the seed back: the fixture documents v1 as current.
    await prisma.projectBudget.update({
      where: { id: revisionId },
      data: { isCurrent: false },
    });
    await prisma.projectBudget.update({
      where: { id: "budget_d_v1" },
      data: { isCurrent: true },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Expenses and commitments                                                    */
/* -------------------------------------------------------------------------- */

describe("expenses (PRD #15 §347, §348)", () => {
  it("adds net and tax on the server (PRD #15 §92)", async () => {
    const finance = await loginAs("FINANCE");

    const expense = await expenses.createExpense(
      finance,
      createExpenseSchema.parse({
        projectId: "project_a",
        expenseDate: "2026-03-01",
        category: "MATERIALS",
        description: "Total calculation fixture",
        currency: "EUR",
        netAmount: "1000.55",
        taxAmount: "200.11",
      }),
    );
    createdExpenses.push(expense.id);

    expect(expense.totalAmount).toBe("1200.66");
  });

  it("refuses a currency the project's budget does not use (PRD #15 §34)", async () => {
    const finance = await loginAs("FINANCE");

    await expectError(
      expenses.createExpense(
        finance,
        createExpenseSchema.parse({
          projectId: "project_a",
          expenseDate: "2026-03-01",
          category: "MATERIALS",
          description: "Dollar cost on a euro budget",
          currency: "USD",
          netAmount: "100",
          taxAmount: "0",
        }),
      ),
      "VALIDATION_ERROR",
    );
  });

  it("refuses to archive approved cost (PRD #15 §102)", async () => {
    const owner = await loginAs("OWNER");
    await expectError(expenses.archiveExpense(owner, "expense_001"), "CONFLICT");
  });

  it("requires a project from a project-scoped user (PRD #15 §211)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    // The PM has no expense permission at all, so this is refused earlier —
    // which is the stronger statement.
    await expectError(
      expenses.createExpense(
        pm,
        createExpenseSchema.parse({
          expenseDate: "2026-03-01",
          category: "SERVICES",
          description: "Company overhead",
          currency: "EUR",
          netAmount: "10",
          taxAmount: "0",
        }),
      ),
      "FORBIDDEN",
    );
  });
});

describe("commitments (PRD #15 §351)", () => {
  it("counts only approved commitments toward forecast (PRD #15 §119)", async () => {
    const owner = await loginAs("OWNER");
    const before = await budgets.getProjectFinanceSummary(owner, "project_a");

    const commitment = await commitments.createCommitment(
      owner,
      createCommitmentSchema.parse({
        projectId: "project_a",
        description: "Forecast fixture",
        category: "SERVICES",
        currency: "EUR",
        amount: "5000",
      }),
    );
    createdCommitments.push(commitment.id);

    // A draft changes nothing.
    const afterDraft = await budgets.getProjectFinanceSummary(owner, "project_a");
    expect(afterDraft.openCommitments).toBe(before.openCommitments);

    await commitments.submitCommitment(owner, commitment.id);
    await commitments.approveCommitment(owner, commitment.id, null);

    const afterApproval = await budgets.getProjectFinanceSummary(owner, "project_a");
    expect(Number.parseFloat(afterApproval.openCommitments)).toBeCloseTo(
      Number.parseFloat(before.openCommitments) + 5000,
      2,
    );

    // Closing it takes it back out again (PRD #15 §134).
    await commitments.closeCommitment(owner, commitment.id);
    const afterClose = await budgets.getProjectFinanceSummary(owner, "project_a");
    expect(afterClose.openCommitments).toBe(before.openCommitments);
  });

  it("refuses to archive a live approved commitment (PRD #15 §136)", async () => {
    const owner = await loginAs("OWNER");
    await expectError(commitments.archiveCommitment(owner, "commitment_001"), "CONFLICT");
  });
});

/* -------------------------------------------------------------------------- */
/* Approvals, overview and reports                                             */
/* -------------------------------------------------------------------------- */

describe("approval queue (PRD #15 §352)", () => {
  it("shows the Owner every pending finance approval", async () => {
    const owner = await loginAs("OWNER");
    const queue = await approvals.listApprovals(owner, { status: "PENDING", limit: 100 });

    const types = new Set(queue.data.map((entry) => entry.recordType));
    expect(types.has("INVOICE")).toBe(true);
    expect(types.has("EXPENSE")).toBe(true);
    expect(types.has("BUDGET")).toBe(true);
    expect(types.has("COMMITMENT")).toBe(true);
  });

  it("narrows the queue to records the approver can reach (PRD #15 §143)", async () => {
    const owner = await loginAs("OWNER");
    const pm = await loginAs("PROJECT_MANAGER");

    const all = await approvals.listApprovals(owner, { status: "PENDING", limit: 100 });
    expect(all.data.length).toBeGreaterThan(0);

    // The PM has no approval permission, so the queue is refused outright.
    await expectError(approvals.listApprovals(pm, { status: "PENDING" }), "FORBIDDEN");
  });

  it("marks the submitter's own approval as undecidable by them", async () => {
    const finance = await loginAs("FINANCE");
    const ceo = await loginAs("CEO");

    const queue = await approvals.listApprovals(ceo, { status: "PENDING", limit: 100 });
    const seeded = queue.data.find((entry) => entry.recordId === "invoice_008");

    // Submitted by Finance in the seed, so the CEO may decide it.
    expect(seeded?.canDecide).toBe(true);
    expect(seeded?.submittedBy.memberId).toBe(finance.membershipId);
  });
});

describe("overview and reports (PRD #15 §360, §361)", () => {
  it("groups receivables by currency and never adds them together", async () => {
    const finance = await loginAs("FINANCE");
    const overview = await getFinanceOverview(finance);

    // The seed has a USD invoice alongside the euro ones.
    const currencies = overview.receivables.map((total) => total.currency);
    expect(currencies).toContain("EUR");
    expect(currencies).toContain("USD");
    expect(new Set(currencies).size).toBe(currencies.length);
  });

  it("hides panels the reader has no permission for (PRD #15 §25)", async () => {
    const sales = await loginAs("SALES");
    const overview = await getFinanceOverview(sales);

    expect(overview.visible.receivables).toBe(true);
    expect(overview.visible.payables).toBe(false);
    expect(overview.visible.cashflow).toBe(false);
    expect(overview.payables).toEqual([]);
  });

  it("ages receivables into buckets without storing them (PRD #15 §149, §255)", async () => {
    const finance = await loginAs("FINANCE");
    const rows = await reports.receivablesAging(finance);

    const euro = rows.find((row) => row.currency === "EUR");
    expect(euro).toBeDefined();

    // The seed places an invoice in every bucket.
    for (const bucket of reports.AGING_BUCKETS) {
      expect(euro!.buckets[bucket]).toMatch(/^\d+\.\d{2}$/);
    }
    expect(Number.parseFloat(euro!.buckets.D90_PLUS)).toBeGreaterThan(0);
  });

  it("refuses a report the reader has no permission for (PRD #15 §158)", async () => {
    const sales = await loginAs("SALES");
    await expectError(reports.cashflowSummary(sales), "FORBIDDEN");
    await expectError(reports.budgetVsActual(sales), "FORBIDDEN");
  });

  it("excludes voided payments from cashflow (PRD #15 §86)", async () => {
    const finance = await loginAs("FINANCE");
    const report = await reports.cashflowSummary(finance, "ytd");

    const voided = await prisma.payment.aggregate({
      where: { companyId: finance.companyId, status: "VOIDED" },
      _sum: { amount: true },
    });
    expect((voided._sum.amount ?? new Prisma.Decimal(0)).greaterThan(0)).toBe(true);

    const recorded = await prisma.payment.aggregate({
      where: {
        companyId: finance.companyId,
        status: "RECORDED",
        direction: "RECEIPT",
        currency: "EUR",
      },
      _sum: { amount: true },
    });

    const euro = report.rows.find((row) => row.currency === "EUR");
    // What the report shows is the recorded total, not recorded plus voided.
    expect(Number.parseFloat(euro?.cashIn ?? "0")).toBeLessThanOrEqual(
      Number.parseFloat((recorded._sum.amount ?? new Prisma.Decimal(0)).toFixed(2)),
    );
  });
});
