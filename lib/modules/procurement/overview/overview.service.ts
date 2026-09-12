import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
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
} from "../procurement.types";
import { requestListQuerySchema, orderListQuerySchema, rfqListQuerySchema } from "../procurement.schema";

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

/** How many decisions this reader is waiting on. */
export async function pendingDecisions(context: UserContext): Promise<number> {
  return approvals.pendingApprovalCount(context);
}

export type { Prisma };
