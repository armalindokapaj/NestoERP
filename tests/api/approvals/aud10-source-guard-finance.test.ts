import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { AccessError } from "@/lib/access/guards";
import * as actions from "@/lib/actions/finance";
import * as budgets from "@/lib/modules/finance/budgets/budget.service";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import { createCommitmentSchema } from "@/lib/modules/finance/commitments/commitment.schema";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { createExpenseSchema } from "@/lib/modules/finance/expenses/expense.schema";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { createInvoiceSchema } from "@/lib/modules/finance/invoices/invoice.schema";
import { cleanupSessions, loginAs, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";
import { routeHandlers } from "../../security/harness/mutations";
import { callRoute } from "../../security/harness/routes";
import { disconnectLocker, raceOnRow, shownCycle } from "./aud10-cycles";
import { asPerson, fromAction, snapshot, sourceGuardTests, type SourceScenario } from "./aud10-scenarios";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));

/**
 * Finance decisions name the cycle they decide (AUD-10 §4, CW-02, CW-04,
 * CW-05; gaps A1, A6, A12). Invoices, expenses, budgets and commitments are
 * approved from their own pages, the finance queue, the API and the Approvals
 * Center; every one of those now names the approval row it showed, and the
 * service refuses a missing (428 APPROVAL_CYCLE_REQUIRED) or replaced (409
 * APPROVAL_SOURCE_CHANGED) one inside its transaction.
 */

const PREFIX = "aud10a_";
const made = { invoices: new Set<string>(), expenses: new Set<string>(), budgets: new Set<string>(), commitments: new Set<string>() };

afterEach(async () => {
  const all = [...made.invoices, ...made.expenses, ...made.budgets, ...made.commitments];
  if (all.length === 0) return;
  await prisma.notification.deleteMany({ where: { entityId: { in: all } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: all } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: all } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: all } } });
  await prisma.financeApproval.deleteMany({ where: { recordId: { in: all } } });
  await prisma.invoice.deleteMany({ where: { id: { in: [...made.invoices] } } });
  await prisma.expense.deleteMany({ where: { id: { in: [...made.expenses] } } });
  await prisma.commitment.deleteMany({ where: { id: { in: [...made.commitments] } } });
  if (made.budgets.size > 0) {
    await prisma.projectBudget.deleteMany({ where: { id: { in: [...made.budgets] } } });
    // The seed's current version stands again (the fixture documents v2 as current).
    await prisma.projectBudget.update({ where: { id: "budget_a_v2" }, data: { isCurrent: true } });
  }
  for (const set of Object.values(made)) set.clear();
});

afterAll(async () => {
  await disconnectLocker();
  await cleanupSessions();
  await prisma.$disconnect();
});

const owner = () => loginAs("OWNER");
const finance = () => loginAs("FINANCE");

function invoiceInput() {
  return createInvoiceSchema.parse({
    invoiceNumber: `${PREFIX}${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
    clientId: "client_acme",
    projectId: "project_a",
    issueDate: "2026-03-01",
    dueDate: "2026-03-31",
    currency: "EUR",
    lineItems: [{ description: `${PREFIX}line`, quantity: "1", unitPrice: "1000", taxRate: "20" }],
  });
}

const invoice: SourceScenario = {
  label: "finance invoice",
  module: "finance",
  providerKey: "finance",
  sourceTable: "invoices",
  approver: owner,
  async createSubmitted() {
    const context = await finance();
    const created = await invoices.createInvoice(context, invoiceInput());
    made.invoices.add(created.id);
    await invoices.submitInvoice(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.invoiceLifecycleAction(id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.rejectInvoiceAction(id, `${PREFIX}the valuation is not agreed`, cycle))),
  resubmit: async (id) => invoices.submitInvoice(await finance(), id),
  status: async (id) => (await prisma.invoice.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "FINANCE_INVOICE_APPROVED",
};

const expense: SourceScenario = {
  label: "finance expense",
  module: "finance",
  providerKey: "finance",
  sourceTable: "expenses",
  approver: owner,
  async createSubmitted() {
    const context = await finance();
    const created = await expenses.createExpense(
      context,
      createExpenseSchema.parse({ projectId: "project_a", expenseDate: "2026-03-01", category: "MATERIALS", description: `${PREFIX}expense`, currency: "EUR", netAmount: "100", taxAmount: "0" }),
    );
    made.expenses.add(created.id);
    await expenses.submitExpense(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.expenseLifecycleAction(id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.rejectExpenseAction(id, `${PREFIX}receipt missing`, cycle))),
  resubmit: async (id) => expenses.submitExpense(await finance(), id),
  status: async (id) => (await prisma.expense.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "FINANCE_EXPENSE_APPROVED",
};

const budget: SourceScenario = {
  label: "finance budget",
  module: "finance",
  providerKey: "finance",
  sourceTable: "project_budgets",
  approver: owner,
  async createSubmitted() {
    // A revision of Aurelia's current budget: project_a has nothing open.
    const context = await finance();
    const id = await budgets.reviseBudget(context, "budget_a_v2");
    made.budgets.add(id);
    await budgets.submitBudget(context, id);
    return id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.budgetLifecycleAction(id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.rejectBudgetAction(id, `${PREFIX}contingency too thin`, cycle))),
  resubmit: async (id) => budgets.submitBudget(await finance(), id),
  status: async (id) => (await prisma.projectBudget.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "FINANCE_BUDGET_APPROVED",
};

const commitment: SourceScenario = {
  label: "finance commitment",
  module: "finance",
  providerKey: "finance",
  sourceTable: "commitments",
  approver: owner,
  async createSubmitted() {
    const context = await finance();
    const created = await commitments.createCommitment(
      context,
      createCommitmentSchema.parse({ projectId: "project_a", description: `${PREFIX}commitment`, category: "SERVICES", currency: "EUR", amount: "500" }),
    );
    made.commitments.add(created.id);
    await commitments.submitCommitment(context, created.id);
    return created.id;
  },
  approve: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.commitmentLifecycleAction(id, "approve", undefined, cycle))),
  sendBack: async (id, cycle) => fromAction(await asPerson(await owner(), () => actions.rejectCommitmentAction(id, `${PREFIX}wrong supplier`, cycle))),
  resubmit: async (id) => commitments.submitCommitment(await finance(), id),
  status: async (id) => (await prisma.commitment.findUniqueOrThrow({ where: { id } })).status,
  approvedStatus: "APPROVED",
  approvedActivity: "FINANCE_COMMITMENT_APPROVED",
};

const tracker = { track: () => undefined };

for (const scenario of [invoice, expense, budget, commitment]) {
  describe(`${scenario.label} (AUD-10 §4)`, () => {
    sourceGuardTests(scenario, tracker);
  });
}

describe("finance API routes name the cycle too (AUD-10 §4, CW-02, CW-05)", () => {
  it("CW-05 refuses an approve with no approvalId (428) and a replaced one (409), then approves the named cycle", async () => {
    const id = await invoice.createSubmitted();
    const first = await shownCycle("finance", id);
    await invoices.rejectInvoice(await owner(), id, `${PREFIX}send back`, first);
    await invoice.resubmit(id);
    const second = await shownCycle("finance", id);

    const approve = await routeHandlers("/api/finance/invoices/[invoiceId]/approve");
    const path = `/api/finance/invoices/${id}/approve`;
    actAs(await owner());
    try {
      const before = await snapshot(invoice, id);
      const missing = await callRoute(approve.POST!, "POST", path, { invoiceId: id }, {});
      expect(missing.status).toBe(428);
      expect(missing.body).toMatchObject({ error: { code: "PRECONDITION_REQUIRED", details: { code: "APPROVAL_CYCLE_REQUIRED" } } });
      const stale = await callRoute(approve.POST!, "POST", path, { invoiceId: id }, { approvalId: first.approvalId });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ error: { code: "CONFLICT", details: { code: "APPROVAL_SOURCE_CHANGED" } } });
      expect(await snapshot(invoice, id)).toEqual(before);

      const named = await callRoute(approve.POST!, "POST", path, { invoiceId: id }, { approvalId: second.approvalId });
      expect(named.status).toBe(204);
      expect(await invoice.status(id)).toBe("APPROVED");
    } finally {
      actAs(null);
    }
  });

  it("CW-05 a reject through the API needs its cycle as well", async () => {
    const id = await expense.createSubmitted();
    const reject = await routeHandlers("/api/finance/expenses/[expenseId]/reject");
    const path = `/api/finance/expenses/${id}/reject`;
    actAs(await owner());
    try {
      const missing = await callRoute(reject.POST!, "POST", path, { expenseId: id }, { note: `${PREFIX}no cycle named` });
      expect(missing.status).toBe(428);
      expect(await expense.status(id)).toBe("PENDING_APPROVAL");
      const named = await callRoute(reject.POST!, "POST", path, { expenseId: id }, { note: `${PREFIX}receipt missing`, approvalId: (await shownCycle("finance", id)).approvalId });
      expect(named.status).toBe(204);
      expect(await expense.status(id)).toBe("REJECTED");
    } finally {
      actAs(null);
    }
  });
});

describe("the finance queue decides the row it shows (AUD-10 §4, CW-05)", () => {
  it("a queue row left open across a reject and resubmission cannot approve the new cycle", async () => {
    const id = await commitment.createSubmitted();
    // The queue row is the approval row: its id is what the queue sends.
    const row = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });
    await commitments.rejectCommitment(await owner(), id, `${PREFIX}send back`, { approvalId: row.id });
    await commitment.resubmit(id);

    const stale = await asPerson(await owner(), () => actions.commitmentLifecycleAction(id, "approve", undefined, { approvalId: row.id }));
    expect(stale).toMatchObject({ ok: false, code: "APPROVAL_SOURCE_CHANGED" });
    expect(await commitment.status(id)).toBe("PENDING_APPROVAL");
  });
});

describe("one pending cycle, decided deterministically (AUD-10 §4, A6)", () => {
  it("refuses to decide a record that carries two pending cycles, naming neither winner", async () => {
    const id = await invoice.createSubmitted();
    const pending = await prisma.financeApproval.findFirstOrThrow({ where: { recordId: id, status: "PENDING" } });
    // A second pending row, as a double submit before the one-pending index would leave it.
    let extraId: string | null = null;
    try {
      const extra = await prisma.financeApproval.create({
        data: { companyId: pending.companyId, recordType: "INVOICE", recordId: id, status: "PENDING", submittedByMemberId: pending.submittedByMemberId, submittedAt: new Date(pending.submittedAt.getTime() + 1000) },
      });
      extraId = extra.id;
    } catch (error) {
      // The one-pending-cycle partial unique index (AUD-10 A6, migration 20260927110000)
      // forbids the state outright where it is applied: the stronger guarantee.
      expect((error as { code?: string }).code).toBe("P2002");
      return;
    }
    const before = await snapshot(invoice, id);
    const refused = await invoice.approve(id, { approvalId: extraId });
    expect(refused).toMatchObject({ ok: false, code: "APPROVAL_CYCLE_AMBIGUOUS" });
    expect(await snapshot(invoice, id)).toEqual(before);
  });
});

describe("two budget approvals at once leave one current budget (AUD-10 §4, A12)", () => {
  it("serialises approvals per project: both land, the later one is current, no raw unique violation", async () => {
    const context = await finance();
    const approver = await owner();
    // One open version per project is the rule at creation (PRD #15 §110); two
    // pending versions are what a lost race there would leave, so the fixture
    // writes the second directly — the approval path must still hold.
    const first = await budgets.reviseBudget(context, "budget_a_v2");
    made.budgets.add(first);
    await budgets.submitBudget(context, first);
    const seed = await prisma.projectBudget.findUniqueOrThrow({ where: { id: first }, });
    const second = await prisma.projectBudget.create({
      data: {
        companyId: seed.companyId,
        projectId: seed.projectId,
        version: seed.version + 1,
        currency: seed.currency,
        status: "PENDING_APPROVAL",
        totalAmount: seed.totalAmount,
        createdByMemberId: context.membershipId,
      },
    });
    made.budgets.add(second.id);
    await prisma.financeApproval.create({
      data: { companyId: seed.companyId, recordType: "BUDGET", recordId: second.id, status: "PENDING", submittedByMemberId: context.membershipId },
    });

    // The barrier holds the project's current version, which both approvals must stand down.
    const [a, b] = await raceOnRow("project_budgets", "budget_a_v2", [
      async () => budgets.approveBudget(approver, first, null, await shownCycle("finance", first)),
      async () => budgets.approveBudget(approver, second.id, null, await shownCycle("finance", second.id)),
    ]);
    expect(a.ok, a.ok ? "" : String((a as { error: unknown }).error)).toBe(true);
    expect(b.ok, b.ok ? "" : String((b as { error: unknown }).error)).toBe(true);

    const current = await prisma.projectBudget.findMany({ where: { projectId: seed.projectId, isCurrent: true }, select: { id: true } });
    expect(current).toHaveLength(1);
    expect([first, second.id]).toContain(current[0].id);
    expect(await prisma.projectBudget.count({ where: { id: { in: [first, second.id] }, status: "APPROVED" } })).toBe(2);
  });
});

describe("saying no needs a reason at the service (AUD-10 §4, A13)", () => {
  it("refuses a finance reject with a blank reason even when the cycle is named", async () => {
    const id = await invoice.createSubmitted();
    await expect(invoices.rejectInvoice(await owner(), id, "   ", await shownCycle("finance", id))).rejects.toBeInstanceOf(AccessError);
    expect(await invoice.status(id)).toBe("PENDING_APPROVAL");
  });
});
