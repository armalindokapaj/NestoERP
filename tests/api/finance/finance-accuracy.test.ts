import { Prisma, type ExpenseStatus, type InvoiceStatus } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import * as expenses from "@/lib/modules/finance/expenses/expense.service";
import { parseExpenseQuery, parseInvoiceQuery } from "@/lib/modules/finance/finance.query";
import { readRegisterSnapshot } from "@/lib/modules/finance/finance.register";
import { financeScopeKind } from "@/lib/modules/finance/finance.scope";
import { paidByExpense, paidByInvoice, settlementFor } from "@/lib/modules/finance/finance.settlement";
import type { FinanceListSummary } from "@/lib/modules/finance/finance.types";
import { readInvoiceRegister } from "@/lib/modules/finance/invoices/invoice.repository";
import { INVOICE_SORT_KEYS } from "@/lib/modules/finance/invoices/invoice.schema";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import { expenseSettlement, invoiceSettlement } from "@/lib/modules/finance/invoices/invoice.status";
import { reverseAllocation } from "@/lib/modules/finance/payments/payment.allocations";
import { createPaymentSchema } from "@/lib/modules/finance/payments/payment.schema";
import * as payments from "@/lib/modules/finance/payments/payment.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * Finance accuracy (AUD-01 §3-§6, FA-01..FA-13, FA-18, FA-19).
 *
 * The invoice and expense registers against the real database, through the
 * same services the pages and the API call. Every fixture is written with the
 * `aud01_` prefix and a number the test searches for, so each assertion is
 * about exactly the records it made, and the clock is frozen: settlement is
 * classified at one injected instant, never at "whenever the test ran".
 */

const PREFIX = "aud01";
const FROZEN = new Date("2026-06-15T00:00:00.000Z");
const DAY = 86_400_000;
type GroupCompany = (typeof COMPANY)["a" | "b" | "c" | "d" | "e"];

const CLIENT: Record<GroupCompany, string> = {
  [COMPANY.a]: "client_acme",
  [COMPANY.b]: "client_delta",
  [COMPANY.c]: "client_municipality",
  [COMPANY.d]: "client_meridian",
  [COMPANY.e]: "client_greenline",
};
const PROJECT_OF: Record<GroupCompany, string> = { [COMPANY.a]: PROJECT.a, [COMPANY.b]: PROJECT.b, [COMPANY.c]: PROJECT.c, [COMPANY.d]: PROJECT.d, [COMPANY.e]: PROJECT.e };
const MEMBER: Record<GroupCompany, string> = {
  [COMPANY.a]: "member_finance",
  [COMPANY.b]: "member_finance__b",
  [COMPANY.c]: "member_finance__c",
  [COMPANY.d]: "member_finance__d",
  [COMPANY.e]: "member_finance__e",
};

const restore: Array<() => Promise<unknown>> = [];
let serial = 0;

async function removeFixtures() {
  const allocations = await prisma.paymentAllocation.findMany({
    where: { OR: [{ invoiceId: { startsWith: PREFIX } }, { expenseId: { startsWith: PREFIX } }, { paymentId: { startsWith: PREFIX } }] },
    select: { paymentId: true },
  });
  const paymentIds = [...new Set(allocations.map((row) => row.paymentId))];
  await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: paymentIds } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: paymentIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.invoice.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.expense.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

afterEach(async () => {
  for (const undo of restore.splice(0).reverse()) await undo();
  await removeFixtures();
  await cleanupSessions();
});
afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const day = (offset: number) => new Date(FROZEN.getTime() + offset * DAY);

type InvoiceSeed = {
  company?: GroupCompany;
  total?: string;
  currency?: string;
  status?: InvoiceStatus;
  issueDate?: Date;
  dueDate?: Date;
  number?: string;
  projectId?: string | null;
};

/** Invoices numbered `AUD01-<tag>-001…`, in the order given; issued a day apart, newest first. */
async function seedInvoices(tag: string, seeds: InvoiceSeed[]): Promise<string[]> {
  const rows = seeds.map((seed, index) => {
    const company = seed.company ?? COMPANY.a;
    const status = seed.status ?? "SENT";
    serial += 1;
    return {
      id: `${PREFIX}_inv_${tag.toLowerCase()}_${serial}`,
      companyId: company,
      invoiceNumber: seed.number ?? `AUD01-${tag}-${String(index + 1).padStart(3, "0")}`,
      clientId: CLIENT[company],
      projectId: seed.projectId === undefined ? PROJECT_OF[company] : seed.projectId,
      issueDate: seed.issueDate ?? day(-10 - index),
      dueDate: seed.dueDate ?? day(30),
      currency: seed.currency ?? "EUR",
      subtotal: seed.total ?? "1000.00",
      taxAmount: "0.00",
      totalAmount: seed.total ?? "1000.00",
      status,
      preArchiveStatus: status === "ARCHIVED" ? ("SENT" as const) : null,
      archivedAt: status === "ARCHIVED" ? day(-1) : null,
      createdByMemberId: MEMBER[company],
    };
  });
  await prisma.invoice.createMany({ data: rows });
  return rows.map((row) => row.id);
}

type ExpenseSeed = { company?: GroupCompany; total?: string; currency?: string; status?: ExpenseStatus; expenseDate?: Date; number?: string };

async function seedExpenses(tag: string, seeds: ExpenseSeed[]): Promise<string[]> {
  const rows = seeds.map((seed, index) => {
    const company = seed.company ?? COMPANY.a;
    const status = seed.status ?? "APPROVED";
    serial += 1;
    return {
      id: `${PREFIX}_exp_${tag.toLowerCase()}_${serial}`,
      companyId: company,
      expenseNumber: seed.number ?? `AUD01-${tag}-${String(index + 1).padStart(3, "0")}`,
      projectId: PROJECT_OF[company],
      expenseDate: seed.expenseDate ?? day(-10 - index),
      category: "MATERIALS" as const,
      description: `Accuracy fixture ${tag} ${index + 1}`,
      payeeName: "Fixture Supplies",
      currency: seed.currency ?? "EUR",
      netAmount: seed.total ?? "1000.00",
      taxAmount: "0.00",
      totalAmount: seed.total ?? "1000.00",
      status,
      preArchiveStatus: status === "ARCHIVED" ? ("APPROVED" as const) : null,
      archivedAt: status === "ARCHIVED" ? day(-1) : null,
      createdByMemberId: MEMBER[company],
    };
  });
  await prisma.expense.createMany({ data: rows });
  return rows.map((row) => row.id);
}

type Target = { invoiceId: string } | { expenseId: string };

/**
 * One payment and its allocations, written as the ledger holds them. Company and
 * currency come from the first target unless a test means to break them.
 */
async function pay(
  allocations: Array<Target & { amount: string; reversed?: boolean }>,
  options: { paymentAmount?: string; status?: "RECORDED" | "VOIDED"; currency?: string; paymentCompany?: string } = {},
): Promise<{ paymentId: string; allocationIds: string[] }> {
  const first = allocations[0]!;
  const record: { companyId: string; currency: string; clientId: string | null } =
    "invoiceId" in first
      ? await prisma.invoice.findUniqueOrThrow({ where: { id: first.invoiceId }, select: { companyId: true, currency: true, clientId: true } })
      : { ...(await prisma.expense.findUniqueOrThrow({ where: { id: first.expenseId }, select: { companyId: true, currency: true } })), clientId: null };
  const companyId = record.companyId as GroupCompany;
  serial += 1;
  const paymentId = `${PREFIX}_pay_${serial}`;
  const total = allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
  await prisma.payment.create({
    data: {
      id: paymentId,
      companyId: options.paymentCompany ?? companyId,
      direction: "invoiceId" in first ? "RECEIPT" : "DISBURSEMENT",
      clientId: record.clientId,
      amount: options.paymentAmount ?? total.toFixed(2),
      currency: options.currency ?? record.currency,
      paymentDate: day(-1),
      method: "BANK_TRANSFER",
      status: options.status ?? "RECORDED",
      createdByMemberId: MEMBER[companyId],
    },
  });
  const allocationIds: string[] = [];
  for (const allocation of allocations) {
    serial += 1;
    const id = `${PREFIX}_alloc_${serial}`;
    await prisma.paymentAllocation.create({
      data: {
        id,
        companyId,
        paymentId,
        invoiceId: "invoiceId" in allocation ? allocation.invoiceId : null,
        expenseId: "expenseId" in allocation ? allocation.expenseId : null,
        amount: allocation.amount,
        createdByMemberId: MEMBER[companyId],
        reversedAt: allocation.reversed ? day(-1) : null,
      },
    });
    allocationIds.push(id);
  }
  return { paymentId, allocationIds };
}

const finance = () => loginAs("FINANCE");
const groupFinance = () => loginAs("FINANCE", { workspace: "GROUP" });

function listInvoices(session: UserContext, params: Record<string, string>, company?: string) {
  return invoices.listInvoicesForWorkspace(session, parseInvoiceQuery(params), { company, now: FROZEN });
}

function listExpenses(session: UserContext, params: Record<string, string>, company?: string) {
  return expenses.listExpensesForWorkspace(session, parseExpenseQuery(params), { company, now: FROZEN });
}

/** Every page of a list, in order, for a check that nothing is skipped or repeated. */
async function allPages<T extends { id: string }>(read: (page: number) => Promise<{ data: T[]; pagination: { totalPages: number } }>): Promise<T[]> {
  const first = await read(1);
  const rows = [...first.data];
  for (let page = 2; page <= first.pagination.totalPages; page += 1) rows.push(...(await read(page)).data);
  return rows;
}

const empty = (evaluatedAt = FROZEN): FinanceListSummary => ({ evaluatedAt: evaluatedAt.toISOString(), matchingCount: 0, byCurrency: [] });

/* -------------------------------------------------------------------------- */
/* FA-01, FA-02: settlement is filtered before the page                        */
/* -------------------------------------------------------------------------- */

describe("settlement filtered before pagination (FA-01, FA-02)", () => {
  it("FA-01 puts the one paid invoice on page 1 of a Paid search, wherever it sat unfiltered", async () => {
    const ids = await seedInvoices("FA01", Array.from({ length: 60 }, () => ({})));
    await pay([{ invoiceId: ids[39]!, amount: "1000.00" }]);
    const session = await finance();
    const search = "AUD01-FA01-";

    // Unfiltered, it is the 40th: page 2 of 25.
    const unfiltered = await listInvoices(session, { search });
    expect(unfiltered.pagination.total).toBe(60);
    expect(unfiltered.data.map((row) => row.id)).not.toContain(ids[39]);
    expect((await listInvoices(session, { search, page: "2" })).data.map((row) => row.id)).toContain(ids[39]);

    const paid = await listInvoices(session, { search, settlement: "PAID" });
    expect(paid.data.map((row) => row.id)).toEqual([ids[39]]);
    expect(paid.pagination).toEqual({ page: 1, limit: 25, total: 1, totalPages: 1 });
    expect(paid.summary).toEqual({
      evaluatedAt: FROZEN.toISOString(),
      matchingCount: 1,
      byCurrency: [{ currency: "EUR", count: 1, totalAmount: "1000.00", paidAmount: "1000.00", outstandingAmount: "0.00" }],
    });

    const unpaid = await listInvoices(session, { search, settlement: "UNPAID" });
    expect(unpaid.pagination.total).toBe(59);
    expect(unpaid.data).toHaveLength(25);
    expect(unpaid.data.every((row) => row.settlementStatus === "UNPAID")).toBe(true);
    expect(unpaid.summary.byCurrency).toEqual([{ currency: "EUR", count: 59, totalAmount: "59000.00", paidAmount: "0.00", outstandingAmount: "59000.00" }]);
  });

  const KINDS = [
    {
      kind: "invoices",
      seed: (tag: string, company: GroupCompany, count: number) => seedInvoices(tag, Array.from({ length: count }, () => ({ company }))),
      target: (id: string): Target => ({ invoiceId: id }),
      list: listInvoices,
    },
    {
      kind: "expenses",
      seed: (tag: string, company: GroupCompany, count: number) => seedExpenses(tag, Array.from({ length: count }, () => ({ company }))),
      target: (id: string): Target => ({ expenseId: id }),
      list: listExpenses,
    },
  ] as const;

  describe.each(KINDS)("FA-02 $kind", ({ seed, target, list }) => {
    it("finds every paid record in the company workspace and the Group workspace, counted and totalled in full", async () => {
      const inA = await seed("FA02", COMPANY.a, 60);
      const inB = await seed("FA02", COMPANY.b, 10);
      await pay([{ ...target(inA[39]!), amount: "1000.00" }]);
      await pay([{ ...target(inB[7]!), amount: "1000.00" }]);
      const search = "AUD01-FA02-";

      const company = await list(await finance(), { search, settlement: "PAID" });
      expect(company.data.map((row) => row.id)).toEqual([inA[39]]);
      expect(company.pagination.total).toBe(1);
      expect(company.summary.matchingCount).toBe(1);

      const group = await groupFinance();
      const across = await list(group, { search, settlement: "PAID" });
      expect(across.data.map((row) => row.id).sort()).toEqual([inA[39], inB[7]].sort());
      expect(across.data.map((row) => row.company?.id).sort()).toEqual([COMPANY.a, COMPANY.b]);
      expect(across.pagination.total).toBe(2);
      expect(across.summary.byCurrency).toEqual([{ currency: "EUR", count: 2, totalAmount: "2000.00", paidAmount: "2000.00", outstandingAmount: "0.00" }]);

      const onlyB = await list(group, { search, settlement: "PAID" }, COMPANY.b);
      expect(onlyB.data.map((row) => row.id)).toEqual([inB[7]]);
      expect(onlyB.summary.matchingCount).toBe(1);

      const unpaid = await list(group, { search, settlement: "UNPAID", limit: "100" });
      expect(unpaid.pagination.total).toBe(68);
      expect(unpaid.data).toHaveLength(68);
      expect(unpaid.data.every((row) => row.settlementStatus === "UNPAID")).toBe(true);
    });
  });
});

/* -------------------------------------------------------------------------- */
/* FA-03..FA-08: the canonical settlement rules                               */
/* -------------------------------------------------------------------------- */

describe("the settlement rules (FA-03..FA-08)", () => {
  it("FA-03 reads nothing, 40 and 100 paid on a 100 invoice as unpaid, partial and paid, in decimal strings", async () => {
    const [none, part, full] = await seedInvoices("FA03", [{ total: "100.00" }, { total: "100.00" }, { total: "100.00" }]);
    await pay([{ invoiceId: part!, amount: "40.00" }]);
    await pay([{ invoiceId: full!, amount: "100.00" }]);

    const result = await listInvoices(await finance(), { search: "AUD01-FA03-", sort: "number-asc" });
    expect(result.data.map((row) => ({ id: row.id, paid: row.paidAmount, outstanding: row.outstandingAmount, settlement: row.settlementStatus }))).toEqual([
      { id: none, paid: "0.00", outstanding: "100.00", settlement: "UNPAID" },
      { id: part, paid: "40.00", outstanding: "60.00", settlement: "PARTIALLY_PAID" },
      { id: full, paid: "100.00", outstanding: "0.00", settlement: "PAID" },
    ]);
    expect(result.summary.byCurrency).toEqual([{ currency: "EUR", count: 3, totalAmount: "300.00", paidAmount: "140.00", outstandingAmount: "160.00" }]);

    const [expenseNone, expensePart, expenseFull] = await seedExpenses("FA03", [{ total: "100.00" }, { total: "100.00" }, { total: "100.00" }]);
    await pay([{ expenseId: expensePart!, amount: "40.00" }]);
    await pay([{ expenseId: expenseFull!, amount: "100.00" }]);
    const costs = await listExpenses(await finance(), { search: "AUD01-FA03-", sort: "date-desc" });
    expect(Object.fromEntries(costs.data.map((row) => [row.id, [row.paidAmount, row.outstandingAmount, row.settlementStatus]]))).toEqual({
      [expenseNone!]: ["0.00", "100.00", "UNPAID"],
      [expensePart!]: ["40.00", "60.00", "PARTIALLY_PAID"],
      [expenseFull!]: ["100.00", "0.00", "PAID"],
    });
  });

  it("FA-04 files a partly paid, overdue sent invoice under Overdue with 60 outstanding, and not under Partially paid", async () => {
    const [overdue] = await seedInvoices("FA04", [{ total: "100.00", dueDate: day(-1) }]);
    await pay([{ invoiceId: overdue!, amount: "40.00" }]);
    const session = await finance();
    const search = "AUD01-FA04-";

    const row = (await listInvoices(session, { search })).data[0]!;
    expect(row).toMatchObject({ settlementStatus: "OVERDUE", status: "SENT", paidAmount: "40.00", outstandingAmount: "60.00" });
    expect((await listInvoices(session, { search, settlement: "PARTIALLY_PAID" })).pagination.total).toBe(0);
    expect((await listInvoices(session, { search, settlement: "OVERDUE" })).data.map((item) => item.id)).toEqual([overdue]);
    expect((await listInvoices(session, { search, settlement: "OVERDUE" })).summary.byCurrency[0]).toMatchObject({ outstandingAmount: "60.00" });
  });

  it("FA-05 keeps the due-date boundary exact, a past-due draft unpaid and an archived invoice out of Overdue", async () => {
    const at = FROZEN;
    const [before, equal, after, draft] = await seedInvoices("FA05", [
      { dueDate: new Date(at.getTime() - 1) },
      { dueDate: at },
      { dueDate: new Date(at.getTime() + 1) },
      { status: "DRAFT", dueDate: day(-20) },
    ]);
    const [archived] = await seedInvoices("FA05A", [{ status: "ARCHIVED", dueDate: day(-20) }]);
    const session = await finance();

    const rows = new Map((await listInvoices(session, { search: "AUD01-FA05-" })).data.map((row) => [row.id, row.settlementStatus]));
    expect(rows.get(before!)).toBe("OVERDUE");
    expect(rows.get(equal!)).toBe("UNPAID"); // equality is not overdue
    expect(rows.get(after!)).toBe("UNPAID");
    expect(rows.get(draft!)).toBe("UNPAID");
    expect((await listInvoices(session, { search: "AUD01-FA05-", settlement: "OVERDUE" })).data.map((row) => row.id)).toEqual([before]);

    // The archive is its own list, and an archived invoice is never overdue, whatever it was before.
    const archive = await listInvoices(session, { search: "AUD01-FA05A-", archived: "1" });
    expect(archive.data.map((row) => [row.id, row.settlementStatus])).toEqual([[archived, "UNPAID"]]);
    expect((await listInvoices(session, { search: "AUD01-FA05A-", archived: "1", settlement: "OVERDUE" })).pagination.total).toBe(0);
    // Active and archived never mix.
    expect((await listInvoices(session, { search: "AUD01-FA05A-" })).pagination.total).toBe(0);

    // One instant for the whole response: moved past the boundary, the equal one turns.
    const later = await invoices.listInvoicesForWorkspace(session, parseInvoiceQuery({ search: "AUD01-FA05-", settlement: "OVERDUE" }), { now: new Date(at.getTime() + 1) });
    expect(later.data.map((row) => row.id).sort()).toEqual([before, equal].sort());
    expect(later.summary.evaluatedAt).toBe(new Date(at.getTime() + 1).toISOString());
  });

  it("FA-06 counts nothing from a voided payment, a reversed allocation or money left unallocated, and reflects a correction on the next read", async () => {
    const [voided, reversed, unallocated, corrected] = await seedInvoices("FA06", [{ total: "100.00" }, { total: "100.00" }, { total: "100.00" }, { total: "100.00" }]);
    await pay([{ invoiceId: voided!, amount: "100.00" }], { status: "VOIDED" });
    await pay([{ invoiceId: reversed!, amount: "100.00", reversed: true }]);
    await pay([{ invoiceId: unallocated!, amount: "30.00" }], { paymentAmount: "100.00" });
    const live = await pay([{ invoiceId: corrected!, amount: "100.00" }]);
    const session = await finance();
    const search = "AUD01-FA06-";

    const before = new Map((await listInvoices(session, { search })).data.map((row) => [row.id, row.paidAmount]));
    expect(Object.fromEntries(before)).toEqual({ [voided!]: "0.00", [reversed!]: "0.00", [unallocated!]: "30.00", [corrected!]: "100.00" });
    expect((await listInvoices(session, { search, settlement: "PAID" })).data.map((row) => row.id)).toEqual([corrected]);

    // Through the real correction paths: the allocation reversed, then the payment voided.
    await prisma.$transaction((tx) => reverseAllocation(tx, session, live.allocationIds[0]!, "Allocated to the wrong invoice"));
    const afterReversal = await listInvoices(session, { search, settlement: "PAID" });
    expect(afterReversal.pagination.total).toBe(0);
    expect(afterReversal.summary).toEqual(empty());

    const [voidable] = await seedInvoices("FA06V", [{ total: "100.00", status: "SENT" }]);
    const paymentId = await payments.recordPayment(session, createPaymentSchema.parse({ invoiceId: voidable!, amount: "100.00", paymentDate: "2026-06-14", method: "BANK_TRANSFER" }));
    expect((await listInvoices(session, { search: "AUD01-FA06V-", settlement: "PAID" })).pagination.total).toBe(1);
    await payments.voidPayment(session, paymentId, "Bounced");
    const afterVoid = await listInvoices(session, { search: "AUD01-FA06V-" });
    expect(afterVoid.data[0]).toMatchObject({ paidAmount: "0.00", settlementStatus: "UNPAID" });
    expect(afterVoid.summary.byCurrency[0]).toMatchObject({ paidAmount: "0.00", outstandingAmount: "100.00" });
  });

  it("FA-07 gives each record of a split payment its own amount once, and an installment invoice its allocation once", async () => {
    const [first, second] = await seedInvoices("FA07", [{ total: "100.00" }, { total: "100.00" }]);
    await pay([
      { invoiceId: first!, amount: "30.00" },
      { invoiceId: second!, amount: "70.00" },
      { invoiceId: first!, amount: "20.00" },
    ]);
    const session = await finance();
    const rows = new Map((await listInvoices(session, { search: "AUD01-FA07-" })).data.map((row) => [row.id, row]));
    expect(rows.get(first!)).toMatchObject({ paidAmount: "50.00", outstandingAmount: "50.00" });
    expect(rows.get(second!)).toMatchObject({ paidAmount: "70.00", outstandingAmount: "30.00" });

    // The seeded deposit invoice is settled by an allocation naming it and its installment.
    const allocation = await prisma.paymentAllocation.findFirst({ where: { invoiceId: "invoice_sale_a201_deposit", installmentId: { not: null } }, select: { id: true } });
    expect(allocation, "the seed's installment invoice allocation").not.toBeNull();
    const detail = await invoices.getInvoice(session, "invoice_sale_a201_deposit");
    const found = (await invoices.listInvoicesForWorkspace(session, parseInvoiceQuery({ search: detail.invoiceNumber, limit: "100" }), { now: FROZEN })).data.find((row) => row.id === detail.id);
    expect(found?.paidAmount).toBe(detail.paidAmount);
    expect(found?.paidAmount).toBe((await paidByInvoice([detail.id])).get(detail.id)!.toFixed(2));
  });

  it("FA-08 classifies a zero-total invoice and an overpaid one as paid, keeps what was paid, and nets no debt away", async () => {
    const [zero, over, owing] = await seedInvoices("FA08", [{ total: "0.00" }, { total: "100.00" }, { total: "100.00" }]);
    await pay([{ invoiceId: over!, amount: "150.00" }]);
    const result = await listInvoices(await finance(), { search: "AUD01-FA08-", sort: "number-asc" });

    expect(result.data.map((row) => [row.id, row.paidAmount, row.outstandingAmount, row.settlementStatus])).toEqual([
      [zero, "0.00", "0.00", "PAID"],
      [over, "150.00", "0.00", "PAID"],
      [owing, "0.00", "100.00", "UNPAID"],
    ]);
    // Row-level outstanding summed: max(200 − 150, 0) would have said 50.
    expect(result.summary.byCurrency).toEqual([{ currency: "EUR", count: 3, totalAmount: "200.00", paidAmount: "150.00", outstandingAmount: "100.00" }]);
  });
});

/* -------------------------------------------------------------------------- */
/* FA-09..FA-12: filters, order, pages, currencies                             */
/* -------------------------------------------------------------------------- */

describe("filters, order and pages (FA-09..FA-12)", () => {
  it("FA-09 treats settlement values as either-or and every other filter as and-also, counting the whole set", async () => {
    const seeds: InvoiceSeed[] = [];
    const paidAt: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      seeds.push({
        total: "100.00",
        currency: index % 4 === 3 ? "USD" : "EUR",
        projectId: index % 5 === 4 ? null : PROJECT.a,
        issueDate: day(-(index % 20) - 1),
      });
      if (index % 3 !== 2) paidAt.push(index);
    }
    const ids = await seedInvoices("FA09", seeds);
    for (const index of paidAt) await pay([{ invoiceId: ids[index]!, amount: index % 2 === 0 ? "100.00" : "40.00" }]);

    const params = { search: "AUD01-FA09-", settlement: "PAID,PARTIALLY_PAID", currency: "EUR", projectId: PROJECT.a, issuedFrom: day(-15).toISOString().slice(0, 10), issuedTo: day(-3).toISOString().slice(0, 10) };
    const expected = ids.filter((id, index) => {
      const seed = seeds[index]!;
      const issued = seed.issueDate!.getTime();
      return paidAt.includes(index) && seed.currency === "EUR" && seed.projectId === PROJECT.a && issued >= day(-15).getTime() && issued <= day(-3).getTime();
    });
    expect(expected.length).toBeGreaterThan(3);

    const result = await listInvoices(await finance(), { ...params, limit: "100" });
    expect(result.data.map((row) => row.id).sort()).toEqual([...expected].sort());
    expect(result.pagination.total).toBe(expected.length);
    expect(result.summary.matchingCount).toBe(expected.length);
    expect(result.data.every((row) => ["PAID", "PARTIALLY_PAID"].includes(row.settlementStatus))).toBe(true);

    // Named twice, counted once; an unknown value dropped rather than widening anything.
    const repeated = parseInvoiceQuery({ settlement: "paid,PAID,partially_paid,bogus" });
    expect(repeated.settlement).toEqual(["PAID", "PARTIALLY_PAID"]);
  });

  it("FA-10 keeps a fixed order through equal dates, amounts and numbers, in one company and across the group", async () => {
    const same = { total: "500.00", issueDate: day(-5), dueDate: day(10) };
    // The same numbers in both companies: only the id tells two of them apart.
    const inA = await seedInvoices("FA10", Array.from({ length: 7 }, (_, index) => ({ ...same, number: `AUD01-FA10-A${index}` })));
    const inB = await seedInvoices("FA10", Array.from({ length: 7 }, (_, index) => ({ ...same, company: COMPANY.b, number: `AUD01-FA10-A${index}` })));
    const everything = [...inA, ...inB].sort();
    const group = await groupFinance();
    const session = await finance();

    for (const sort of INVOICE_SORT_KEYS) {
      const across = await allPages((page) => listInvoices(group, { search: "AUD01-FA10-", sort, limit: "3", page: String(page) }));
      expect(across.map((row) => row.id).sort(), sort).toEqual(everything);
      expect(new Set(across.map((row) => row.id)).size, sort).toBe(14);

      const own = await allPages((page) => listInvoices(session, { search: "AUD01-FA10-", sort, limit: "2", page: String(page) }));
      expect(own.map((row) => row.id).sort(), sort).toEqual([...inA].sort());
      // The same request twice reads the same page.
      const again = await listInvoices(group, { search: "AUD01-FA10-", sort, limit: "3", page: "2" });
      expect(again.data.map((row) => row.id)).toEqual(across.slice(3, 6).map((row) => row.id));
    }

    const expensesA = await seedExpenses("FA10", Array.from({ length: 5 }, () => ({ total: "80.00", expenseDate: day(-2) })));
    const expensesB = await seedExpenses("FA10", Array.from({ length: 5 }, (_, index) => ({ total: "80.00", expenseDate: day(-2), company: COMPANY.b, number: `AUD01-FA10-${String(index + 1).padStart(3, "0")}` })));
    const costs = await allPages((page) => listExpenses(group, { search: "AUD01-FA10-", limit: "3", page: String(page) }));
    expect(costs.map((row) => row.id).sort()).toEqual([...expensesA, ...expensesB].sort());
  });

  it("FA-11 answers a page past the end with the last real page, a bad page with the first, and no match with page 1 of nothing", async () => {
    const ids = await seedInvoices("FA11", Array.from({ length: 26 }, () => ({})));
    const session = await finance();
    const search = "AUD01-FA11-";

    const far = await listInvoices(session, { search, page: "999" });
    expect(far.pagination).toEqual({ page: 2, limit: 25, total: 26, totalPages: 2 });
    expect(far.data.map((row) => row.id)).toEqual([ids[25]]);

    for (const page of ["-3", "0", "abc"]) {
      const first = await listInvoices(session, { search, page });
      expect(first.pagination.page).toBe(1);
      expect(first.data).toHaveLength(25);
    }

    const none = await listInvoices(session, { search: "AUD01-NOTHING-", page: "4" });
    expect(none).toEqual({ data: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 1 }, summary: empty() });

    // Page 2's only row goes: page 2 is now page 1, with the 25 left — never an empty page 2.
    await prisma.invoice.delete({ where: { id: ids[25]! } });
    const recovered = await listInvoices(session, { search, page: "2" });
    expect(recovered.pagination).toEqual({ page: 1, limit: 25, total: 25, totalPages: 1 });
    expect(recovered.data).toHaveLength(25);
  });

  it("FA-12 totals each currency on its own and converts nothing", async () => {
    const [eur, all] = await seedInvoices("FA12", [{ total: "100.00", currency: "EUR" }, { total: "1000.00", currency: "ALL" }]);
    await pay([{ invoiceId: eur!, amount: "40.00" }]);
    await pay([{ invoiceId: all!, amount: "200.00" }]);

    const result = await listInvoices(await finance(), { search: "AUD01-FA12-" });
    expect(result.summary).toEqual({
      evaluatedAt: FROZEN.toISOString(),
      matchingCount: 2,
      byCurrency: [
        { currency: "ALL", count: 1, totalAmount: "1000.00", paidAmount: "200.00", outstandingAmount: "800.00" },
        { currency: "EUR", count: 1, totalAmount: "100.00", paidAmount: "40.00", outstandingAmount: "60.00" },
      ],
    });
    expect(result.summary.byCurrency.reduce((sum, group) => sum + group.count, 0)).toBe(result.pagination.total);
  });
});

/* -------------------------------------------------------------------------- */
/* FA-13: scope                                                                */
/* -------------------------------------------------------------------------- */

describe("scope in rows, counts and totals (FA-13)", () => {
  it("never lets a foreign company, project or client widen a list, and leaves a Finance-off company out of every total", async () => {
    await seedInvoices("FA13", [{ company: COMPANY.a }, { company: COMPANY.c }]);
    const session = await finance();
    const group = await groupFinance();
    const search = "AUD01-FA13-";

    expect((await listInvoices(session, { search, projectId: PROJECT.b })).summary).toEqual(empty());
    expect((await listInvoices(session, { search, clientId: "client_delta" })).summary).toEqual(empty());
    expect((await listInvoices(session, { search, projectId: "no_such_project" })).pagination.total).toBe(0);
    // A company the reader may not read — another group's — narrows to nothing, never to "all".
    expect((await listInvoices(group, { search }, COMPANY.tenant)).summary).toEqual(empty());
    expect((await listInvoices(group, { search }, "no_such_company")).summary).toEqual(empty());
    expect((await listInvoices(group, { search })).summary.matchingCount).toBe(2);

    const row = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.c, module: { key: "finance" } } });
    await prisma.companyModule.update({ where: { id: row.id }, data: { enabled: false } });
    restore.push(() => prisma.companyModule.update({ where: { id: row.id }, data: { enabled: true } }));
    const without = await listInvoices(await groupFinance(), { search });
    expect(without.data.map((item) => item.company?.id)).toEqual([COMPANY.a]);
    expect(without.summary.matchingCount).toBe(1);
  });

  it("keeps a project-scoped reader's totals to the records they may open", async () => {
    const candidates = await Promise.all((["LEGAL", "SALES", "CEO"] as const).map((role) => loginAs(role)));
    const scoped = candidates.find((context) => financeScopeKind(context) === "PROJECT");
    if (!scoped) {
      // Every role that reads invoices reads the whole company here: the rule is then the company boundary, covered above.
      expect(candidates.every((context) => financeScopeKind(context) === "COMPANY")).toBe(true);
      return;
    }
    await seedInvoices("FA13P", [{ projectId: null }, { projectId: PROJECT.a }]);
    const result = await listInvoices(scoped, { search: "AUD01-FA13P-", limit: "100" });
    expect(result.summary.matchingCount).toBe(result.data.length);
    expect(result.data.every((row) => row.project !== null)).toBe(true);
  });

  it("refuses a reader without the invoice or expense permission", async () => {
    for (const role of ["GROUP_IT", "HR"] as const) {
      const context = await loginAs(role);
      await expect(invoices.listInvoices(context, parseInvoiceQuery({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(expenses.listExpenses(context, parseExpenseQuery({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The database predicate and the domain classifier never disagree             */
/* -------------------------------------------------------------------------- */

describe("SQL and domain classifiers agree (AUD-01 §6)", () => {
  it("files every invoice the same way in the database filter as the row classifier does", async () => {
    const statuses: InvoiceStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "CANCELLED"];
    const paid = ["0.00", "40.00", "100.00", "150.00"];
    const due = [day(-1), FROZEN, day(1)];
    const seeds: InvoiceSeed[] = [];
    const payments: Array<string | null> = [];
    for (const status of statuses) for (const amount of paid) for (const dueDate of due) {
      seeds.push({ status, total: "100.00", dueDate });
      payments.push(amount === "0.00" ? null : amount);
    }
    const ids = await seedInvoices("PAR", seeds);
    for (const [index, amount] of payments.entries()) if (amount) await pay([{ invoiceId: ids[index]!, amount }]);
    const session = await finance();
    const search = "AUD01-PAR-";

    const rows = await prisma.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, totalAmount: true, dueDate: true } });
    const settled = await paidByInvoice(ids);
    const classified = new Map(
      rows.map((row) => {
        const settlement = settlementFor(row.totalAmount, settled.get(row.id));
        return [row.id, invoiceSettlement({ status: row.status, paid: settlement.paid, outstanding: settlement.outstanding, dueDate: row.dueDate, now: FROZEN })];
      }),
    );

    for (const value of ["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const) {
      const fromSql = (await listInvoices(session, { search, settlement: value, limit: "100" })).data.map((row) => row.id).sort();
      const fromDomain = ids.filter((id) => classified.get(id) === value).sort();
      expect(fromSql, value).toEqual(fromDomain);
      expect(fromDomain.length, `${value} is exercised`).toBeGreaterThan(0);
    }
    // Every row's own label is the classifier's.
    for (const row of (await listInvoices(session, { search, limit: "100" })).data) expect(row.settlementStatus).toBe(classified.get(row.id));
  });

  it("files every expense the same way", async () => {
    const statuses: ExpenseStatus[] = ["DRAFT", "APPROVED", "CANCELLED"];
    const seeds: ExpenseSeed[] = [];
    const amounts: Array<string | null> = [];
    for (const status of statuses) for (const amount of [null, "40.00", "100.00", "130.00"]) {
      seeds.push({ status, total: "100.00" });
      amounts.push(amount);
    }
    const ids = await seedExpenses("PAR", seeds);
    for (const [index, amount] of amounts.entries()) if (amount) await pay([{ expenseId: ids[index]!, amount }]);
    const settled = await paidByExpense(ids);
    const rows = await prisma.expense.findMany({ where: { id: { in: ids } }, select: { id: true, totalAmount: true } });
    const classified = new Map(rows.map((row) => [row.id, expenseSettlement(settlementFor(row.totalAmount, settled.get(row.id)))]));
    const session = await finance();

    for (const value of ["UNPAID", "PARTIALLY_PAID", "PAID"] as const) {
      const fromSql = (await listExpenses(session, { search: "AUD01-PAR-", settlement: value, limit: "100" })).data.map((row) => row.id).sort();
      expect(fromSql, value).toEqual(ids.filter((id) => classified.get(id) === value).sort());
    }
  });

  it("gives the settlement views the paid figure the domain helper gives, for every invoice and expense in the database", async () => {
    const [invoiceRows, expenseRows] = await Promise.all([
      prisma.invoiceSettlement.findMany({ select: { invoiceId: true, paidAmount: true, outstandingAmount: true, totalAmount: true } }),
      prisma.expenseSettlement.findMany({ select: { expenseId: true, paidAmount: true, outstandingAmount: true, totalAmount: true } }),
    ]);
    const invoicePaid = await paidByInvoice(invoiceRows.map((row) => row.invoiceId));
    const expensePaid = await paidByExpense(expenseRows.map((row) => row.expenseId));
    for (const row of invoiceRows) {
      const expected = settlementFor(row.totalAmount, invoicePaid.get(row.invoiceId));
      expect([row.paidAmount.toFixed(2), row.outstandingAmount.toFixed(2)], row.invoiceId).toEqual([expected.paid.toFixed(2), expected.outstanding.toFixed(2)]);
    }
    for (const row of expenseRows) {
      const expected = settlementFor(row.totalAmount, expensePaid.get(row.expenseId));
      expect([row.paidAmount.toFixed(2), row.outstandingAmount.toFixed(2)], row.expenseId).toEqual([expected.paid.toFixed(2), expected.outstanding.toFixed(2)]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* FA-18, FA-19: one snapshot, and failure is a failure                        */
/* -------------------------------------------------------------------------- */

describe("one snapshot per response (FA-18, FA-19)", () => {
  it("FA-18 keeps a read's totals and rows on the payments it started with, and shows a change on the next read", async () => {
    const [invoiceId] = await seedInvoices("FA18", [{ total: "100.00" }]);
    const [before, during] = await readRegisterSnapshot("invoices", async (tx) => {
      const first = await tx.invoiceSettlement.findUniqueOrThrow({ where: { invoiceId: invoiceId! } });
      // Another connection pays it in full while this read is still open.
      await pay([{ invoiceId: invoiceId!, amount: "100.00" }]);
      const second = await tx.invoiceSettlement.findUniqueOrThrow({ where: { invoiceId: invoiceId! } });
      return [first, second];
    });
    expect(before.paidAmount.toFixed(2)).toBe("0.00");
    expect(during.paidAmount.toFixed(2)).toBe("0.00");
    expect((await listInvoices(await finance(), { search: "AUD01-FA18-", settlement: "PAID" })).pagination.total).toBe(1);
  });

  it("reads only: a write inside the register's snapshot is refused", async () => {
    await expect(
      readRegisterSnapshot("invoices", (tx) => tx.invoice.updateMany({ where: { id: "nothing" }, data: { notes: "x" } })),
    ).rejects.toThrow(/read-only/i);
  });

  it("FA-19 fails a read that runs out of time instead of answering with less", async () => {
    await seedInvoices("FA19", Array.from({ length: 5 }, () => ({})));
    const session = await finance();
    const read = readInvoiceRegister([session], parseInvoiceQuery({ search: "AUD01-FA19-" }), {
      evaluatedAt: FROZEN,
      window: { kind: "page", page: 1, limit: 25 },
      timeoutMs: 1,
    });
    await expect(read).rejects.toThrow();
  });

  it("refuses totals built on an allocation from another company or in another currency, in the list and on the record", async () => {
    const [clean, broken] = await seedInvoices("FA3I", [{ total: "100.00" }, { total: "100.00" }]);
    await pay([{ invoiceId: clean!, amount: "100.00" }]);
    await pay([{ invoiceId: broken!, amount: "100.00" }], { currency: "USD" });
    const session = await finance();

    const failure = await listInvoices(session, { search: "AUD01-FA3I-" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AccessError);
    expect(failure).toMatchObject({ code: "INTERNAL_ERROR", details: { code: "SETTLEMENT_INTEGRITY" } });
    await expect(invoices.getInvoice(session, broken!)).rejects.toMatchObject({ details: { code: "SETTLEMENT_INTEGRITY" } });

    // Only the responses that hold it fail: the clean record still reads.
    expect((await listInvoices(session, { search: `AUD01-FA3I-001` })).summary.matchingCount).toBe(1);
    expect((await invoices.getInvoice(session, clean!)).paidAmount).toBe("100.00");
  });
});
