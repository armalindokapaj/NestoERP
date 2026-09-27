import { afterAll, afterEach, describe, expect, it } from "vitest";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import * as approvals from "@/lib/modules/procurement/approvals/approval.service";
import * as orders from "@/lib/modules/procurement/orders/order.service";
import * as quotes from "@/lib/modules/procurement/quotes/quote.service";
import * as receipts from "@/lib/modules/procurement/receipts/receipt.service";
import * as requests from "@/lib/modules/procurement/requests/request.service";
import * as rfqs from "@/lib/modules/procurement/rfqs/rfq.service";
import * as suppliers from "@/lib/modules/procurement/suppliers/supplier.service";
import { procurementOverview } from "@/lib/modules/procurement/overview/overview.service";
import { procurementReports } from "@/lib/modules/procurement/reports/reports.service";
import {
  orderListQuerySchema,
  requestListQuerySchema,
  rfqListQuerySchema,
  supplierListQuerySchema,
} from "@/lib/modules/procurement/procurement.schema";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, prisma } from "../../helpers";
import { shownCycle } from "../approvals/aud10-cycles";

/**
 * Procurement authorisation and lifecycle tests (PRD #19 §308–§340).
 *
 * These call the same services the pages and API routes call, so a passing test
 * is a statement about the running product rather than about a mock
 * (PRD #9 §223).
 *
 * The rules this module exists to hold:
 *   1. a request is an ask and an order is the commitment,
 *   2. nobody approves what they submitted,
 *   3. a supplier's price is confidential to the buying side,
 *   4. one selected quote per enquiry,
 *   5. receiving is derived from quantity, never clicked,
 *   6. another company is unreachable by every route in and out.
 */
const requestQuery = requestListQuerySchema.parse({ limit: 100 });
const orderQuery = orderListQuerySchema.parse({ limit: 100 });
const rfqQuery = rfqListQuerySchema.parse({ limit: 100 });
const supplierQuery = supplierListQuerySchema.parse({ limit: 100 });

const SEED = {
  draftRequest: "request_007",
  pendingRequest: "request_005",
  approvedRequest: "request_006",
  orderedRequest: "request_001",
  rejectedRequest: "request_008",
  issuedOrder: "order_004",
  partialOrder: "order_002",
  draftOrder: "order_010",
  pendingOrder: "order_009",
  approvedOrder: "order_011",
  closedOrder: "order_003",
  openRfq: "rfq_002",
  closedRfq: "rfq_001",
  draftRfq: "rfq_007",
  supplier: "supplier_atlas",
  archivedSupplier: "supplier_retired",
  companyBSupplier: "supplier_b_001",
  companyBRequest: "request_b_001",
  companyBOrder: "order_b_001",
} as const;

const TEST_PREFIX = "Vitest";

const created = { receipts: [] as string[], quotes: [] as string[], orders: [] as string[], rfqs: [] as string[], requests: [] as string[], suppliers: [] as string[] };

const touchedRequests: { id: string; status: string; approvedAt: Date | null; approvedByMemberId: string | null; rejectedAt: Date | null; rejectedByMemberId: string | null; rejectionReason: string | null; submittedAt: Date | null; cancelledAt: Date | null; archivedAt: Date | null }[] = [];
const touchedOrders: { id: string; status: string; approvedAt: Date | null; approvedByMemberId: string | null; issuedAt: Date | null; closedAt: Date | null; cancelledAt: Date | null; archivedAt: Date | null; financeCommitmentId: string | null }[] = [];
const touchedQuotes: { id: string; status: string }[] = [];
const touchedApprovals: { id: string }[] = [];
const touchedSuppliers: { id: string; status: string; archivedAt: Date | null }[] = [];

async function rememberRequest(id: string) {
  const row = await prisma.purchaseRequest.findUniqueOrThrow({
    where: { id },
    select: { status: true, approvedAt: true, approvedByMemberId: true, rejectedAt: true, rejectedByMemberId: true, rejectionReason: true, submittedAt: true, cancelledAt: true, archivedAt: true },
  });
  touchedRequests.push({ id, ...row });
}

async function rememberOrder(id: string) {
  const row = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id },
    select: { status: true, approvedAt: true, approvedByMemberId: true, issuedAt: true, closedAt: true, cancelledAt: true, archivedAt: true, financeCommitmentId: true },
  });
  touchedOrders.push({ id, ...row });
}


async function rememberQuote(id: string) {
  const row = await prisma.supplierQuote.findUniqueOrThrow({ where: { id }, select: { status: true } });
  touchedQuotes.push({ id, ...row });
}

async function rememberSupplier(id: string) {
  const row = await prisma.supplier.findUniqueOrThrow({
    where: { id },
    select: { status: true, archivedAt: true },
  });
  touchedSuppliers.push({ id, ...row });
}

afterEach(async () => {
  if (created.receipts.length > 0) {
    await prisma.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: { in: created.receipts } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: created.receipts } } });
    created.receipts.length = 0;
  }
  if (created.quotes.length > 0) {
    await prisma.supplierQuoteItem.deleteMany({ where: { supplierQuoteId: { in: created.quotes } } });
    await prisma.supplierQuote.deleteMany({ where: { id: { in: created.quotes } } });
    created.quotes.length = 0;
  }
  if (created.orders.length > 0) {
    await prisma.goodsReceiptItem.deleteMany({ where: { purchaseOrderItem: { purchaseOrderId: { in: created.orders } } } });
    await prisma.goodsReceipt.deleteMany({ where: { purchaseOrderId: { in: created.orders } } });
    await prisma.procurementApproval.deleteMany({ where: { recordId: { in: created.orders } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: created.orders } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created.orders } } });
    await prisma.commitment.deleteMany({ where: { sourceEntityId: { in: created.orders } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: created.orders } } });
    created.orders.length = 0;
  }
  if (created.rfqs.length > 0) {
    await prisma.supplierQuoteItem.deleteMany({ where: { supplierQuote: { rfqId: { in: created.rfqs } } } });
    await prisma.supplierQuote.deleteMany({ where: { rfqId: { in: created.rfqs } } });
    await prisma.rFQSupplier.deleteMany({ where: { rfqId: { in: created.rfqs } } });
    await prisma.rFQItem.deleteMany({ where: { rfqId: { in: created.rfqs } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created.rfqs } } });
    await prisma.rFQ.deleteMany({ where: { id: { in: created.rfqs } } });
    created.rfqs.length = 0;
  }
  if (created.requests.length > 0) {
    await prisma.procurementApproval.deleteMany({ where: { recordId: { in: created.requests } } });
    await prisma.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: { in: created.requests } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: created.requests } } });
    await prisma.purchaseRequest.deleteMany({ where: { id: { in: created.requests } } });
    created.requests.length = 0;
  }
  if (created.suppliers.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: created.suppliers } } });
    await prisma.supplier.deleteMany({ where: { id: { in: created.suppliers } } });
    created.suppliers.length = 0;
  }

  for (const row of touchedQuotes) {
    await prisma.supplierQuote.update({
      where: { id: row.id },
      data: { status: row.status as "RECEIVED", disqualificationReason: null },
    });
  }
  touchedQuotes.length = 0;


  for (const row of touchedOrders) {
    await prisma.purchaseOrder.update({
      where: { id: row.id },
      data: {
        status: row.status as "DRAFT",
        approvedAt: row.approvedAt,
        approvedByMemberId: row.approvedByMemberId,
        issuedAt: row.issuedAt,
        closedAt: row.closedAt,
        cancelledAt: row.cancelledAt,
        archivedAt: row.archivedAt,
        financeCommitmentId: row.financeCommitmentId,
        rejectedAt: null,
        rejectedByMemberId: null,
        rejectionReason: null,
        preArchiveStatus: null,
      },
    });
  }
  touchedOrders.length = 0;

  for (const row of touchedRequests) {
    await prisma.purchaseRequest.update({
      where: { id: row.id },
      data: {
        status: row.status as "DRAFT",
        approvedAt: row.approvedAt,
        approvedByMemberId: row.approvedByMemberId,
        rejectedAt: row.rejectedAt,
        rejectedByMemberId: row.rejectedByMemberId,
        rejectionReason: row.rejectionReason,
        submittedAt: row.submittedAt,
        cancelledAt: row.cancelledAt,
        archivedAt: row.archivedAt,
        preArchiveStatus: null,
      },
    });
  }
  touchedRequests.length = 0;

  for (const row of touchedSuppliers) {
    await prisma.supplier.update({
      where: { id: row.id },
      data: { status: row.status as "ACTIVE", archivedAt: row.archivedAt },
    });
  }
  touchedSuppliers.length = 0;

  for (const row of touchedApprovals) {
    await prisma.procurementApproval.update({
      where: { id: row.id },
      data: { status: "PENDING", decidedByMemberId: null, decidedAt: null, decisionNote: null },
    });
  }
  touchedApprovals.length = 0;

  /*
   * Approval cycles a test opened on a seeded record.
   *
   * Putting the record back is not enough: one pending cycle per record is the
   * rule, so a leftover cycle makes the next submit conflict (PRD #19 §213).
   */
  await prisma.procurementApproval.deleteMany({
    where: {
      recordId: { in: [SEED.draftRequest, SEED.draftOrder, SEED.rejectedRequest] },
      id: { startsWith: "c" },
    },
  });

  await prisma.activity.deleteMany({ where: { message: { contains: TEST_PREFIX } } });
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* §322–§326 Access                                                            */
/* -------------------------------------------------------------------------- */

describe("procurement access (PRD #19 §17, §322–§326)", () => {
  it("gives Procurement the whole buying book", async () => {
    const context = await loginAs("PROCUREMENT");
    const result = await requests.listRequests(context, requestQuery);
    expect(result.data.length).toBeGreaterThanOrEqual(19);
  });

  it("refuses Group IT by default (PRD #19 §332, §333)", async () => {
    const context = await loginAs("GROUP_IT");
    expect(can(context, "procurement.request.view")).toBe(false);
    await expect(requests.listRequests(context, requestQuery)).rejects.toBeInstanceOf(AccessError);
    // The Platform Admin has no company membership to reach it from at all.
    await expect(loginAs("PLATFORM_ADMIN")).rejects.toThrow();
  });

  it("narrows a Project Manager to their own jobs and asks (PRD #19 §218)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const buyer = await loginAs("PROCUREMENT");

    const mine = await requests.listRequests(pm, requestQuery);
    const all = await requests.listRequests(buyer, requestQuery);

    expect(mine.data.length).toBeLessThan(all.data.length);
    for (const row of mine.data) {
      const ownJob = row.project !== null;
      const ownAsk = row.requestedBy.memberId === pm.membershipId;
      expect(ownJob || ownAsk).toBe(true);
    }
  });

  it("answers not found for a record out of scope (PRD #19 §223)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const reachable = new Set(
      (await requests.listRequests(pm, requestQuery)).data.map((row) => row.id),
    );

    const hidden = await prisma.purchaseRequest.findFirst({
      where: { companyId: pm.companyId, id: { notIn: [...reachable] } },
      select: { id: true },
    });
    if (!hidden) return;

    await expect(requests.getRequest(pm, hidden.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps the supplier directory company-wide (PRD #19 §222)", async () => {
    // A supplier carries no per-project confidentiality: knowing the company
    // buys from Atlas is not knowing what it paid.
    const pm = await loginAs("PROJECT_MANAGER");
    if (!can(pm, "procurement.supplier.view")) return;

    const list = await suppliers.listSuppliers(pm, supplierQuery);
    expect(list.data.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §260 Quote confidentiality                                                  */
/* -------------------------------------------------------------------------- */

describe("supplier prices are confidential (PRD #19 §260, §261)", () => {
  it("omits the pricing entirely without procurement.quote.view", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    if (can(pm, "procurement.quote.view")) return;

    const comparison = await quotes.compareQuotes(pm, SEED.closedRfq).catch(() => null);
    if (!comparison) return;

    expect(comparison.canCompare).toBe(false);
    for (const row of comparison.rows) {
      // null, not an object of nulls: a blank where a figure belongs still
      // tells the reader a number is being withheld.
      expect(row.pricing).toBeNull();
      expect(row.priceRank).toBeNull();
      expect(row.isLowest).toBe(false);
    }
  });

  it("shows the buyer the prices and the ranking", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const comparison = await quotes.compareQuotes(buyer, SEED.closedRfq);

    expect(comparison.canCompare).toBe(true);
    expect(comparison.rows.length).toBeGreaterThan(1);
    // Money crosses as a decimal string so no JSON parser rounds a quote.
    for (const row of comparison.rows) {
      if (row.pricing) expect(typeof row.pricing.totalAmount).toBe("string");
    }
  });

  it("ranks only the qualified answers (PRD #19 §91)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const comparison = await quotes.compareQuotes(buyer, SEED.closedRfq);

    const disqualified = comparison.rows.filter((row) => row.status === "DISQUALIFIED");
    expect(disqualified.length).toBeGreaterThan(0);
    for (const row of disqualified) {
      // Shown so the record is complete, but not competing.
      expect(row.priceRank).toBeNull();
      expect(row.isLowest).toBe(false);
    }

    const lowest = comparison.rows.filter((row) => row.isLowest);
    expect(lowest).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* §309–§311 Requests                                                          */
/* -------------------------------------------------------------------------- */

describe("purchase requests (PRD #19 §309–§311)", () => {
  async function draft(context: Awaited<ReturnType<typeof loginAs>>, overrides = {}) {
    const request = await requests.createRequest(context, {
      title: `${TEST_PREFIX} request`,
      priority: "MEDIUM",
      currency: "EUR",
      items: [
        { description: `${TEST_PREFIX} line`, quantity: "10", unit: "each", estimatedUnitPrice: "25.50" },
      ],
      ...overrides,
    } as Parameters<typeof requests.createRequest>[1]);
    created.requests.push(request.id);
    return request;
  }

  it("starts as a draft and numbers itself (PRD #19 §44, §46)", async () => {
    const context = await loginAs("PROCUREMENT");
    const request = await draft(context);

    expect(request.status).toBe("DRAFT");
    expect(request.requestNumber).toMatch(/^PR-\d{4}-\d{4}$/);
  });

  it("numbers one request after another in a company the seed filled (PRD #19 §44)", async () => {
    // The series is read as text: a seeded number in any other shape (PR-2026-020) would sort above the
    // product's own (PR-2026-0021) and the second new request would be given the first one's number again.
    const context = await loginAs("PROCUREMENT");
    const first = await draft(context);
    const second = await draft(context);
    const sequence = (number: string) => Number(number.slice(-4));
    expect(second.requestNumber).not.toBe(first.requestNumber);
    expect(sequence(second.requestNumber)).toBeGreaterThan(sequence(first.requestNumber));
  });

  it("computes the estimate from the lines, never from the client (PRD #19 §49)", async () => {
    const context = await loginAs("PROCUREMENT");
    const request = await draft(context, {
      items: [
        { description: `${TEST_PREFIX} a`, quantity: "10", unit: "each", estimatedUnitPrice: "25.50" },
        { description: `${TEST_PREFIX} b`, quantity: "4", unit: "each", estimatedUnitPrice: "100" },
      ],
    });

    // 10 × 25.50 + 4 × 100 = 655.00
    expect(request.estimatedTotal).toBe("655.00");
  });

  it("leaves an unpriced line out of the estimate rather than counting it as free", async () => {
    const context = await loginAs("PROCUREMENT");
    const request = await draft(context, {
      items: [
        { description: `${TEST_PREFIX} priced`, quantity: "2", unit: "each", estimatedUnitPrice: "50" },
        { description: `${TEST_PREFIX} unpriced`, quantity: "99", unit: "each" },
      ],
    });

    expect(request.estimatedTotal).toBe("100.00");
    expect(request.items).toHaveLength(2);
  });

  it("refuses a project the caller cannot open (PRD #19 §53)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const unreachable = await prisma.project.findFirst({
      where: { companyId: COMPANY.tenant },
      select: { id: true },
    });
    if (!unreachable) return;

    await expect(
      requests.createRequest(pm, {
        title: `${TEST_PREFIX} out of scope`,
        priority: "MEDIUM",
        projectId: unreachable.id,
        items: [{ description: "x", quantity: "1", unit: "each" }],
      } as Parameters<typeof requests.createRequest>[1]),
    ).rejects.toMatchObject({ details: { code: "INVALID_PROJECT" } });
  });

  it("freezes the lines once approved (PRD #19 §55)", async () => {
    const context = await loginAs("PROCUREMENT");
    const approved = await requests.getRequest(context, SEED.approvedRequest);
    expect(approved.capabilities.canEdit).toBe(false);

    await expect(
      requests.updateRequest(context, SEED.approvedRequest, {
        title: "Rewritten after approval",
        priority: "MEDIUM",
        items: [{ description: "x", quantity: "1", unit: "each" }],
      } as Parameters<typeof requests.updateRequest>[2]),
    ).rejects.toBeInstanceOf(AccessError);
  });

  it("walks draft → approval → approved (PRD #19 §56, §57)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const ceo = await loginAs("CEO");
    await rememberRequest(SEED.draftRequest);

    await requests.submitRequest(buyer, SEED.draftRequest);
    expect((await requests.getRequest(buyer, SEED.draftRequest)).status).toBe("PENDING_APPROVAL");

    await requests.approveRequest(ceo, SEED.draftRequest, "Agreed.", await shownCycle("procurement", SEED.draftRequest));
    expect((await requests.getRequest(buyer, SEED.draftRequest)).status).toBe("APPROVED");
  });

  it("blocks self-approval and hides the buttons from the submitter (PRD #19 §21)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    // The seed's pending approvals were all submitted by Procurement.
    const own = await requests.getRequest(buyer, SEED.pendingRequest);
    expect(own.status).toBe("PENDING_APPROVAL");
    expect(own.capabilities.canApprove).toBe(false);
    expect(own.capabilities.canReject).toBe(false);

    if (can(buyer, "procurement.request.approve")) {
      await expect(
        requests.approveRequest(buyer, SEED.pendingRequest, null, await shownCycle("procurement", SEED.pendingRequest)),
      ).rejects.toBeInstanceOf(AccessError);
    }

    const ceo = await loginAs("CEO");
    const decider = await requests.getRequest(ceo, SEED.pendingRequest);
    expect(decider.capabilities.canApprove).toBe(true);
  });

  it("decides once (PRD #19 §154, §213)", async () => {
    const ceo = await loginAs("CEO");
    await rememberRequest(SEED.pendingRequest);
    touchedApprovals.push({ id: "procurement_approval_001" });

    await requests.approveRequest(ceo, SEED.pendingRequest, "Agreed.", await shownCycle("procurement", SEED.pendingRequest));
    await expect(requests.approveRequest(ceo, SEED.pendingRequest, null, await shownCycle("procurement", SEED.pendingRequest))).rejects.toBeInstanceOf(
      AccessError,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* §312–§314 Enquiries and quotes                                              */
/* -------------------------------------------------------------------------- */

describe("enquiries and quotes (PRD #19 §312–§314)", () => {
  it("refuses to issue an enquiry with fewer than two suppliers (PRD #19 §72)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const rfq = await rfqs.createRfq(buyer, {
      title: `${TEST_PREFIX} single supplier`,
      currency: "EUR",
      supplierIds: [SEED.supplier],
      items: [{ description: `${TEST_PREFIX} line`, quantity: "5", unit: "each" }],
    } as Parameters<typeof rfqs.createRfq>[1]);
    created.rfqs.push(rfq.id);

    await expect(rfqs.issueRfq(buyer, rfq.id)).rejects.toMatchObject({
      details: { code: "RFQ_TOO_FEW_SUPPLIERS" },
    });
  });

  it("issues with two, and fixes the lines afterwards (PRD #19 §73, §74)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const rfq = await rfqs.createRfq(buyer, {
      title: `${TEST_PREFIX} two suppliers`,
      currency: "EUR",
      supplierIds: [SEED.supplier, "supplier_nordsteel"],
      items: [{ description: `${TEST_PREFIX} line`, quantity: "5", unit: "each" }],
    } as Parameters<typeof rfqs.createRfq>[1]);
    created.rfqs.push(rfq.id);

    await rfqs.issueRfq(buyer, rfq.id);
    const issued = await rfqs.getRfq(buyer, rfq.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.capabilities.canEdit).toBe(false);

    await expect(
      rfqs.updateRfq(buyer, rfq.id, {
        title: `${TEST_PREFIX} changed after issue`,
        currency: "EUR",
        supplierIds: [SEED.supplier, "supplier_nordsteel"],
        items: [{ description: "different", quantity: "9", unit: "each" }],
      } as Parameters<typeof rfqs.updateRfq>[2]),
    ).rejects.toMatchObject({ details: { code: "RFQ_NOT_EDITABLE" } });
  });

  it("refuses a quote from a supplier nobody invited (PRD #19 §67)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const rfq = await rfqs.getRfq(buyer, SEED.openRfq);
    const invited = new Set(rfq.suppliers.map((entry) => entry.supplier.id));

    const outsider = await prisma.supplier.findFirst({
      where: { companyId: buyer.companyId, status: "ACTIVE", id: { notIn: [...invited] } },
      select: { id: true },
    });
    if (!outsider) return;

    await expect(
      quotes.createQuote(buyer, SEED.openRfq, {
        supplierId: outsider.id,
        quoteDate: new Date(),
        items: rfq.items.map((item) => ({
          rfqItemId: item.id,
          quantity: item.quantity,
          unitPrice: "10",
          taxRate: "0.2",
        })),
      } as Parameters<typeof quotes.createQuote>[2]),
    ).rejects.toMatchObject({ details: { code: "SUPPLIER_NOT_INVITED" } });
  });

  it("prices a quote from its lines, in the enquiry's currency (PRD #19 §82, §83)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const rfq = await rfqs.getRfq(buyer, SEED.openRfq);
    const waiting = rfq.suppliers.find((entry) => entry.quoteId === null);
    if (!waiting) return;

    const quote = await quotes.createQuote(buyer, SEED.openRfq, {
      supplierId: waiting.supplier.id,
      quoteDate: new Date(),
      items: [
        { rfqItemId: rfq.items[0]!.id, quantity: "10", unitPrice: "12.50", taxRate: "0.2" },
      ],
    } as Parameters<typeof quotes.createQuote>[2]);
    created.quotes.push(quote.id);

    expect(quote.status).toBe("RECEIVED");
    expect(quote.pricing!.currency).toBe(rfq.currency);
    expect(quote.pricing!.subtotal).toBe("125.00");
    expect(quote.pricing!.totalAmount).toBe("150.00");
  });

  it("allows one selected quote per enquiry (PRD #19 §94, §211)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const comparison = await quotes.compareQuotes(buyer, SEED.closedRfq);
    const selected = comparison.rows.find((row) => row.status === "SELECTED");
    expect(selected).toBeDefined();

    const other = comparison.rows.find((row) => row.status === "NOT_SELECTED");
    if (!other) return;

    // Already decided: the runner-up cannot be selected without undoing the first.
    await expect(quotes.selectQuote(buyer, other.quoteId)).rejects.toBeInstanceOf(AccessError);
  });

  it("marks every other qualified answer not selected when one wins", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const comparison = await quotes.compareQuotes(buyer, SEED.openRfq);
    const candidates = comparison.rows.filter((row) => row.status === "RECEIVED");
    if (candidates.length < 2) return;

    for (const row of candidates) await rememberQuote(row.quoteId);

    await quotes.selectQuote(buyer, candidates[0]!.quoteId);
    const after = await quotes.compareQuotes(buyer, SEED.openRfq);

    expect(after.rows.filter((row) => row.status === "SELECTED")).toHaveLength(1);
    for (const row of after.rows) {
      if (row.quoteId !== candidates[0]!.quoteId && candidates.some((c) => c.quoteId === row.quoteId)) {
        expect(row.status).toBe("NOT_SELECTED");
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* §315–§319 Orders and the Finance commitment                                 */
/* -------------------------------------------------------------------------- */

describe("purchase orders (PRD #19 §315–§319)", () => {
  it("computes totals from the lines (PRD #19 §105)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const order = await orders.createOrder(buyer, {
      supplierId: SEED.supplier,
      orderDate: new Date(),
      currency: "EUR",
      items: [
        { description: `${TEST_PREFIX} a`, quantity: "10", unit: "each", unitPrice: "12.50", taxRate: "0.2" },
        { description: `${TEST_PREFIX} b`, quantity: "2", unit: "each", unitPrice: "100", taxRate: "0.2" },
      ],
    } as Parameters<typeof orders.createOrder>[1]);
    created.orders.push(order.id);

    // 125 + 200 = 325 subtotal; 20% tax = 65; total 390.
    expect(order.subtotal).toBe("325.00");
    expect(order.taxAmount).toBe("65.00");
    expect(order.totalAmount).toBe("390.00");
    expect(order.status).toBe("DRAFT");
    expect(order.poNumber).toMatch(/^PO-\d{4}-\d{4}$/);
  });

  it("refuses an inactive supplier (PRD #19 §28)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    await expect(
      orders.createOrder(buyer, {
        supplierId: SEED.archivedSupplier,
        orderDate: new Date(),
        currency: "EUR",
        items: [{ description: "x", quantity: "1", unit: "each", unitPrice: "1", taxRate: "0" }],
      } as Parameters<typeof orders.createOrder>[1]),
    ).rejects.toMatchObject({ details: { code: "INVALID_SUPPLIER" } });
  });

  it("commits the money when it is approved, once (PRD #19 §116, §121)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const ceo = await loginAs("CEO");

    const order = await orders.createOrder(buyer, {
      supplierId: SEED.supplier,
      projectId: "project_a",
      orderDate: new Date(),
      currency: "EUR",
      items: [{ description: `${TEST_PREFIX} committed`, quantity: "4", unit: "each", unitPrice: "250", taxRate: "0" }],
    } as Parameters<typeof orders.createOrder>[1]);
    created.orders.push(order.id);

    await orders.submitOrder(buyer, order.id);
    await orders.approveOrder(ceo, order.id, "Agreed.", await shownCycle("procurement", order.id));

    const approved = await orders.getOrder(buyer, order.id);
    expect(approved.status).toBe("APPROVED");

    const commitments = await prisma.commitment.findMany({
      where: { sourceModule: "procurement", sourceEntityId: order.id },
      select: { id: true, amount: true, counterpartyName: true, status: true },
    });

    // Exactly one, for the order total, naming a snapshot of the supplier.
    expect(commitments).toHaveLength(1);
    expect(commitments[0]!.amount.toString()).toBe("1000");
    expect(commitments[0]!.counterpartyName).toBe("Atlas Materials");
    expect(commitments[0]!.status).toBe("APPROVED");
  });

  it("releases the commitment when the order is cancelled (PRD #19 §128)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const ceo = await loginAs("CEO");

    const order = await orders.createOrder(buyer, {
      supplierId: SEED.supplier,
      orderDate: new Date(),
      currency: "EUR",
      items: [{ description: `${TEST_PREFIX} cancelled`, quantity: "1", unit: "each", unitPrice: "500", taxRate: "0" }],
    } as Parameters<typeof orders.createOrder>[1]);
    created.orders.push(order.id);

    await orders.submitOrder(buyer, order.id);
    await orders.approveOrder(ceo, order.id, null, await shownCycle("procurement", order.id));
    await orders.cancelOrder(buyer, order.id, "No longer needed.");

    const commitment = await prisma.commitment.findFirst({
      where: { sourceEntityId: order.id },
      select: { status: true },
    });
    expect(commitment?.status).toBe("CANCELLED");
  });

  it("will not cancel an order that has already been delivered against (PRD #19 §129)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    // order_002 is PARTIALLY_RECEIVED in the seed.
    await expect(orders.cancelOrder(buyer, SEED.partialOrder, "x")).rejects.toBeInstanceOf(
      AccessError,
    );
  });

  it("blocks self-approval on an order too (PRD #19 §21)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const own = await orders.getOrder(buyer, SEED.pendingOrder);
    expect(own.status).toBe("PENDING_APPROVAL");
    expect(own.capabilities.canApprove).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* §320, §321 Receipts                                                         */
/* -------------------------------------------------------------------------- */

describe("goods receipts (PRD #19 §320, §321)", () => {
  it("derives the order status from what has arrived (PRD #19 §141)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    await rememberOrder(SEED.issuedOrder);

    const before = await orders.getOrder(buyer, SEED.issuedOrder);
    expect(before.status).toBe("ISSUED");

    const half = (Number.parseFloat(before.items[0]!.quantity) / 2).toString();
    const receipt = await receipts.recordReceipt(buyer, SEED.issuedOrder, {
      receiptDate: new Date(),
      items: [
        { purchaseOrderItemId: before.items[0]!.id, receivedQuantity: half, rejectedQuantity: "0" },
      ],
      acknowledgeOverReceipt: false,
    } as Parameters<typeof receipts.recordReceipt>[2]);
    created.receipts.push(receipt.id);

    const after = await orders.getOrder(buyer, SEED.issuedOrder);
    expect(after.status).toBe("PARTIALLY_RECEIVED");
    expect(after.receivedFraction).toBeGreaterThan(0);
    expect(after.receivedFraction).toBeLessThan(1);
  });

  it("asks before recording more than was ordered (PRD #19 §139)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    await rememberOrder(SEED.issuedOrder);
    const order = await orders.getOrder(buyer, SEED.issuedOrder);

    const tooMuch = (Number.parseFloat(order.items[0]!.quantity) * 2).toString();

    await expect(
      receipts.recordReceipt(buyer, SEED.issuedOrder, {
        receiptDate: new Date(),
        items: [
          { purchaseOrderItemId: order.items[0]!.id, receivedQuantity: tooMuch, rejectedQuantity: "0" },
        ],
        acknowledgeOverReceipt: false,
      } as Parameters<typeof receipts.recordReceipt>[2]),
    ).rejects.toMatchObject({ details: { code: "OVER_RECEIPT" } });

    // Confirmed, it records: the goods are on site either way.
    const receipt = await receipts.recordReceipt(buyer, SEED.issuedOrder, {
      receiptDate: new Date(),
      items: [
        { purchaseOrderItemId: order.items[0]!.id, receivedQuantity: tooMuch, rejectedQuantity: "0" },
      ],
      acknowledgeOverReceipt: true,
    } as Parameters<typeof receipts.recordReceipt>[2]);
    created.receipts.push(receipt.id);

    expect((await orders.getOrder(buyer, SEED.issuedOrder)).status).toBe("RECEIVED");
  });

  it("derives accepted from received less rejected (PRD #19 §134)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    await rememberOrder(SEED.issuedOrder);
    const order = await orders.getOrder(buyer, SEED.issuedOrder);

    const receipt = await receipts.recordReceipt(buyer, SEED.issuedOrder, {
      receiptDate: new Date(),
      items: [
        { purchaseOrderItemId: order.items[0]!.id, receivedQuantity: "10", rejectedQuantity: "3" },
      ],
      acknowledgeOverReceipt: true,
    } as Parameters<typeof receipts.recordReceipt>[2]);
    created.receipts.push(receipt.id);

    expect(receipt.items[0]!.receivedQuantity).toBe("10");
    expect(receipt.items[0]!.rejectedQuantity).toBe("3");
    expect(receipt.items[0]!.acceptedQuantity).toBe("7");
  });

  it("refuses goods against an order the supplier has not been sent (PRD #19 §135)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const draft = await orders.getOrder(buyer, SEED.draftOrder);

    await expect(
      receipts.recordReceipt(buyer, SEED.draftOrder, {
        receiptDate: new Date(),
        items: [
          { purchaseOrderItemId: draft.items[0]!.id, receivedQuantity: "1", rejectedQuantity: "0" },
        ],
        acknowledgeOverReceipt: false,
      } as Parameters<typeof receipts.recordReceipt>[2]),
    ).rejects.toMatchObject({ details: { code: "ORDER_NOT_RECEIVING" } });
  });

  it("voids rather than edits, and the order re-derives (PRD #19 §143, §144)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    await rememberOrder(SEED.issuedOrder);
    const order = await orders.getOrder(buyer, SEED.issuedOrder);

    const receipt = await receipts.recordReceipt(buyer, SEED.issuedOrder, {
      receiptDate: new Date(),
      items: [
        {
          purchaseOrderItemId: order.items[0]!.id,
          receivedQuantity: order.items[0]!.quantity,
          rejectedQuantity: "0",
        },
      ],
      acknowledgeOverReceipt: false,
    } as Parameters<typeof receipts.recordReceipt>[2]);
    created.receipts.push(receipt.id);

    // There is no edit at all.
    expect(receipt.capabilities.canEdit).toBe(false);
    expect((await orders.getOrder(buyer, SEED.issuedOrder)).status).toBe("RECEIVED");

    await receipts.voidReceipt(buyer, receipt.id, "Recorded against the wrong order.");

    const after = await orders.getOrder(buyer, SEED.issuedOrder);
    expect(after.status).toBe("ISSUED");
    expect(after.receivedFraction).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §308 Suppliers                                                              */
/* -------------------------------------------------------------------------- */

describe("suppliers (PRD #19 §308)", () => {
  it("warns about a duplicate rather than blocking it (PRD #19 §31)", async () => {
    const buyer = await loginAs("PROCUREMENT");

    const duplicates = await suppliers.findSupplierDuplicates(buyer, {
      name: "Atlas Materials",
    });
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0]!.reason).toBe("NAME");

    // And the create still goes through: two suppliers can share a trading name.
    const created2 = await suppliers.createSupplier(buyer, {
      name: "Atlas Materials",
      supplierType: "COMPANY",
      status: "ACTIVE",
    } as Parameters<typeof suppliers.createSupplier>[1]);
    created.suppliers.push(created2.id);
    expect(created2.name).toBe("Atlas Materials");
  });

  it("refuses a duplicate supplier code (PRD #19 §29)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    await expect(
      suppliers.createSupplier(buyer, {
        name: `${TEST_PREFIX} clash`,
        code: "SUP-001",
        supplierType: "COMPANY",
        status: "ACTIVE",
      } as Parameters<typeof suppliers.createSupplier>[1]),
    ).rejects.toMatchObject({ details: { code: "SUPPLIER_CODE_TAKEN" } });
  });

  it("will not archive a supplier with orders still running (PRD #19 §37)", async () => {
    const buyer = await loginAs("PROCUREMENT");

    // Remembered even though the archive is expected to fail: if it ever
    // succeeds the assertion below catches it, and without this the supplier
    // would stay archived and poison every later run.
    await rememberSupplier("supplier_buildpro");

    // supplier_buildpro has an ISSUED order in the seed.
    await expect(suppliers.archiveSupplier(buyer, "supplier_buildpro")).rejects.toMatchObject({
      details: { code: "SUPPLIER_HAS_OPEN_ORDERS" },
    });
  });

  it("restores an archived supplier as inactive rather than active", async () => {
    const buyer = await loginAs("PROCUREMENT");
    await rememberSupplier(SEED.archivedSupplier);

    await suppliers.restoreSupplier(buyer, SEED.archivedSupplier);
    const restored = await suppliers.getSupplier(buyer, SEED.archivedSupplier);

    // Coming out of the archive is not the same decision as being ready to buy
    // from again.
    expect(restored.status).toBe("INACTIVE");
    expect(restored.archivedAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* §338–§340 Leaks and reports                                                 */
/* -------------------------------------------------------------------------- */

describe("search, filters and reports (PRD #19 §338–§340)", () => {
  it("does not let search reach outside scope (PRD #19 §257)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const reachable = new Set(
      (await requests.listRequests(pm, requestQuery)).data.map((row) => row.id),
    );

    const hit = await requests.listRequests(
      pm,
      requestListQuerySchema.parse({ search: "Office IT refresh", limit: 50 }),
    );
    for (const row of hit.data) expect(reachable.has(row.id)).toBe(true);
  });

  it("does not offer filter options the reader cannot open (PRD #19 §258)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const options = await requests.requestFilterOptions(pm);
    const reachable = new Set(
      (await requests.listRequests(pm, requestQuery)).data.map((row) => row.project?.id),
    );
    for (const project of options.projects) expect(reachable.has(project.id)).toBe(true);
  });

  it("never sums two currencies (PRD #19 §190)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const overview = await procurementOverview(buyer);
    if (!overview.committedValue) return;

    const codes = overview.committedValue.map((row) => row.currency);
    expect(new Set(codes).size).toBe(codes.length);
    for (const row of overview.committedValue) expect(typeof row.value).toBe("string");
  });

  it("scopes every report to the reader (PRD #19 §340)", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const reports = await procurementReports(buyer);

    expect(reports.spendBySupplier.length).toBeGreaterThan(0);
    expect(reports.spendByCategory.length).toBeGreaterThan(0);

    const pm = await loginAs("PROJECT_MANAGER");
    if (can(pm, "procurement.report.view")) {
      const limited = await procurementReports(pm);
      expect(limited.spendBySupplier.length).toBeLessThanOrEqual(reports.spendBySupplier.length);
    }
  });

  it("scopes the approval queue (PRD #19 §153)", async () => {
    const ceo = await loginAs("CEO");
    const queue = await approvals.listApprovals(ceo, { status: "PENDING" });
    for (const row of queue.data) {
      expect(row.recordId).not.toBe(SEED.companyBRequest);
      expect(row.recordId).not.toBe(SEED.companyBOrder);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* §307, §334 Company isolation                                                */
/* -------------------------------------------------------------------------- */

describe("company isolation (PRD #19 §307, §334)", () => {
  it("keeps Company B out of every Company A read", async () => {
    const buyer = await loginAs("PROCUREMENT");
    const owner = await loginAs("OWNER");

    for (const context of [buyer, owner]) {
      const requestRows = await requests.listRequests(context, requestQuery);
      expect(requestRows.data.some((row) => row.id === SEED.companyBRequest)).toBe(false);

      const orderRows = await orders.listOrders(context, orderQuery);
      expect(orderRows.data.some((row) => row.id === SEED.companyBOrder)).toBe(false);

      const supplierRows = await suppliers.listSuppliers(context, supplierQuery);
      expect(supplierRows.data.some((row) => row.id === SEED.companyBSupplier)).toBe(false);

      await expect(requests.getRequest(context, SEED.companyBRequest)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(orders.getOrder(context, SEED.companyBOrder)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(suppliers.getSupplier(context, SEED.companyBSupplier)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  });

  it("allows the same order number in another company (PRD #19 §99)", async () => {
    // Company B's fixture carries PO-2026-0001 too: uniqueness is per company,
    // and a global constraint would leak the other company's numbering.
    // Other seeded tenants (the ARMAAR demo group) number from 0001 as well, so
    // the claim is: A and B both hold it, and no company holds it twice.
    const holders = await prisma.purchaseOrder.findMany({ where: { poNumber: "PO-2026-0001" }, select: { companyId: true } });
    const companies = holders.map((row) => row.companyId);
    expect(companies).toEqual(expect.arrayContaining([COMPANY.a, COMPANY.tenant]));
    expect(new Set(companies).size).toBe(companies.length);
  });

  it("keeps Company B out of search and the enquiry list", async () => {
    const buyer = await loginAs("PROCUREMENT");

    const searched = await requests.listRequests(
      buyer,
      requestListQuerySchema.parse({ search: "Company B", limit: 50 }),
    );
    expect(searched.data).toHaveLength(0);

    const enquiries = await rfqs.listRfqs(buyer, rfqQuery);
    for (const row of enquiries.data) expect(row.id.startsWith("rfq_b")).toBe(false);
  });

  it("does not let another company reach Company A either", async () => {
    // The fixture tenant has Procurement switched off: refused before any lookup.
    const tenantOwner = await loginAsEmail(DEMO_EMAIL.tenantOwner);
    await expect(requests.getRequest(tenantOwner, SEED.orderedRequest)).rejects.toMatchObject({
      code: "MODULE_UNAVAILABLE",
    });

    // A sibling in the same group has it on, and still reaches none of A's.
    const sibling = await loginAsEmail(DEMO_EMAIL.ceoB);
    expect(can(sibling, "procurement.request.view")).toBe(true);

    const rows = await requests.listRequests(sibling, requestQuery);
    expect(rows.data.some((row) => row.id === SEED.orderedRequest)).toBe(false);

    await expect(requests.getRequest(sibling, SEED.orderedRequest)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
