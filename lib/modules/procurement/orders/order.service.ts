import { runInTransaction } from "@/lib/core/transactions/transaction";
import { applyTransition } from "@/lib/core/state/transition";
import { Prisma, type PurchaseOrderStatus } from "@prisma/client";
import { IntegrationType } from "@/lib/core/integrations/integration.registry";
import { linkIntegration } from "@/lib/core/integrations/integration.service";
import { ensureCommitmentForSource, settleCommitmentForSource } from "@/lib/modules/finance/commitments/commitment.source";

import { inGroupWorkspace } from "@/config/workspace";
import { can, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import type { ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import { settleStep } from "@/lib/core/approvals/approval-steps";
import { assertChainHasApprovers, planOrderChain, resolveApprovalPolicy } from "../approvals/approval.policy";
import {
  canSeeCommitment,
  dateString,
  loadMemberRef,
  moduleLink,
  toAmountString,
  toSupplierRef,
} from "../procurement.dto";
import { lineTotals, quantityString, sumLineTotals } from "../procurement.money";
import { nextDocumentNumber } from "../procurement.numbering";
import {
  buildOrderScopeWhere,
  buildProcurementProjectWhere,
  buildRequestScopeWhere,
} from "../procurement.scope";
import type { OrderInput, OrderListQuery } from "../procurement.schema";
import {
  companyFilterOptions,
  groupProcurementContexts,
  narrowToCompany,
  unionWhere,
} from "../procurement.workspace";
import {
  acceptsReceipts,
  canTransitionOrderStatus,
  daysBetween,
  isOrderArchivable,
  isOrderClosable,
  isOrderEditable,
  isOrderSubmittable,
} from "../procurement.status";
import type {
  OrderCapabilities,
  OrderDetailDTO,
  OrderItemDTO,
  OrderSummaryDTO,
} from "../procurement.types";
import { refreshSourcingState } from "../requests/request.service";
import { purchaseOrderMachine } from "./order.machine";

/**
 * Purchase orders (PRD #19 §95–§131).
 *
 * An order is the commitment. Approving one is the moment the company owes
 * somebody money, which is why it is also the moment a Finance commitment
 * appears — not at issue, when the paperwork leaves the building (PRD #19 §116).
 *
 * Three rules are load-bearing:
 *
 *   1. **Totals come from the lines**, never from the client (PRD #19 §105).
 *   2. **One commitment per order.** Creation is keyed on the order, so a retry
 *      finds the existing one rather than committing the money twice (§121).
 *   3. **An issued order with receipts is closed short, not cancelled.** The
 *      goods on site are a fact (PRD #19 §129).
 */

const MODULE = "procurement" as const;
const ENTITY = "PurchaseOrder";

const LIST_SELECT = {
  id: true,
  poNumber: true,
  status: true,
  orderDate: true,
  requiredDate: true,
  currency: true,
  subtotal: true,
  taxAmount: true,
  totalAmount: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true, status: true } },
  project: { select: { id: true, code: true, name: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      receiptItems: {
        where: { goodsReceipt: { status: "RECORDED" } },
        select: { receivedQuantity: true },
      },
    },
  },
} satisfies Prisma.PurchaseOrderSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  projectId: true,
  contractId: true,
  purchaseRequestId: true,
  rfqId: true,
  financeCommitmentId: true,
  notes: true,
  modifiedFromQuote: true,
  submittedAt: true,
  approvedAt: true,
  approvedByMemberId: true,
  rejectedAt: true,
  rejectedByMemberId: true,
  rejectionReason: true,
  issuedAt: true,
  closedAt: true,
  cancelledAt: true,
  archivedAt: true,
  preArchiveStatus: true,
  createdAt: true,
  createdByMemberId: true,
  purchaseRequest: { select: { id: true, requestNumber: true } },
  rfq: { select: { id: true, rfqNumber: true } },
  contract: { select: { id: true, contractNumber: true, title: true } },
} satisfies Prisma.PurchaseOrderSelect;

/** What a Group list adds: the company each row belongs to (Workspace Context §45). */
const GROUP_LIST_SELECT = {
  ...LIST_SELECT,
  company: { select: { id: true, name: true } },
} satisfies Prisma.PurchaseOrderSelect;

type ListRow = Prisma.PurchaseOrderGetPayload<{ select: typeof LIST_SELECT }> & {
  company?: { id: string; name: string };
};
type DetailRow = Prisma.PurchaseOrderGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listOrders(context: UserContext, query: OrderListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.view");

  const where = buildListWhere([context], query);

  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: orderFor(query.sort),
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  const today = new Date();
  return {
    data: rows.map((row) => toSummaryDTO(row, today)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/**
 * The register's `where`, for one company's context or for every company a
 * Group read spans, each company's own scope unioned in the database ahead of
 * every filter, sort and page (Workspace Context §57).
 */
function buildListWhere(
  contexts: UserContext[],
  query: OrderListQuery,
): Prisma.PurchaseOrderWhereInput {
  const filters: Prisma.PurchaseOrderWhereInput[] = [unionWhere(contexts, buildOrderScopeWhere)];

  switch (query.view) {
    case "draft":
      filters.push({ status: { in: ["DRAFT", "REJECTED"] }, archivedAt: null });
      break;
    case "pending":
      filters.push({ status: "PENDING_APPROVAL", archivedAt: null });
      break;
    case "issued":
      filters.push({ status: { in: ["APPROVED", "ISSUED"] }, archivedAt: null });
      break;
    case "receiving":
      filters.push({ status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] }, archivedAt: null });
      break;
    case "closed":
      filters.push({ status: { in: ["RECEIVED", "CLOSED", "CANCELLED"] }, archivedAt: null });
      break;
    case "archived":
      filters.push({ archivedAt: { not: null } });
      break;
    default:
      filters.push({ archivedAt: null });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.supplierId) filters.push({ supplierId: query.supplierId });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.currency) filters.push({ currency: query.currency });

  const search = searchClause(query.search, ["poNumber", "notes"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [
        ...search.OR,
        { supplier: { name: { contains: term, mode: "insensitive" } } },
        { items: { some: { description: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  return { AND: filters };
}

/**
 * The register the active workspace shows (Workspace Context §38).
 *
 * A company workspace is `listOrders`, untouched. The Group workspace is one
 * query over the union of each authorised company's own order scope, every row
 * labelled with its company. Values stay in the order's own currency; nothing
 * here adds two together (§72).
 */
export async function listOrdersForWorkspace(session: UserContext, query: OrderListQuery) {
  if (!inGroupWorkspace(session)) return listOrders(session, query);

  const contexts = narrowToCompany(
    await groupProcurementContexts(session, "procurement.order.view"),
    query.companyId,
  );
  const where = buildListWhere(contexts, query);

  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      // The list's own sort first; the id keeps a page boundary stable when rows tie.
      orderBy: [...orderFor(query.sort), { id: "asc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: GROUP_LIST_SELECT,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  const today = new Date();
  return {
    data: rows.map((row) => toSummaryDTO(row, today)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

function orderFor(sort: OrderListQuery["sort"]): Prisma.PurchaseOrderOrderByWithRelationInput[] {
  switch (sort) {
    case "created-desc":
      return [{ createdAt: "desc" }];
    case "number-asc":
      return [{ poNumber: "asc" }];
    case "order-desc":
      return [{ orderDate: "desc" }];
    case "required-asc":
      return [{ requiredDate: { sort: "asc", nulls: "last" } }];
    case "value-desc":
      return [{ totalAmount: "desc" }];
    case "status-asc":
      return [{ status: "asc" }, { updatedAt: "desc" }];
    default:
      return [{ updatedAt: "desc" }];
  }
}

export async function getOrder(context: UserContext, orderId: string): Promise<OrderDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.view");

  const row = assertFound(
    await prisma.purchaseOrder.findFirst({
      where: { AND: [buildOrderScopeWhere(context), { id: orderId }] },
      select: DETAIL_SELECT,
    }),
  );

  const today = new Date();

  const [items, history, createdBy, approvedBy, rejectedBy, receiptCount, commitment, reach] =
    await Promise.all([
      loadItems(orderId),
      approvals.approvalHistory(context, "PURCHASE_ORDER", row.id),
      loadMemberRef(row.createdByMemberId),
      loadMemberRef(row.approvedByMemberId),
      loadMemberRef(row.rejectedByMemberId),
      prisma.goodsReceipt.count({ where: { purchaseOrderId: orderId, status: "RECORDED" } }),
      loadCommitment(context, row.financeCommitmentId),
      resolveReachability(context, row),
    ]);

  return {
    ...toSummaryDTO(row, today),
    items,
    notes: row.notes,
    modifiedFromQuote: row.modifiedFromQuote,
    dates: {
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    },
    rejectionReason: row.rejectionReason,
    approvedBy,
    rejectedBy,
    requestLink: row.purchaseRequest
      ? moduleLink(
          row.purchaseRequest.id,
          row.purchaseRequest.requestNumber,
          `/procurement/requests/${row.purchaseRequest.id}`,
          reach.request,
        )
      : null,
    rfqLink: row.rfq
      ? moduleLink(
          row.rfq.id,
          row.rfq.rfqNumber,
          `/procurement/rfqs/${row.rfq.id}`,
          reach.rfq,
        )
      : null,
    contractLink: row.contract
      ? moduleLink(
          row.contract.id,
          `${row.contract.contractNumber} — ${row.contract.title}`,
          `/contracts/${row.contract.id}`,
          reach.contract,
        )
      : null,
    projectLink: row.project
      ? moduleLink(
          row.project.id,
          `${row.project.code} — ${row.project.name}`,
          `/projects/${row.project.id}`,
          reach.project,
        )
      : null,
    commitment,
    receiptCount,
    approvals: history,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: capabilitiesFor(
      context,
      row,
      receiptCount,
      history.find((entry) => entry.status === "PENDING"),
    ),
  };
}

/** Lines with what has arrived against each, in one query (PRD #19 §243). */
async function loadItems(orderId: string): Promise<OrderItemDTO[]> {
  const rows = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: orderId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      description: true,
      unit: true,
      quantity: true,
      unitPrice: true,
      taxRate: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      sortOrder: true,
      receiptItems: {
        where: { goodsReceipt: { status: "RECORDED" } },
        select: { receivedQuantity: true },
      },
    },
  });

  return rows.map((row) => {
    const received = row.receiptItems.reduce(
      (sum, item) => sum.plus(item.receivedQuantity),
      new Prisma.Decimal(0),
    );
    const outstanding = row.quantity.minus(received);

    return {
      id: row.id,
      description: row.description,
      unit: row.unit,
      quantity: quantityString(row.quantity),
      unitPrice: quantityString(row.unitPrice),
      taxRate: row.taxRate.toString(),
      subtotal: toAmountString(row.subtotal),
      taxAmount: toAmountString(row.taxAmount),
      totalAmount: toAmountString(row.totalAmount),
      receivedQuantity: quantityString(received),
      // Never negative on the page: an over-receipt is a fact about the
      // delivery, not a negative amount still to come (PRD #19 §139).
      outstandingQuantity: quantityString(
        outstanding.isNegative() ? new Prisma.Decimal(0) : outstanding,
      ),
      sortOrder: row.sortOrder,
    };
  });
}

/** The Finance commitment behind the order, when the reader may see it (§262). */
async function loadCommitment(context: UserContext, commitmentId: string | null) {
  if (!commitmentId || !canSeeCommitment(context)) return null;

  const commitment = await prisma.commitment.findFirst({
    where: { id: commitmentId, companyId: context.companyId },
    select: { id: true, reference: true, amount: true },
  });
  if (!commitment) return null;

  const reachable = isModuleEnabled(context, "finance") && can(context, "finance.commitment.view");

  return {
    id: commitment.id,
    reference: commitment.reference,
    amount: toAmountString(commitment.amount),
    href: reachable ? `/finance/commitments/${commitment.id}` : null,
  };
}

async function resolveReachability(context: UserContext, row: DetailRow) {
  const [request, rfq, contract, project] = await Promise.all([
    row.purchaseRequestId && can(context, "procurement.request.view")
      ? prisma.purchaseRequest
          .findFirst({
            where: { AND: [buildRequestScopeWhere(context), { id: row.purchaseRequestId }] },
            select: { id: true },
          })
          .then((found) => found !== null)
      : Promise.resolve(false),
    row.rfqId && can(context, "procurement.rfq.view") ? Promise.resolve(true) : Promise.resolve(false),
    row.contractId && can(context, "legal.contract.view") && isModuleEnabled(context, "contracts")
      ? Promise.resolve(true)
      : Promise.resolve(false),
    row.projectId && can(context, "project.view")
      ? prisma.project
          .findFirst({
            where: { AND: [buildProjectScopeWhere(context), { id: row.projectId }] },
            select: { id: true },
          })
          .then((found) => found !== null)
      : Promise.resolve(false),
  ]);

  return { request, rfq, contract, project };
}

export async function listForProject(
  context: UserContext,
  projectId: string,
): Promise<OrderSummaryDTO[]> {
  if (!can(context, "procurement.order.view")) return [];

  const rows = await prisma.purchaseOrder.findMany({
    where: { AND: [buildOrderScopeWhere(context), { projectId, archivedAt: null }] },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: LIST_SELECT,
  });

  const today = new Date();
  return rows.map((row) => toSummaryDTO(row, today));
}

export async function listForSupplier(
  context: UserContext,
  supplierId: string,
): Promise<OrderSummaryDTO[]> {
  if (!can(context, "procurement.order.view")) return [];

  const rows = await prisma.purchaseOrder.findMany({
    where: { AND: [buildOrderScopeWhere(context), { supplierId, archivedAt: null }] },
    orderBy: { orderDate: "desc" },
    take: 100,
    select: LIST_SELECT,
  });

  const today = new Date();
  return rows.map((row) => toSummaryDTO(row, today));
}

export async function orderFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.view");

  const scope = buildOrderScopeWhere(context);

  const [suppliers, projects, currencies] = await Promise.all([
    prisma.supplier.findMany({
      where: { companyId: context.companyId, purchaseOrders: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { AND: [buildProcurementProjectWhere(context), { purchaseOrders: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.purchaseOrder.findMany({
      where: scope,
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return { suppliers, projects, currencies: currencies.map((row) => row.currency) };
}

type InCompany = { company?: { name: string } };

export type OrderFilterOptions = {
  suppliers: ({ id: string; name: string } & InCompany)[];
  projects: ({ id: string; code: string; name: string } & InCompany)[];
  currencies: string[];
  /** The Group `company` filter's choices; empty in a company workspace, where the filter is locked (§86). */
  companies: { value: string; label: string }[];
};

/**
 * The filter choices for the workspace's register: a company's own, or in the
 * Group workspace the union across companies, each named with its company so a
 * supplier or project that exists in several stays distinguishable (§45).
 */
export async function orderFilterOptionsForWorkspace(session: UserContext): Promise<OrderFilterOptions> {
  if (!inGroupWorkspace(session)) {
    return { ...(await orderFilterOptions(session)), companies: [] };
  }

  const contexts = await groupProcurementContexts(session, "procurement.order.view");
  const inCompany = { select: { name: true } } as const;

  const [suppliers, projects, currencies] = await Promise.all([
    prisma.supplier.findMany({
      where: {
        OR: contexts.map((context) => ({
          companyId: context.companyId,
          purchaseOrders: { some: buildOrderScopeWhere(context) },
        })),
      },
      select: { id: true, name: true, company: inCompany },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.project.findMany({
      where: {
        OR: contexts.map((context) => ({
          AND: [buildProcurementProjectWhere(context), { purchaseOrders: { some: buildOrderScopeWhere(context) } }],
        })),
      },
      select: { id: true, code: true, name: true, company: inCompany },
      orderBy: [{ code: "asc" }, { id: "asc" }],
    }),
    prisma.purchaseOrder.findMany({
      where: unionWhere(contexts, buildOrderScopeWhere),
      select: { currency: true },
      distinct: ["currency"],
      orderBy: { currency: "asc" },
    }),
  ]);

  return {
    suppliers,
    projects,
    currencies: currencies.map((row) => row.currency),
    companies: companyFilterOptions(contexts),
  };
}

/** What an order form may offer (PRD #19 §272, §258). */
export async function orderFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [supplierRows, projects, requests, contracts] = await Promise.all([
    prisma.supplier.findMany({
      where: { companyId: context.companyId, status: "ACTIVE" },
      select: { id: true, name: true, code: true, defaultCurrency: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: buildProcurementProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    can(context, "procurement.request.view")
      ? prisma.purchaseRequest.findMany({
          where: {
            AND: [
              buildRequestScopeWhere(context),
              { status: { in: ["APPROVED", "IN_SOURCING", "PARTIALLY_ORDERED"] }, archivedAt: null },
            ],
          },
          select: { id: true, requestNumber: true, title: true },
          orderBy: { requestNumber: "asc" },
          take: 200,
        })
      : Promise.resolve([]),
    // Offered only to somebody who can see contracts: a dropdown of agreements
    // is a directory of agreements (PRD #19 §263).
    isModuleEnabled(context, "contracts") && can(context, "legal.contract.view")
      ? prisma.contract.findMany({
          where: { companyId: context.companyId, status: { in: ["ACTIVE", "SIGNED"] } },
          select: { id: true, contractNumber: true, title: true },
          orderBy: { contractNumber: "asc" },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  return { suppliers: supplierRows, projects, requests, contracts };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createOrder(
  context: UserContext,
  input: OrderInput,
): Promise<OrderDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.create");

  const related = await resolveRelated(context, input);
  const lines = input.items.map((item) => ({ ...item, totals: lineTotals(item) }));
  const totals = sumLineTotals(lines.map((line) => line.totals));

  const id = await prisma.$transaction(async (tx) => {
    const poNumber = await nextDocumentNumber(tx, "purchaseOrder", context.companyId);

    const order = await tx.purchaseOrder.create({
      data: {
        companyId: context.companyId,
        poNumber,
        supplierId: related.supplierId,
        purchaseRequestId: related.purchaseRequestId,
        rfqId: related.rfqId,
        supplierQuoteId: related.supplierQuoteId,
        projectId: related.projectId,
        contractId: related.contractId,
        orderDate: input.orderDate,
        requiredDate: input.requiredDate ?? null,
        currency: input.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        modifiedFromQuote: related.modifiedFromQuote,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        items: {
          create: lines.map((line, index) => ({
            sourceRequestItemId: line.sourceRequestItemId ?? null,
            sourceQuoteItemId: line.sourceQuoteItemId ?? null,
            description: line.description,
            quantity: new Prisma.Decimal(line.quantity),
            unit: line.unit,
            unitPrice: new Prisma.Decimal(line.unitPrice),
            taxRate: new Prisma.Decimal(line.taxRate),
            subtotal: line.totals.subtotal,
            taxAmount: line.totals.taxAmount,
            totalAmount: line.totals.totalAmount,
            sortOrder: index + 1,
          })),
        },
      },
      select: { id: true, poNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: order.id,
      action: "PROCUREMENT_ORDER_CREATED",
      message: `drafted order ${order.poNumber}`,
      metadata: { lines: lines.length } as Prisma.InputJsonValue,
    });

    return order.id;
  });

  return getOrder(context, id);
}

export async function updateOrder(
  context: UserContext,
  orderId: string,
  input: OrderInput,
): Promise<OrderDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.update");

  const existing = await loadForWrite(context, orderId);

  if (!isOrderEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "This order has been approved, so its lines are fixed. Cancel it and raise another.",
      { code: "ORDER_NOT_EDITABLE" },
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const related = await resolveRelated(context, input);
  const lines = input.items.map((item) => ({ ...item, totals: lineTotals(item) }));
  const totals = sumLineTotals(lines.map((line) => line.totals));

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: orderId } });

    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: {
        supplierId: related.supplierId,
        purchaseRequestId: related.purchaseRequestId,
        rfqId: related.rfqId,
        supplierQuoteId: related.supplierQuoteId,
        projectId: related.projectId,
        contractId: related.contractId,
        orderDate: input.orderDate,
        requiredDate: input.requiredDate ?? null,
        currency: input.currency,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        modifiedFromQuote: related.modifiedFromQuote,
        notes: input.notes ?? null,
        updatedByMemberId: context.membershipId,
        items: {
          create: lines.map((line, index) => ({
            sourceRequestItemId: line.sourceRequestItemId ?? null,
            sourceQuoteItemId: line.sourceQuoteItemId ?? null,
            description: line.description,
            quantity: new Prisma.Decimal(line.quantity),
            unit: line.unit,
            unitPrice: new Prisma.Decimal(line.unitPrice),
            taxRate: new Prisma.Decimal(line.taxRate),
            subtotal: line.totals.subtotal,
            taxAmount: line.totals.taxAmount,
            totalAmount: line.totals.totalAmount,
            sortOrder: index + 1,
          })),
        },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_UPDATED",
      message: `updated order ${existing.poNumber}`,
    });
  });

  return getOrder(context, orderId);
}

/**
 * Builds an order from the quote that won (PRD #19 §106, §107).
 *
 * The lines are copied from the selected quote so the price on the order is the
 * price that was accepted. `modifiedFromQuote` is set the moment anybody edits
 * one afterwards, because an order that no longer matches the quote it came
 * from is a different agreement.
 */
export async function draftFromQuote(
  context: UserContext,
  quoteId: string,
): Promise<OrderDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.create");
  assertPermission(context, "procurement.quote.view");

  const quote = assertFound(
    await prisma.supplierQuote.findFirst({
      where: { id: quoteId, companyId: context.companyId },
      select: {
        id: true,
        status: true,
        currency: true,
        supplierId: true,
        rfqId: true,
        rfq: { select: { id: true, purchaseRequestId: true, projectId: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            taxRate: true,
            rfqItem: { select: { id: true, description: true, unit: true, sourceRequestItemId: true, sortOrder: true } },
          },
        },
      },
    }),
  );

  if (quote.status !== "SELECTED") {
    throw new AccessError(
      "CONFLICT",
      "Select this quote before raising an order from it.",
      { code: "QUOTE_NOT_SELECTED" },
    );
  }

  const existing = await prisma.purchaseOrder.findFirst({
    where: { supplierQuoteId: quoteId, status: { notIn: ["CANCELLED", "REJECTED"] } },
    select: { id: true },
  });

  // Idempotent: a second click meets the order the first one made.
  if (existing) return getOrder(context, existing.id);

  return createOrder(context, {
    supplierId: quote.supplierId,
    purchaseRequestId: quote.rfq.purchaseRequestId ?? undefined,
    rfqId: quote.rfqId,
    supplierQuoteId: quote.id,
    projectId: quote.rfq.projectId ?? undefined,
    orderDate: new Date(),
    currency: quote.currency,
    items: [...quote.items]
      .sort((a, b) => a.rfqItem.sortOrder - b.rfqItem.sortOrder)
      .map((item) => ({
        sourceRequestItemId: item.rfqItem.sourceRequestItemId ?? undefined,
        sourceQuoteItemId: item.id,
        description: item.rfqItem.description,
        quantity: item.quantity.toString(),
        unit: item.rfqItem.unit,
        unitPrice: item.unitPrice.toString(),
        taxRate: item.taxRate.toString(),
      })),
  } as OrderInput);
}

export async function submitOrder(context: UserContext, orderId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.submit");

  const existing = await loadForWrite(context, orderId);

  if (!isOrderSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a draft order can be sent for approval.", {
      code: "INVALID_TRANSITION",
    });
  }

  const lines = await prisma.purchaseOrderItem.count({ where: { purchaseOrderId: orderId } });
  if (lines === 0) {
    throw new AccessError("VALIDATION_ERROR", "Add at least one line before submitting.", {
      code: "ORDER_EMPTY",
    });
  }

  // The chain this order's value calls for under the company's policy, and
  // somebody able to take every step of it — refused now, with a reason,
  // rather than stuck later (PRD #41 §27, §161).
  const [policy, totals] = await Promise.all([
    resolveApprovalPolicy(context.companyId),
    prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, select: { totalAmount: true, currency: true } }),
  ]);
  const chain = planOrderChain(policy, totals);
  if (chain.steps.length > 0) {
    await assertChainHasApprovers(context.companyId, orderId, context.membershipId, chain.steps);
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "submit",
      id: orderId,
      context,
      from: existing.status,
      data: { submittedAt: new Date() },
    });
    await approvals.openApproval(tx, context, "PURCHASE_ORDER", orderId, { steps: chain.steps });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_SUBMITTED",
      message:
        chain.steps.length > 0
          ? `sent order ${existing.poNumber} for approval in ${chain.steps.length} steps (${chain.steps.map((step) => step.label).join(", ")})`
          : `sent order ${existing.poNumber} for approval`,
    });
  });
}
export async function approveOrder(
  context: UserContext,
  orderId: string,
  note: string | null,
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);

  const existing = await loadForWrite(context, orderId);

  await runInTransaction("procurement.order.approve", async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "PURCHASE_ORDER", orderId, guard);

    // In a chain, the current step's approver decides it; only the last
    // step approves the order (PRD #41 §21).
    const actionable = await approvals.requireActionableStep(tx, context, approval, orderId, guard);
    if (actionable) {
      await settleStep(tx, context, actionable.step, "APPROVED", note, actionable.onBehalfOfMemberId);
      const carriedOn = await approvals.advanceChain(tx, context, {
        approvalId: approval.id,
        orderId,
        submittedByMemberId: approval.submittedByMemberId,
        actionable,
        note,
      });
      if (carriedOn) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: orderId,
          action: "PROCUREMENT_ORDER_STEP_APPROVED",
          message: `approved step ${actionable.step.stepNumber} of ${actionable.steps.length} (${actionable.step.label}) on order ${existing.poNumber}`,
        });
        return;
      }
    } else {
      approvals.assertCanApprove(context, "PURCHASE_ORDER");
      approvals.assertNotSelfApproval(context, approval.submittedByMemberId);
    }

    // In a chain the last step's holder concludes it, and may hold the step
    // rather than the order permission; the settled step is what says so.
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "approve",
      id: orderId,
      context,
      from: existing.status,
      approvalStepId: actionable?.step.id,
      data: {
        approvedAt: new Date(),
        approvedByMemberId: context.membershipId,
        rejectedAt: null,
        rejectedByMemberId: null,
        rejectionReason: null,
      },
    });
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note, {
      step: actionable?.step.stepNumber,
      onBehalfOfMemberId: actionable?.onBehalfOfMemberId,
    });

    // Approval is the moment the money is committed (PRD #19 §116).
    await syncCommitment(tx, context, orderId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_APPROVED",
      message: `approved order ${existing.poNumber}`,
    });
  });
}
export async function rejectOrder(
  context: UserContext,
  orderId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  await endOrderApproval(context, orderId, reason, "REJECTED", guard);
}

/**
 * Returns an order for revision (PRD #41 §48): back to draft with the
 * approver's reason, to be corrected and submitted again — which opens a new
 * cycle, and a new chain if its value still calls for one.
 */
export async function returnOrder(
  context: UserContext,
  orderId: string,
  reason: string,
  guard?: ApprovalGuard,
): Promise<void> {
  await endOrderApproval(context, orderId, reason, "RETURNED", guard);
}

/** Rejecting or returning ends the cycle at whichever step it has reached. */
async function endOrderApproval(
  context: UserContext,
  orderId: string,
  reason: string,
  outcome: "REJECTED" | "RETURNED",
  guard?: ApprovalGuard,
): Promise<void> {
  assertModule(context, MODULE);

  const existing = await loadForWrite(context, orderId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "PURCHASE_ORDER", orderId, guard);
    const actionable = await approvals.requireActionableStep(tx, context, approval, orderId, guard);
    if (actionable) {
      await settleStep(tx, context, actionable.step, outcome, reason, actionable.onBehalfOfMemberId);
    } else {
      approvals.assertCanReject(context, "PURCHASE_ORDER");
      approvals.assertNotSelfApproval(context, approval.submittedByMemberId);
    }

    if (outcome === "REJECTED") {
      await applyTransition(tx, {
        machine: purchaseOrderMachine,
        action: "reject",
        id: orderId,
        context,
        from: existing.status,
        approvalStepId: actionable?.step.id,
        data: {
          rejectedAt: new Date(),
          rejectedByMemberId: context.membershipId,
          rejectionReason: reason,
        },
      });
    } else {
      await applyTransition(tx, {
        machine: purchaseOrderMachine,
        action: "return",
        id: orderId,
        context,
        from: existing.status,
        approvalStepId: actionable?.step.id,
        data: { submittedAt: null },
      });
    }
    await approvals.decideApproval(tx, context, approval.id, outcome, reason, {
      step: actionable?.step.stepNumber,
      onBehalfOfMemberId: actionable?.onBehalfOfMemberId,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: outcome === "REJECTED" ? "PROCUREMENT_ORDER_REJECTED" : "PROCUREMENT_ORDER_RETURNED",
      message: outcome === "REJECTED" ? `rejected order ${existing.poNumber}` : `returned order ${existing.poNumber} for revision`,
      metadata: { reason, ...(actionable ? { step: actionable.step.stepNumber } : {}) } as Prisma.InputJsonValue,
    });
  });
}
export async function issueOrder(context: UserContext, orderId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.issue");

  const existing = await loadForWrite(context, orderId);

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "issue",
      id: orderId,
      context,
      from: existing.status,
      data: { issuedAt: new Date() },
    });

    if (existing.purchaseRequestId) {
      await refreshSourcingState(tx, context, existing.purchaseRequestId);
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_ISSUED",
      message: `issued order ${existing.poNumber}`,
    });
  });
}

export async function cancelOrder(
  context: UserContext,
  orderId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.cancel");

  const existing = await loadForWrite(context, orderId);

  /*
   * An issued order with goods already booked in cannot be cancelled: the
   * delivery on site is a fact, and cancelling would deny it. Close it short
   * instead (PRD #19 §129).
   */
  if (existing.status === "ISSUED") {
    const received = await prisma.goodsReceipt.count({
      where: { purchaseOrderId: orderId, status: "RECORDED" },
    });
    if (received > 0) {
      throw new AccessError(
        "CONFLICT",
        "Goods have already been received against this order. Close it short instead of cancelling it.",
        { code: "ORDER_HAS_RECEIPTS" },
      );
    }
  }

  await runInTransaction("procurement.order.cancel", async (tx) => {
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "cancel",
      id: orderId,
      context,
      from: existing.status,
      data: { cancelledAt: new Date() },
    });
    await approvals.cancelPendingApprovals(tx, context, "PURCHASE_ORDER", orderId);

    // The money is no longer committed (PRD #19 §128). Finance owns the row,
    // so Finance moves it — inside this transaction (PRD #48 §77).
    await settleCommitmentForSource(tx, context, commitmentSource(orderId), "CANCELLED");

    if (existing.purchaseRequestId) {
      await refreshSourcingState(tx, context, existing.purchaseRequestId);
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_CANCELLED",
      message: `cancelled order ${existing.poNumber}`,
      metadata: note ? ({ note } as Prisma.InputJsonValue) : undefined,
    });
  });
}

export async function closeOrder(
  context: UserContext,
  orderId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.close");

  const existing = await loadForWrite(context, orderId);

  if (!isOrderClosable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "Only an order that has started receiving can be closed.",
      { code: "INVALID_TRANSITION" },
    );
  }

  await runInTransaction("procurement.order.close", async (tx) => {
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "close",
      id: orderId,
      context,
      from: existing.status,
      data: { closedAt: new Date() },
    });

    await settleCommitmentForSource(tx, context, commitmentSource(orderId), "CLOSED");

    if (existing.purchaseRequestId) {
      await refreshSourcingState(tx, context, existing.purchaseRequestId);
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_CLOSED",
      message: `closed order ${existing.poNumber}`,
      metadata: note ? ({ note } as Prisma.InputJsonValue) : undefined,
    });
  });
}

export async function archiveOrder(context: UserContext, orderId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.archive");

  const existing = await loadForWrite(context, orderId);
  if (existing.archivedAt) return;

  if (!isOrderArchivable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a finished order can be archived.", {
      code: "INVALID_TRANSITION",
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "archive",
      id: orderId,
      context,
      from: existing.status,
      data: {
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_ARCHIVED",
      message: `archived order ${existing.poNumber}`,
    });
  });
}

export async function restoreOrder(context: UserContext, orderId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.order.restore");

  const existing = await loadForWrite(context, orderId);
  if (!existing.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    // Returns the status it held before, not a guess: leaving the archive is
    // not a lifecycle decision.
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "restore",
      id: orderId,
      context,
      from: existing.status,
      to: existing.preArchiveStatus ?? "DRAFT",
      data: {
        preArchiveStatus: null,
        archivedAt: null,
        archivedByMemberId: null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: orderId,
      action: "PROCUREMENT_ORDER_RESTORED",
      message: `restored order ${existing.poNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Finance commitment (PRD #19 §115–§123)                                      */
/* -------------------------------------------------------------------------- */

/** Where a purchase order's commitment is filed in Finance (PRD #48 §164, §165). */
function commitmentSource(orderId: string) {
  return { module: "procurement", entityType: "purchase_order", entityId: orderId } as const;
}

/**
 * One commitment per order, created when it is approved (PRD #19 §116, §121).
 *
 * Finance owns `Commitment`, so the row is written by Finance's own contract
 * rather than from here (PRD #48 §11, §77). It runs inside the approval's
 * transaction: the order is not approved unless the money is committed with it
 * (PRD #48 §143). The buyer approving the order is not required to hold Finance
 * permissions — the approval is the authorisation (PRD #19 §123).
 *
 * With Finance switched off the approval still works and no commitment is made
 * (PRD #19 §122).
 */
async function syncCommitment(
  tx: Prisma.TransactionClient,
  context: UserContext,
  orderId: string,
): Promise<void> {
  if (!isModuleEnabled(context, "finance")) return;

  const order = await tx.purchaseOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      poNumber: true,
      projectId: true,
      currency: true,
      totalAmount: true,
      requiredDate: true,
      financeCommitmentId: true,
      supplier: { select: { name: true } },
    },
  });

  if (!order) return;

  const commitment = await ensureCommitmentForSource(tx, context, {
    source: commitmentSource(order.id),
    projectId: order.projectId,
    reference: order.poNumber,
    description: `Purchase order ${order.poNumber}`,
    counterpartyName: order.supplier.name,
    category: "MATERIALS",
    currency: order.currency,
    amount: order.totalAmount,
    expectedDate: order.requiredDate,
  });

  if (order.financeCommitmentId !== commitment.id) {
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { financeCommitmentId: commitment.id },
    });
  }

  if (!commitment.created) return;

  // The handoff is already idempotent through the commitment's source
  // reference; this is the durable trace of it, so "where did this commitment
  // come from?" has an answer that does not depend on reading procurement's
  // own columns (PRD #23 §21, §94).
  await linkIntegration(tx, context, {
    integrationType: IntegrationType.PROCUREMENT_PO_FINANCE_COMMITMENT,
    source: { id: order.id },
    target: { id: commitment.id },
  });
}

/**
 * Re-derives an order's receipt status (PRD #19 §141).
 *
 * Called by the receipt service after anything is booked in or voided, so the
 * status is a consequence of the receipts rather than something clicked.
 */
export async function refreshReceiptState(
  tx: Prisma.TransactionClient,
  context: UserContext,
  orderId: string,
): Promise<void> {
  const order = await tx.purchaseOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      poNumber: true,
      purchaseRequestId: true,
      items: {
        select: {
          quantity: true,
          receiptItems: {
            where: { goodsReceipt: { status: "RECORDED" } },
            select: { receivedQuantity: true },
          },
        },
      },
    },
  });

  if (!order) return;
  if (order.status !== "ISSUED" && order.status !== "PARTIALLY_RECEIVED" && order.status !== "RECEIVED") {
    return;
  }

  const fraction = receivedFraction(order.items);
  const next = fraction <= 0 ? "ISSUED" : fraction >= 1 ? "RECEIVED" : "PARTIALLY_RECEIVED";

  if (next !== order.status) {
    // Bound to the status read here: a receipt booked or voided underneath this
    // one re-derived the order itself, and is not written over.
    await applyTransition(tx, {
      machine: purchaseOrderMachine,
      action: "reconcile_receipts",
      id: orderId,
      context,
      from: order.status,
      to: next,
    });
  }

  if (order.purchaseRequestId) {
    await refreshSourcingState(tx, context, order.purchaseRequestId);
  }
}

function receivedFraction(
  items: { quantity: Prisma.Decimal; receiptItems: { receivedQuantity: Prisma.Decimal }[] }[],
): number {
  let ordered = new Prisma.Decimal(0);
  let received = new Prisma.Decimal(0);

  for (const item of items) {
    ordered = ordered.plus(item.quantity);
    const lineReceived = item.receiptItems.reduce(
      (sum, entry) => sum.plus(entry.receivedQuantity),
      new Prisma.Decimal(0),
    );
    // An over-delivery on one line does not settle a shortfall on another.
    received = received.plus(
      lineReceived.greaterThan(item.quantity) ? item.quantity : lineReceived,
    );
  }

  if (ordered.isZero()) return 0;
  return received.dividedBy(ordered).toNumber();
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type WriteRow = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  preArchiveStatus: PurchaseOrderStatus | null;
  archivedAt: Date | null;
  updatedAt: Date;
  financeCommitmentId: string | null;
  purchaseRequestId: string | null;
};

async function loadForWrite(context: UserContext, orderId: string): Promise<WriteRow> {
  return assertFound(
    await prisma.purchaseOrder.findFirst({
      where: { AND: [buildOrderScopeWhere(context), { id: orderId }] },
      select: {
        id: true,
        poNumber: true,
        status: true,
        preArchiveStatus: true,
        archivedAt: true,
        updatedAt: true,
        financeCommitmentId: true,
        purchaseRequestId: true,
      },
    }),
  );
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this order while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

async function resolveRelated(context: UserContext, input: OrderInput) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, companyId: context.companyId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!supplier) {
    throw new AccessError("VALIDATION_ERROR", "Choose an active supplier.", {
      code: "INVALID_SUPPLIER",
    });
  }

  let purchaseRequestId: string | null = null;
  if (input.purchaseRequestId) {
    const request = await prisma.purchaseRequest.findFirst({
      where: { AND: [buildRequestScopeWhere(context), { id: input.purchaseRequestId }] },
      select: { id: true },
    });
    if (!request) {
      throw new AccessError("VALIDATION_ERROR", "That purchase request does not exist.", {
        code: "INVALID_REQUEST",
      });
    }
    purchaseRequestId = request.id;
  }

  let projectId: string | null = null;
  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: input.projectId, archivedAt: null }] },
      select: { id: true },
    });
    if (!project) {
      throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
        code: "INVALID_PROJECT",
      });
    }
    projectId = project.id;
  }

  let contractId: string | null = null;
  if (input.contractId) {
    // Validated against the company rather than the caller's Legal scope: a
    // buyer with no contract access still has to be able to record which
    // agreement an order sits under (PRD #19 §168).
    const contract = await prisma.contract.findFirst({
      where: { id: input.contractId, companyId: context.companyId },
      select: { id: true },
    });
    if (!contract) {
      throw new AccessError("VALIDATION_ERROR", "That contract does not exist.", {
        code: "INVALID_CONTRACT",
      });
    }
    contractId = contract.id;
  }

  // The order no longer matches the quote the moment a priced line differs.
  let modifiedFromQuote = false;
  if (input.supplierQuoteId) {
    const quoteItems = await prisma.supplierQuoteItem.findMany({
      where: { supplierQuoteId: input.supplierQuoteId },
      select: { id: true, quantity: true, unitPrice: true },
    });
    const byId = new Map(quoteItems.map((item) => [item.id, item]));

    modifiedFromQuote = input.items.some((line) => {
      if (!line.sourceQuoteItemId) return true;
      const source = byId.get(line.sourceQuoteItemId);
      if (!source) return true;
      return (
        !source.quantity.equals(new Prisma.Decimal(line.quantity)) ||
        !source.unitPrice.equals(new Prisma.Decimal(line.unitPrice))
      );
    });
  }

  return {
    supplierId: supplier.id,
    purchaseRequestId,
    rfqId: input.rfqId ?? null,
    supplierQuoteId: input.supplierQuoteId ?? null,
    projectId,
    contractId,
    modifiedFromQuote,
  };
}

export function toSummaryDTO(row: ListRow, today: Date): OrderSummaryDTO {
  const fraction = receivedFraction(row.items);
  const settled =
    row.status === "RECEIVED" ||
    row.status === "CLOSED" ||
    row.status === "CANCELLED" ||
    row.status === "ARCHIVED";

  const daysToRequired = row.requiredDate ? daysBetween(today, row.requiredDate) : null;

  return {
    id: row.id,
    poNumber: row.poNumber,
    status: row.status,
    supplier: toSupplierRef(row.supplier)!,
    project: row.project,
    orderDate: dateString(row.orderDate)!,
    requiredDate: dateString(row.requiredDate),
    currency: row.currency,
    subtotal: toAmountString(row.subtotal),
    taxAmount: toAmountString(row.taxAmount),
    totalAmount: toAmountString(row.totalAmount),
    receivedFraction: fraction,
    itemCount: row.items.length,
    attention: {
      overdue: daysToRequired !== null && daysToRequired < 0 && !settled,
      daysToRequired,
      awaitingDecision: row.status === "PENDING_APPROVAL",
      awaitingReceipt: acceptsReceipts(row.status) && fraction < 1,
      fullyReceived: fraction >= 1,
    },
    updatedAt: row.updatedAt.toISOString(),
    ...(row.company ? { company: row.company } : {}),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  receiptCount: number,
  pending?: { submittedBy: { memberId: string } | null },
): OrderCapabilities {
  const archived = row.archivedAt !== null;
  const live = !archived;
  const selfSubmitted = pending?.submittedBy?.memberId === context.membershipId;

  const allow = (permission: Parameters<typeof can>[1], condition: boolean) =>
    live && condition && can(context, permission);

  return {
    canEdit: allow("procurement.order.update", isOrderEditable(row.status)),
    canSubmit: allow("procurement.order.submit", isOrderSubmittable(row.status)),
    canApprove:
      live &&
      row.status === "PENDING_APPROVAL" &&
      !selfSubmitted &&
      approvals.canApproveType(context, "PURCHASE_ORDER"),
    canReject:
      live &&
      row.status === "PENDING_APPROVAL" &&
      !selfSubmitted &&
      approvals.canRejectType(context, "PURCHASE_ORDER"),
    canIssue: allow("procurement.order.issue", row.status === "APPROVED"),
    canCancel: allow(
      "procurement.order.cancel",
      canTransitionOrderStatus(row.status, "CANCELLED") &&
        !(row.status === "ISSUED" && receiptCount > 0),
    ),
    canClose: allow("procurement.order.close", isOrderClosable(row.status)),
    canArchive: allow("procurement.order.archive", isOrderArchivable(row.status)),
    canRestore: archived && can(context, "procurement.order.restore"),
    canReceive: allow("procurement.receipt.create", acceptsReceipts(row.status)),
    canViewReceipts: can(context, "procurement.receipt.view"),
    canViewCommitment: canSeeCommitment(context),
    canViewDocuments: can(context, "procurement.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "procurement.activity.view"),
  };
}
