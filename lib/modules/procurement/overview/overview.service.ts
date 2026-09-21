import { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { prisma } from "@/lib/database/prisma";
import * as approvals from "../approvals/approval.service";
import { canSeeCommitment, currencyTotals } from "../procurement.dto";
import {
  buildOrderScopeWhere,
  buildReceiptScopeWhere,
  buildRequestScopeWhere,
  buildRfqScopeWhere,
  buildSupplierWhere,
} from "../procurement.scope";
import * as orders from "../orders/order.service";
import * as requests from "../requests/request.service";
import * as rfqs from "../rfqs/rfq.service";
import type {
  ProcurementAttentionDTO,
  ProcurementOverviewDTO,
  RfqSummaryDTO,
} from "../procurement.types";
import { requestListQuerySchema, orderListQuerySchema, rfqListQuerySchema } from "../procurement.schema";
import { companyRef, groupProcurementContexts, mergeCurrencyTotals } from "../procurement.workspace";

/**
 * The Procurement overview (PRD #19 §22–§25).
 *
 * Every number is counted through the reader's own scope, so two people on the
 * same landing page see different totals and both are right. A figure the
 * reader has no permission to see is absent rather than zero: zero is a claim
 * about the world, and "you cannot see this" is not (PRD #19 §259).
 */
export async function procurementOverview(
  context: UserContext,
): Promise<ProcurementOverviewDTO> {
  assertModule(context, "procurement");
  assertPermission(context, "procurement.view");

  const seeRequests = can(context, "procurement.request.view");
  const seeOrders = can(context, "procurement.order.view");
  const seeRfqs = can(context, "procurement.rfq.view");
  const seeReceipts = can(context, "procurement.receipt.view");
  const seeSuppliers = can(context, "procurement.supplier.view");

  const today = new Date();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const requestScope = buildRequestScopeWhere(context);
  const orderScope = buildOrderScopeWhere(context);
  const rfqScope = buildRfqScopeWhere(context);

  const [
    openRequests,
    requestsAwaitingApproval,
    requestsInSourcing,
    openRfqs,
    rfqsAwaitingResponse,
    ordersAwaitingApproval,
    issuedOrders,
    ordersAwaitingReceipt,
    overdueOrders,
    receiptsThisMonth,
    activeSuppliers,
    committed,
  ] = await Promise.all([
    seeRequests
      ? prisma.purchaseRequest.count({
          where: {
            AND: [
              requestScope,
              { archivedAt: null, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "IN_SOURCING", "PARTIALLY_ORDERED"] } },
            ],
          },
        })
      : Promise.resolve(0),
    seeRequests
      ? prisma.purchaseRequest.count({
          where: { AND: [requestScope, { status: "PENDING_APPROVAL", archivedAt: null }] },
        })
      : Promise.resolve(0),
    seeRequests
      ? prisma.purchaseRequest.count({
          where: {
            AND: [requestScope, { status: { in: ["IN_SOURCING", "PARTIALLY_ORDERED"] }, archivedAt: null }],
          },
        })
      : Promise.resolve(0),
    seeRfqs
      ? prisma.rFQ.count({ where: { AND: [rfqScope, { status: "ISSUED" }] } })
      : Promise.resolve(0),
    seeRfqs
      ? prisma.rFQ.count({
          where: {
            AND: [rfqScope, { status: "ISSUED", suppliers: { some: { status: "INVITED" } } }],
          },
        })
      : Promise.resolve(0),
    seeOrders
      ? prisma.purchaseOrder.count({
          where: { AND: [orderScope, { status: "PENDING_APPROVAL", archivedAt: null }] },
        })
      : Promise.resolve(0),
    seeOrders
      ? prisma.purchaseOrder.count({
          where: { AND: [orderScope, { status: "ISSUED", archivedAt: null }] },
        })
      : Promise.resolve(0),
    seeOrders
      ? prisma.purchaseOrder.count({
          where: {
            AND: [orderScope, { status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] }, archivedAt: null }],
          },
        })
      : Promise.resolve(0),
    seeOrders
      ? prisma.purchaseOrder.count({
          where: {
            AND: [
              orderScope,
              {
                status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] },
                archivedAt: null,
                requiredDate: { lt: today },
              },
            ],
          },
        })
      : Promise.resolve(0),
    seeReceipts
      ? prisma.goodsReceipt.count({
          where: {
            AND: [buildReceiptScopeWhere(context), { status: "RECORDED", receiptDate: { gte: monthStart } }],
          },
        })
      : Promise.resolve(0),
    seeSuppliers
      ? prisma.supplier.count({ where: { AND: [buildSupplierWhere(context), { status: "ACTIVE" }] } })
      : Promise.resolve(0),
    seeOrders && canSeeCommitment(context)
      ? prisma.purchaseOrder.findMany({
          where: {
            AND: [
              orderScope,
              { status: { in: ["APPROVED", "ISSUED", "PARTIALLY_RECEIVED"] }, archivedAt: null },
            ],
          },
          select: { currency: true, totalAmount: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    visible: {
      requests: seeRequests,
      orders: seeOrders,
      approvals: can(context, "procurement.approval.view"),
      receipts: seeReceipts,
      suppliers: seeSuppliers,
    },
    openRequests,
    requestsAwaitingApproval,
    requestsInSourcing,
    openRfqs,
    rfqsAwaitingResponse,
    ordersAwaitingApproval,
    issuedOrders,
    ordersAwaitingReceipt,
    overdueOrders,
    receiptsThisMonth,
    activeSuppliers,
    committedValue: committed
      ? currencyTotals(committed.map((row) => ({ currency: row.currency, amount: row.totalAmount })))
      : null,
  };
}

/** What needs somebody's attention today (PRD #19 §22). */
export async function procurementAttention(
  context: UserContext,
): Promise<ProcurementAttentionDTO> {
  assertModule(context, "procurement");
  assertPermission(context, "procurement.view");

  const [awaiting, overdue, receiving, closing] = await Promise.all([
    can(context, "procurement.request.view")
      ? requests.listRequests(context, requestListQuerySchema.parse({ view: "pending", limit: 5 }))
      : Promise.resolve({ data: [] }),
    can(context, "procurement.order.view")
      ? orders.listOrders(
          context,
          orderListQuerySchema.parse({ view: "receiving", sort: "required-asc", limit: 20 }),
        )
      : Promise.resolve({ data: [] }),
    can(context, "procurement.order.view")
      ? orders.listOrders(context, orderListQuerySchema.parse({ view: "receiving", limit: 5 }))
      : Promise.resolve({ data: [] }),
    can(context, "procurement.rfq.view")
      ? rfqs.listRfqs(context, rfqListQuerySchema.parse({ view: "issued", sort: "due-asc", limit: 5 }))
      : Promise.resolve({ data: [] }),
  ]);

  return {
    awaitingApproval: awaiting.data,
    overdueOrders: overdue.data.filter((order) => order.attention.overdue).slice(0, 5),
    awaitingReceipt: receiving.data,
    rfqsClosingSoon: closing.data,
  };
}

/**
 * The overview the active workspace shows (Workspace Context §38, §41, §72).
 *
 * A company workspace is `procurementOverview`, untouched. The Group workspace
 * asks each authorised company for its own overview — the person's own scope and
 * permissions there — and adds them up: counts add, a committed value adds per
 * currency and never across two, and a figure no company lets them see stays
 * absent rather than becoming zero. The same numbers company by company come
 * with it, because a group total nobody can break down cannot be checked (§73).
 */
export async function procurementOverviewForWorkspace(
  session: UserContext,
): Promise<ProcurementOverviewDTO> {
  if (!inGroupWorkspace(session)) return procurementOverview(session);

  const contexts = await groupProcurementContexts(session, "procurement.view");
  const rows = (
    await Promise.all(
      contexts.map(async (context) => ({ context, overview: await procurementOverview(context) })),
    )
  ).sort((a, b) => a.context.company.name.localeCompare(b.context.company.name));

  const sum = (pick: (overview: ProcurementOverviewDTO) => number) =>
    rows.reduce((total, row) => total + pick(row.overview), 0);
  const anyVisible = (pick: (overview: ProcurementOverviewDTO) => boolean) =>
    rows.some((row) => pick(row.overview));
  const committed = rows.map((row) => row.overview.committedValue);

  return {
    visible: {
      requests: anyVisible((overview) => overview.visible.requests),
      orders: anyVisible((overview) => overview.visible.orders),
      approvals: anyVisible((overview) => overview.visible.approvals),
      receipts: anyVisible((overview) => overview.visible.receipts),
      suppliers: anyVisible((overview) => overview.visible.suppliers),
    },
    openRequests: sum((overview) => overview.openRequests),
    requestsAwaitingApproval: sum((overview) => overview.requestsAwaitingApproval),
    requestsInSourcing: sum((overview) => overview.requestsInSourcing),
    openRfqs: sum((overview) => overview.openRfqs),
    rfqsAwaitingResponse: sum((overview) => overview.rfqsAwaitingResponse),
    ordersAwaitingApproval: sum((overview) => overview.ordersAwaitingApproval),
    issuedOrders: sum((overview) => overview.issuedOrders),
    ordersAwaitingReceipt: sum((overview) => overview.ordersAwaitingReceipt),
    overdueOrders: sum((overview) => overview.overdueOrders),
    receiptsThisMonth: sum((overview) => overview.receiptsThisMonth),
    activeSuppliers: sum((overview) => overview.activeSuppliers),
    committedValue: committed.some((value) => value !== null) ? mergeCurrencyTotals(...committed) : null,
    companies: rows.map(({ context, overview }) => ({
      company: companyRef(context),
      openRequests: overview.openRequests,
      requestsAwaitingApproval: overview.requestsAwaitingApproval,
      ordersAwaitingReceipt: overview.ordersAwaitingReceipt,
      overdueOrders: overview.overdueOrders,
      committedValue: overview.committedValue,
    })),
  };
}

/**
 * What needs attention, for the active workspace: a company's own, or in the
 * Group workspace the most pressing across the authorised companies, each row
 * labelled with its company (Workspace Context §45).
 */
export async function procurementAttentionForWorkspace(
  session: UserContext,
): Promise<ProcurementAttentionDTO> {
  if (!inGroupWorkspace(session)) return procurementAttention(session);

  await groupProcurementContexts(session, "procurement.view");
  const readers = (permission: Permission) => resolveWorkspaceContexts(session, { module: "procurement", permission });
  const [requestReaders, orderReaders, rfqReaders] = await Promise.all([
    readers("procurement.request.view"),
    readers("procurement.order.view"),
    readers("procurement.rfq.view"),
  ]);

  const [awaiting, overdue, receiving, closing] = await Promise.all([
    requestReaders.length > 0
      ? requests.listRequestsForWorkspace(session, requestListQuerySchema.parse({ view: "pending", limit: 5 }))
      : Promise.resolve({ data: [] }),
    orderReaders.length > 0
      ? orders.listOrdersForWorkspace(
          session,
          orderListQuerySchema.parse({ view: "receiving", sort: "required-asc", limit: 20 }),
        )
      : Promise.resolve({ data: [] }),
    orderReaders.length > 0
      ? orders.listOrdersForWorkspace(session, orderListQuerySchema.parse({ view: "receiving", limit: 5 }))
      : Promise.resolve({ data: [] }),
    enquiriesClosingAcrossCompanies(rfqReaders),
  ]);

  return {
    awaitingApproval: awaiting.data,
    overdueOrders: overdue.data.filter((order) => order.attention.overdue).slice(0, 5),
    awaitingReceipt: receiving.data,
    rfqsClosingSoon: closing,
  };
}

/**
 * The enquiries closest to their reply date, one company at a time and merged.
 *
 * The enquiry register itself is company work and has no group list; only this
 * short panel reads across, by asking each company for its own five.
 */
async function enquiriesClosingAcrossCompanies(contexts: UserContext[]): Promise<RfqSummaryDTO[]> {
  const perCompany = await Promise.all(
    contexts.map(async (context) => {
      const list = await rfqs.listRfqs(
        context,
        rfqListQuerySchema.parse({ view: "issued", sort: "due-asc", limit: 5 }),
      );
      return list.data.map((row): RfqSummaryDTO => ({ ...row, company: companyRef(context) }));
    }),
  );

  // The register's own order: soonest reply date first, none last.
  return perCompany
    .flat()
    .sort((a, b) => {
      if (a.responseDueDate === b.responseDueDate) return a.id.localeCompare(b.id);
      if (a.responseDueDate === null) return 1;
      if (b.responseDueDate === null) return -1;
      return a.responseDueDate.localeCompare(b.responseDueDate);
    })
    .slice(0, 5);
}

/** How many decisions this reader is waiting on. */
export async function pendingDecisions(context: UserContext): Promise<number> {
  return approvals.pendingApprovalCount(context);
}

export type { Prisma };
