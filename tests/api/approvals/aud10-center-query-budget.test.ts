import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The Group queue's query budget (AUD-10 §4, §9 — CW-23).
 *
 * The number of statements one Group read sends must not grow with the number
 * of approvals it lists: every source reads its rows, their records, their
 * people and their separation-of-duty facts per type and per page, never per
 * row. Counted on the application's own Prisma client — the one every service
 * imports — through its query event, installed before any service loads (so
 * everything below is imported dynamically, after it).
 *
 * The fixture grows the queue by twelve waiting approvals in two companies
 * (plain expenses, and purchase orders large enough to carry a three-step chain)
 * and the read must cost exactly what it did before, within an absolute ceiling.
 */

const counter = { queries: 0 };
const client = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [{ emit: "event", level: "query" }] });
client.$on("query", () => {
  counter.queries += 1;
});
(globalThis as unknown as { prisma?: PrismaClient }).prisma = client;

type Helpers = typeof import("../../helpers");
type Group = typeof import("@/lib/modules/approvals/approvals.group");
type Schema = typeof import("@/lib/modules/approvals/approvals.schema");
type Expenses = typeof import("@/lib/modules/finance/expenses/expense.service");
type ExpenseSchema = typeof import("@/lib/modules/finance/expenses/expense.schema");
type Orders = typeof import("@/lib/modules/procurement/orders/order.service");

let helpers: Helpers;
let group: Group;
let schema: Schema;
let expenses: Expenses;
let expenseSchema: ExpenseSchema;
let orders: Orders;

const PREFIX = "aud10b_budget";
const created = { expenses: [] as string[], orders: [] as string[] };

/** One statement budget for a whole Group "waiting for me" read, whatever the queue holds (CW-23). */
const CEILING = 250; // measured 175 on the demo data (2026-09-27), five companies × eleven sources

beforeAll(async () => {
  helpers = await import("../../helpers");
  group = await import("@/lib/modules/approvals/approvals.group");
  schema = await import("@/lib/modules/approvals/approvals.schema");
  expenses = await import("@/lib/modules/finance/expenses/expense.service");
  expenseSchema = await import("@/lib/modules/finance/expenses/expense.schema");
  orders = await import("@/lib/modules/procurement/orders/order.service");
});

afterAll(async () => {
  const { prisma } = helpers;
  const records = [...created.expenses, ...created.orders];
  if (records.length) {
    const orderCycles = await prisma.procurementApproval.findMany({ where: { recordId: { in: created.orders } }, select: { id: true } });
    await prisma.approvalStep.deleteMany({ where: { approvalId: { in: orderCycles.map((row) => row.id) } } });
    await prisma.attentionItem.deleteMany({ where: { entityId: { in: records } } });
    await prisma.notification.deleteMany({ where: { entityId: { in: records } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: records } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: records } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: records } } });
    await prisma.financeApproval.deleteMany({ where: { recordId: { in: created.expenses } } });
    await prisma.expense.deleteMany({ where: { id: { in: created.expenses } } });
    await prisma.procurementApproval.deleteMany({ where: { recordId: { in: created.orders } } });
    await prisma.commitment.deleteMany({ where: { sourceEntityId: { in: created.orders } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: created.orders } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.orders } } });
  }
  await helpers.cleanupSessions();
  await prisma.$disconnect();
  await client.$disconnect();
});

async function measure<T>(run: () => Promise<T>): Promise<{ queries: number; result: T }> {
  const before = counter.queries;
  const result = await run();
  return { queries: counter.queries - before, result };
}

async function addExpense(email: string, projectId: string, index: number) {
  const finance = await helpers.loginAsEmail(email);
  const expense = await expenses.createExpense(
    finance,
    expenseSchema.createExpenseSchema.parse({ projectId, expenseDate: "2026-09-01", category: "MATERIALS", description: `${PREFIX} ${index}`, currency: "EUR", netAmount: `${1000 + index}.00`, taxAmount: "0" }),
  );
  created.expenses.push(expense.id);
  await expenses.submitExpense(finance, expense.id);
}

async function addChainOrder(index: number) {
  const pm = await helpers.loginAs("PROJECT_MANAGER");
  const order = await orders.createOrder(pm, {
    supplierId: "supplier_atlas",
    projectId: helpers.PROJECT.a,
    orderDate: new Date(),
    currency: "EUR",
    items: [{ description: `${PREFIX} steel ${index}`, quantity: "1", unit: "lot", unitPrice: "68000", taxRate: "0.2" }],
  } as Parameters<Orders["createOrder"]>[1]);
  created.orders.push(order.id);
  await orders.submitOrder(pm, order.id);
}

describe("the Group queue's query budget (CW-23)", () => {
  it("costs the same number of statements with twelve more waiting approvals, within the ceiling", async () => {
    const owner = await helpers.loginAs("OWNER", { workspace: "GROUP" });
    const waiting = schema.approvalQuerySchema.parse({ tab: "waiting", limit: 50 });
    const read = () => group.listApprovalsForWorkspace(owner, waiting);

    await read(); // settings and caches warm, as on any page after the first
    const before = await measure(read);
    expect(before.result.failedProviders).toEqual([]);
    // The counter sees the services' own statements (it is their client), not a silent zero.
    expect(before.queries).toBeGreaterThan(10);

    for (let index = 0; index < 4; index += 1) await addExpense("finance-a@nesto.test", helpers.PROJECT.a, index);
    for (let index = 4; index < 8; index += 1) await addExpense("finance-b@nesto.test", helpers.PROJECT.b, index);
    for (let index = 8; index < 12; index += 1) await addChainOrder(index);

    const after = await measure(read);
    expect(after.result.failedProviders).toEqual([]);
    // The fixture really is in the queue the Owner reads: the expenses wait on them in both companies.
    const listed = new Set(after.result.items.map((item) => item.sourceId));
    expect(created.expenses.filter((id) => listed.has(id)).length).toBe(created.expenses.length);
    expect(after.result.counts.waiting).toBeGreaterThanOrEqual(before.result.counts.waiting + created.expenses.length);

    expect(after.queries, `statements before ${before.queries}, after ${after.queries}`).toBe(before.queries);
    expect(after.queries).toBeLessThanOrEqual(CEILING);

    // The header counts on their own obey the same rule.
    const counts = await measure(() => group.getApprovalCountsForWorkspace(owner));
    expect(counts.queries).toBeLessThanOrEqual(after.queries);
  });
});
