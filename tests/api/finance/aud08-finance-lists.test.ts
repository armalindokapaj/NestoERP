import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma as appPrisma } from "@/lib/database/prisma";
import * as commitments from "@/lib/modules/finance/commitments/commitment.service";
import { parseCommitmentQuery, parseInvoiceQuery, parsePaymentQuery } from "@/lib/modules/finance/finance.query";
import * as invoices from "@/lib/modules/finance/invoices/invoice.service";
import * as payments from "@/lib/modules/finance/payments/payment.service";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * AUD-08 on the finance lists (DT-02..DT-07, DT-22): payments, commitments and
 * the invoice register, against the real database and the real services the
 * pages and the API call.
 *
 * Every fixture carries the `aud08c2_` id prefix and an `AUD08C2-` reference the
 * test searches for, so each assertion is about exactly the rows it made. The
 * expected ids, counts and totals are written out by hand below — never read
 * back from the list under test (AUD-08 §9).
 */

const PREFIX = "aud08c2_fin";
const REF = "AUD08C2-PAY";
const MEMBER_A = "member_finance";
const MEMBER_B = "member_finance__b";

const at = (day: string) => new Date(`${day}T00:00:00.000Z`);

// Ids sort lexically in the order written, so an id tie-break is predictable by hand.
const PAY = {
  one: `${PREFIX}_pay_01`, // 2026-03-10  100.00 EUR  RECEIPT
  two: `${PREFIX}_pay_02`, // 2026-03-10  100.00 EUR  RECEIPT  (ties `one` on date and amount)
  three: `${PREFIX}_pay_03`, // 2026-03-10  250.00 USD  DISBURSEMENT
  four: `${PREFIX}_pay_04`, // 2026-03-12  100.00 EUR  RECEIPT
  five: `${PREFIX}_pay_05`, // 2026-03-08   50.00 ALL  RECEIPT
  foreign: `${PREFIX}_pay_09`, // company B, would be first by date
  late: `${PREFIX}_pay_10`, // inserted mid-read by the DT-06 barrier
};

async function removeFixtures() {
  await prisma.payment.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.commitment.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.invoice.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  const payment = (id: string, day: string, amount: string, currency: string, direction: "RECEIPT" | "DISBURSEMENT", companyId: string = COMPANY.a) => ({
    id,
    companyId,
    direction,
    amount: new Prisma.Decimal(amount),
    currency,
    paymentDate: at(day),
    method: "BANK_TRANSFER" as const,
    reference: `${REF}-${id.slice(-2)}`,
    // A receipt names who paid (the payments_receipt_names_client check).
    clientId: direction === "RECEIPT" ? (companyId === COMPANY.a ? "client_acme" : "client_delta") : null,
    createdByMemberId: companyId === COMPANY.a ? MEMBER_A : MEMBER_B,
  });
  await prisma.payment.createMany({
    data: [
      payment(PAY.one, "2026-03-10", "100.00", "EUR", "RECEIPT"),
      payment(PAY.two, "2026-03-10", "100.00", "EUR", "RECEIPT"),
      payment(PAY.three, "2026-03-10", "250.00", "USD", "DISBURSEMENT"),
      payment(PAY.four, "2026-03-12", "100.00", "EUR", "RECEIPT"),
      payment(PAY.five, "2026-03-08", "50.00", "ALL", "RECEIPT"),
      payment(PAY.foreign, "2026-03-20", "999.00", "EUR", "RECEIPT", COMPANY.b),
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await removeFixtures();
  await cleanupSessions();
  await prisma.$disconnect();
});

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

async function paymentPage(params: Record<string, string>) {
  const finance = await loginAs("FINANCE");
  return payments.listPayments(finance, parsePaymentQuery(new URLSearchParams({ search: REF, ...params })));
}

describe("payments (AUD-08 §3, §4)", () => {
  it("DT-04: newest first, a date tie broken by id, identical across every page", async () => {
    const expected = [[PAY.four, PAY.one], [PAY.two, PAY.three], [PAY.five]];
    for (const [index, page] of expected.entries()) {
      const result = await paymentPage({ sort: "date-desc", limit: "2", page: String(index + 1) });
      expect(ids(result.data)).toEqual(page);
      expect(result.pagination).toMatchObject({ page: index + 1, total: 5, totalPages: 3 });
    }
  });

  it("DT-04: the amount sort compares Decimal values and breaks an equal amount by id", async () => {
    const result = await paymentPage({ sort: "amount-asc", limit: "10" });
    expect(ids(result.data)).toEqual([PAY.five, PAY.one, PAY.two, PAY.four, PAY.three]);
  });

  it("DT-03: currency, direction and a one-day range combine (AND), counted before pagination", async () => {
    const result = await paymentPage({ currency: "EUR", direction: "RECEIPT", paidFrom: "2026-03-10", paidTo: "2026-03-10", limit: "1" });
    expect(result.pagination.total).toBe(2);
    expect(ids(result.data)).toEqual([PAY.one]);
    const second = await paymentPage({ currency: "EUR", direction: "RECEIPT", paidFrom: "2026-03-10", paidTo: "2026-03-10", limit: "1", page: "2" });
    expect(ids(second.data)).toEqual([PAY.two]);
  });

  it("DT-03: a direction list is OR within the filter", async () => {
    const result = await paymentPage({ direction: "RECEIPT,DISBURSEMENT", sort: "date-asc" });
    expect(ids(result.data)).toEqual([PAY.five, PAY.one, PAY.two, PAY.three, PAY.four]);
  });

  it("DT-05: a page past the end reads the last real page, and an empty result is page 1 of 1", async () => {
    const past = await paymentPage({ sort: "date-desc", limit: "2", page: "9" });
    expect(past.pagination).toMatchObject({ page: 3, total: 5, totalPages: 3 });
    expect(ids(past.data)).toEqual([PAY.five]);

    const none = await paymentPage({ currency: "JPY", page: "4" });
    expect(none.pagination).toMatchObject({ page: 1, total: 0, totalPages: 1 });
    expect(none.data).toEqual([]);
  });

  it("DT-22: another company's payment never appears, whatever it matches; its own company's reader sees it", async () => {
    const a = await paymentPage({ limit: "100" });
    expect(ids(a.data)).not.toContain(PAY.foreign);

    // Positive control: company B's own finance reader lists it (and only it).
    const inB = await loginAsMembership(MEMBER_B);
    expect(inB.companyId).toBe(COMPANY.b);
    const b = await payments.listPayments(inB, parsePaymentQuery(new URLSearchParams({ search: REF })));
    expect(ids(b.data)).toEqual([PAY.foreign]);
  });

  it("DT-06: a payment committed between the count and the page is in neither (one snapshot)", async () => {
    const finance = await loginAs("FINANCE");
    const original = appPrisma.$transaction.bind(appPrisma) as (...args: unknown[]) => Promise<unknown>;
    let inserted = false;

    // The barrier: the list's own transaction is held right after its count, while another
    // connection commits a payment that would sort first; then the page is read.
    vi.spyOn(appPrisma, "$transaction").mockImplementation(((run: unknown, options: unknown) => {
      if (typeof run !== "function") return original(run, options);
      return original(async (tx: Prisma.TransactionClient) => {
        const held = new Proxy(tx, {
          get(target, key, receiver) {
            const value = Reflect.get(target, key, receiver);
            if (key !== "payment") return value;
            return new Proxy(value as object, {
              get(delegate, op) {
                const fn = Reflect.get(delegate, op) as (...args: unknown[]) => Promise<unknown>;
                if (op !== "count") return typeof fn === "function" ? fn.bind(delegate) : fn;
                return async (...args: unknown[]) => {
                  const count = await fn.apply(delegate, args);
                  if (!inserted) {
                    inserted = true;
                    await prisma.payment.create({
                      data: {
                        id: PAY.late,
                        companyId: COMPANY.a,
                        direction: "RECEIPT",
                        amount: new Prisma.Decimal("10.00"),
                        currency: "EUR",
                        paymentDate: at("2026-04-01"),
                        method: "CASH",
                        reference: `${REF}-10`,
                        clientId: "client_acme",
                        createdByMemberId: MEMBER_A,
                      },
                    });
                  }
                  return count;
                };
              },
            });
          },
        });
        return (run as (tx: Prisma.TransactionClient) => Promise<unknown>)(held);
      }, options);
    }) as never);

    const during = await payments.listPayments(finance, parsePaymentQuery(new URLSearchParams({ search: REF, sort: "date-desc", limit: "2" })));
    vi.restoreAllMocks();

    expect(inserted).toBe(true);
    expect(during.pagination.total).toBe(5);
    expect(ids(during.data)).toEqual([PAY.four, PAY.one]);

    // Positive control: the row really committed, and the next read sees it first.
    const after = await payments.listPayments(finance, parsePaymentQuery(new URLSearchParams({ search: REF, sort: "date-desc", limit: "2" })));
    expect(after.pagination.total).toBe(6);
    expect(ids(after.data)).toEqual([PAY.late, PAY.four]);
    await prisma.payment.delete({ where: { id: PAY.late } });
  });
});

describe("commitments (AUD-08 §3, §4)", () => {
  const C = {
    noDate: `${PREFIX}_com_01`,
    early: `${PREFIX}_com_02`,
    tieA: `${PREFIX}_com_03`,
    tieB: `${PREFIX}_com_04`,
    archived: `${PREFIX}_com_05`,
    approved: `${PREFIX}_com_06`,
  };

  beforeAll(async () => {
    const row = (id: string, expectedDate: Date | null, status: "DRAFT" | "APPROVED" | "ARCHIVED" = "DRAFT") => ({
      id,
      companyId: COMPANY.a,
      projectId: PROJECT.a,
      description: `AUD08C2-COM ${id.slice(-2)}`,
      category: "MATERIALS" as const,
      currency: "EUR",
      amount: new Prisma.Decimal("500.00"),
      expectedDate,
      status,
      preArchiveStatus: status === "ARCHIVED" ? ("DRAFT" as const) : null,
      archivedAt: status === "ARCHIVED" ? at("2026-02-01") : null,
      createdByMemberId: MEMBER_A,
    });
    await prisma.commitment.createMany({
      data: [
        row(C.noDate, null),
        row(C.early, at("2026-05-01")),
        row(C.tieA, at("2026-06-01")),
        row(C.tieB, at("2026-06-01")),
        row(C.archived, at("2026-01-01"), "ARCHIVED"),
        row(C.approved, at("2026-07-01"), "APPROVED"),
      ],
    });
  });

  async function commitmentPage(params: Record<string, string>) {
    const finance = await loginAs("FINANCE");
    return commitments.listCommitments(finance, parseCommitmentQuery(new URLSearchParams({ search: "AUD08C2-COM", ...params })));
  }

  it("DT-04: a missing expected date goes last in both directions; a tie is broken by id", async () => {
    const asc = await commitmentPage({ sort: "expected-asc" });
    expect(ids(asc.data)).toEqual([C.early, C.tieA, C.tieB, C.approved, C.noDate]);
    const desc = await commitmentPage({ sort: "expected-desc" });
    expect(ids(desc.data)).toEqual([C.approved, C.tieA, C.tieB, C.early, C.noDate]);
    // The same order page by page.
    const pages = [await commitmentPage({ sort: "expected-asc", limit: "2" }), await commitmentPage({ sort: "expected-asc", limit: "2", page: "2" }), await commitmentPage({ sort: "expected-asc", limit: "2", page: "3" })];
    expect(pages.flatMap((page) => ids(page.data))).toEqual([C.early, C.tieA, C.tieB, C.approved, C.noDate]);
  });

  it("DT-02: the archive and Open sections are restrictions the address cannot lift", async () => {
    const active = await commitmentPage({});
    expect(ids(active.data)).not.toContain(C.archived);
    expect(active.pagination.total).toBe(5);

    const archived = await commitmentPage({ archived: "1", status: "DRAFT" });
    // The archive is its own dataset: a workflow status in the address does not apply to it.
    expect(ids(archived.data)).toEqual([C.archived]);

    const open = await commitmentPage({ open: "1", status: "DRAFT" });
    // Open means approved; a status in the address narrows within it (here: to nothing).
    expect(open.pagination.total).toBe(0);
    const openOnly = await commitmentPage({ open: "1" });
    expect(ids(openOnly.data)).toEqual([C.approved]);
  });
});

describe("the invoice register's totals (AUD-08 §4, DT-07)", () => {
  const I = { eurA: `${PREFIX}_inv_01`, eurB: `${PREFIX}_inv_02`, usd: `${PREFIX}_inv_03` };

  beforeAll(async () => {
    const row = (id: string, total: string, currency: string, day: string) => ({
      id,
      companyId: COMPANY.a,
      invoiceNumber: `AUD08C2-INV-${id.slice(-2)}`,
      clientId: "client_acme",
      projectId: PROJECT.a,
      issueDate: at(day),
      dueDate: at("2026-12-31"),
      currency,
      subtotal: total,
      taxAmount: "0.00",
      totalAmount: total,
      status: "SENT" as const,
      createdByMemberId: MEMBER_A,
    });
    await prisma.invoice.createMany({
      data: [row(I.eurA, "1000.10", "EUR", "2026-03-01"), row(I.eurB, "0.20", "EUR", "2026-03-02"), row(I.usd, "300.00", "USD", "2026-03-03")],
    });
  });

  it("filtered totals cover every match, grouped by currency in Decimal, while the page holds one row", async () => {
    const finance = await loginAs("FINANCE");
    const result = await invoices.listInvoicesForWorkspace(finance, parseInvoiceQuery(new URLSearchParams({ search: "AUD08C2-INV", limit: "1" })), {});
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(3);
    expect(result.summary.matchingCount).toBe(3);
    // Never one number across currencies: each currency its own exact total.
    expect(result.summary.byCurrency.map((group) => [group.currency, group.count, group.totalAmount])).toEqual([
      ["EUR", 2, "1000.30"],
      ["USD", 1, "300.00"],
    ]);
  });
});
