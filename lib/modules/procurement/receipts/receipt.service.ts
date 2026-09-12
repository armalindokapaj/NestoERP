import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { dateString, quantityString, toMemberRef, toSupplierRef } from "./receipt.dto";
import { nextDocumentNumber } from "../procurement.numbering";
import { buildOrderScopeWhere, buildReceiptScopeWhere } from "../procurement.scope";
import type { ReceiptInput } from "../procurement.schema";
import { acceptsReceipts } from "../procurement.status";
import type { ReceiptDTO } from "../procurement.types";
import { refreshReceiptState } from "../orders/order.service";

/**
 * Goods receipts (PRD #19 §132–§147).
 *
 * What actually turned up. Receipts are additive: a correction is a new receipt
 * or a void, never an edit of what was recorded as delivered. The quantities on
 * a receipt are somebody's statement about a delivery that happened, and
 * rewriting one erases who said what (PRD #19 §143, §144).
 *
 * Over-receipt is a confirmation rather than a refusal: more can genuinely
 * arrive than was ordered, and a system that refuses to record it is a system
 * people work around (PRD #19 §139).
 */

const MODULE = "procurement" as const;

const RECEIPT_SELECT = {
  id: true,
  receiptNumber: true,
  purchaseOrderId: true,
  receiptDate: true,
  deliveryReference: true,
  status: true,
  notes: true,
  voidReason: true,
  voidedAt: true,
  receivedByMemberId: true,
  createdAt: true,
  purchaseOrder: { select: { id: true, poNumber: true } },
  supplier: { select: { id: true, name: true, status: true } },
  project: { select: { id: true, code: true, name: true } },
  receivedBy: {
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  },
  items: {
    select: {
      id: true,
      purchaseOrderItemId: true,
      receivedQuantity: true,
      acceptedQuantity: true,
      rejectedQuantity: true,
      notes: true,
      purchaseOrderItem: { select: { description: true, unit: true, sortOrder: true } },
    },
  },
} satisfies Prisma.GoodsReceiptSelect;

type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ select: typeof RECEIPT_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listForOrder(
  context: UserContext,
  orderId: string,
): Promise<ReceiptDTO[]> {
  if (!can(context, "procurement.receipt.view")) return [];

  const reachable = await prisma.purchaseOrder.findFirst({
    where: { AND: [buildOrderScopeWhere(context), { id: orderId }] },
    select: { id: true },
  });
  if (!reachable) return [];

  const rows = await prisma.goodsReceipt.findMany({
    where: { purchaseOrderId: orderId },
    orderBy: { receiptDate: "desc" },
    select: RECEIPT_SELECT,
  });

  return rows.map((row) => toDTO(context, row));
}

export async function listReceipts(
  context: UserContext,
  options: { page?: number; limit?: number; supplierId?: string; projectId?: string } = {},
) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.receipt.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.GoodsReceiptWhereInput = {
    AND: [
      buildReceiptScopeWhere(context),
      ...(options.supplierId ? [{ supplierId: options.supplierId }] : []),
      ...(options.projectId ? [{ projectId: options.projectId }] : []),
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      orderBy: { receiptDate: "desc" },
      skip: skipFor(page, limit),
      take: limit,
      select: RECEIPT_SELECT,
    }),
    prisma.goodsReceipt.count({ where }),
  ]);

  return {
    data: rows.map((row) => toDTO(context, row)),
    pagination: paginationMeta(total, page, limit),
  };
}

export async function getReceipt(context: UserContext, receiptId: string): Promise<ReceiptDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.receipt.view");

  const row = assertFound(
    await prisma.goodsReceipt.findFirst({
      where: { AND: [buildReceiptScopeWhere(context), { id: receiptId }] },
      select: RECEIPT_SELECT,
    }),
  );

  return toDTO(context, row);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export type OverReceiptLine = { description: string; ordered: string; alreadyReceived: string; now: string };

export async function recordReceipt(
  context: UserContext,
  orderId: string,
  input: ReceiptInput,
): Promise<ReceiptDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.receipt.create");

  const order = assertFound(
    await prisma.purchaseOrder.findFirst({
      where: { AND: [buildOrderScopeWhere(context), { id: orderId }] },
      select: {
        id: true,
        poNumber: true,
        status: true,
        supplierId: true,
        projectId: true,
        items: {
          select: {
            id: true,
            description: true,
            quantity: true,
            receiptItems: {
              where: { goodsReceipt: { status: "RECORDED" } },
              select: { receivedQuantity: true },
            },
          },
        },
      },
    }),
  );

  if (!acceptsReceipts(order.status)) {
    throw new AccessError(
      "CONFLICT",
      "Goods can only be booked in against an order the supplier has been sent.",
      { code: "ORDER_NOT_RECEIVING" },
    );
  }

  const byItem = new Map(order.items.map((item) => [item.id, item]));
  const overReceipts: OverReceiptLine[] = [];

  for (const line of input.items) {
    const item = byItem.get(line.purchaseOrderItemId);
    if (!item) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "A receipt line does not belong to this order.",
        { code: "INVALID_RECEIPT_LINE" },
      );
    }

    const already = item.receiptItems.reduce(
      (sum, entry) => sum.plus(entry.receivedQuantity),
      new Prisma.Decimal(0),
    );
    const now = new Prisma.Decimal(line.receivedQuantity);

    if (already.plus(now).greaterThan(item.quantity)) {
      overReceipts.push({
        description: item.description,
        ordered: quantityString(item.quantity),
        alreadyReceived: quantityString(already),
        now: quantityString(now),
      });
    }
  }

  /*
   * More arriving than was ordered is a real event, not a mistake to refuse.
   * The first attempt asks; the confirmed one records it (PRD #19 §139).
   */
  if (overReceipts.length > 0 && !input.acknowledgeOverReceipt) {
    throw new AccessError(
      "CONFLICT",
      "More is arriving than was ordered on one or more lines. Confirm to record it anyway.",
      { code: "OVER_RECEIPT", lines: overReceipts },
    );
  }

  const receivedBy = await resolveReceiver(context, input.receivedByMemberId);

  const id = await prisma.$transaction(async (tx) => {
    const receiptNumber = await nextDocumentNumber(tx, "goodsReceipt", context.companyId);

    const receipt = await tx.goodsReceipt.create({
      data: {
        companyId: context.companyId,
        receiptNumber,
        purchaseOrderId: orderId,
        projectId: order.projectId,
        supplierId: order.supplierId,
        receiptDate: input.receiptDate,
        deliveryReference: input.deliveryReference ?? null,
        status: "RECORDED",
        receivedByMemberId: receivedBy,
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        items: {
          create: input.items.map((line) => {
            const received = new Prisma.Decimal(line.receivedQuantity);
            const rejected = new Prisma.Decimal(line.rejectedQuantity);
            return {
              purchaseOrderItemId: line.purchaseOrderItemId,
              receivedQuantity: received,
              // Accepted is what arrived less what was turned away: it is
              // derived, never a third number somebody types (PRD #19 §134).
              acceptedQuantity: received.minus(rejected),
              rejectedQuantity: rejected,
              notes: line.notes ?? null,
            };
          }),
        },
      },
      select: { id: true, receiptNumber: true },
    });

    await refreshReceiptState(tx, context, orderId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "PurchaseOrder",
      entityId: orderId,
      action: "PROCUREMENT_RECEIPT_RECORDED",
      message: `recorded delivery ${receipt.receiptNumber} against order ${order.poNumber}`,
      metadata: { receiptId: receipt.id, lines: input.items.length } as Prisma.InputJsonValue,
    });

    return receipt.id;
  });

  return getReceipt(context, id);
}

/**
 * Voids a receipt (PRD #19 §143).
 *
 * The row stays, marked void with a reason, and stops counting toward what has
 * arrived. Deleting it would erase that somebody recorded a delivery, which is
 * exactly the fact an audit needs.
 */
/**
 * A delivery that other modules have already acted on cannot simply be voided
 * (PRD #21 §104, PRD #20 §370).
 *
 * Quality may have inspected and released it; Inventory may have booked it into
 * stock. Voiding underneath either would leave a quality release pointing at a
 * delivery that no longer happened, or stock on a shelf with nothing behind it.
 * The downstream record has to be cancelled or reversed first, by whoever owns
 * that module.
 */
async function assertNoDownstreamState(
  context: UserContext,
  receiptId: string,
  receiptNumber: string,
): Promise<void> {
  const [release, inventoryReceipt, inspection] = await Promise.all([
    prisma.qualityMaterialRelease.findFirst({
      where: {
        companyId: context.companyId,
        goodsReceiptItem: { is: { goodsReceiptId: receiptId } },
        status: { in: ["RELEASED", "PARTIALLY_RELEASED"] },
      },
      select: { id: true },
    }),
    prisma.inventoryReceipt.findFirst({
      where: { companyId: context.companyId, goodsReceiptId: receiptId, status: "POSTED" },
      select: { receiptNumber: true },
    }),
    prisma.qualityInspection.findFirst({
      where: {
        companyId: context.companyId,
        goodsReceiptId: receiptId,
        status: { in: ["APPROVED", "CLOSED"] },
      },
      select: { inspectionNumber: true },
    }),
  ]);

  if (inventoryReceipt) {
    throw new AccessError(
      "CONFLICT",
      `Inventory has already booked ${receiptNumber} in as ${inventoryReceipt.receiptNumber}. Reverse that first.`,
      { code: "INVENTORY_POSTED" },
    );
  }

  if (release) {
    throw new AccessError(
      "CONFLICT",
      `Quality has released material from ${receiptNumber}. Revoke the release first.`,
      { code: "QUALITY_RELEASED" },
    );
  }

  if (inspection) {
    throw new AccessError(
      "CONFLICT",
      `Quality inspection ${inspection.inspectionNumber} has been decided against ${receiptNumber}. Cancel it first.`,
      { code: "QUALITY_DECIDED" },
    );
  }
}

export async function voidReceipt(
  context: UserContext,
  receiptId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.receipt.void");

  const existing = assertFound(
    await prisma.goodsReceipt.findFirst({
      where: { AND: [buildReceiptScopeWhere(context), { id: receiptId }] },
      select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true },
    }),
  );

  if (existing.status === "VOIDED") return;

  await assertNoDownstreamState(context, receiptId, existing.receiptNumber);

  await prisma.$transaction(async (tx) => {
    const result = await tx.goodsReceipt.updateMany({
      where: { id: receiptId, status: "RECORDED" },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedByMemberId: context.membershipId,
        voidReason: reason,
      },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "That receipt has already been voided.", {
        code: "STALE_RECORD",
      });
    }

    // What has arrived just changed, so the order says so.
    await refreshReceiptState(tx, context, existing.purchaseOrderId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: "PurchaseOrder",
      entityId: existing.purchaseOrderId,
      action: "PROCUREMENT_RECEIPT_VOIDED",
      message: `voided delivery ${existing.receiptNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function resolveReceiver(
  context: UserContext,
  memberId: string | undefined,
): Promise<string> {
  if (!memberId) return context.membershipId;

  const member = await prisma.companyMember.findFirst({
    where: { id: memberId, companyId: context.companyId, status: "ACTIVE" },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Choose an active member of this company as the receiver.",
      { code: "INVALID_RECEIVER" },
    );
  }

  return member.id;
}

function toDTO(context: UserContext, row: ReceiptRow): ReceiptDTO {
  const recorded = row.status === "RECORDED";

  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    purchaseOrderId: row.purchaseOrderId,
    poNumber: row.purchaseOrder.poNumber,
    supplier: toSupplierRef(row.supplier)!,
    project: row.project,
    receiptDate: dateString(row.receiptDate)!,
    deliveryReference: row.deliveryReference,
    status: row.status,
    receivedBy: toMemberRef(row.receivedBy),
    notes: row.notes,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    items: [...row.items]
      .sort((a, b) => a.purchaseOrderItem.sortOrder - b.purchaseOrderItem.sortOrder)
      .map((item) => ({
        id: item.id,
        purchaseOrderItemId: item.purchaseOrderItemId,
        description: item.purchaseOrderItem.description,
        unit: item.purchaseOrderItem.unit,
        receivedQuantity: quantityString(item.receivedQuantity),
        acceptedQuantity: quantityString(item.acceptedQuantity),
        rejectedQuantity: quantityString(item.rejectedQuantity),
        notes: item.notes,
      })),
    capabilities: {
      canVoid: recorded && can(context, "procurement.receipt.void"),
      // There is no edit: a correction is a new receipt or a void (§144).
      canEdit: false,
    },
    createdAt: row.createdAt.toISOString(),
  };
}
