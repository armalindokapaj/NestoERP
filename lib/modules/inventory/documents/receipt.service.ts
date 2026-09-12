import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import {
  dateString,
  loadMemberRef,
  moduleLink,
  toItemRef,
  toLocationRef,
  toWarehouseRef,
} from "../inventory.dto";
import { nextDocumentNumber } from "../inventory.numbering";
import { quantityString, toStoredQuantity } from "../inventory.quantity";
import { buildReceiptScopeWhere, buildWarehouseScopeWhere } from "../inventory.scope";
import type { ReceiptInput, TransactionListQuery } from "../inventory.schema";
import type { ReceiptDetailDTO, ReceiptSummaryDTO, TransactionCapabilities } from "../inventory.types";
import {
  assertCancellable,
  assertEditable,
  assertPostable,
  assertReversible,
  postLines,
  resolveLineTargets,
  reverseMovements,
} from "./posting";

/**
 * Stock coming in (PRD #20 §84–§103).
 *
 * Usually posted from a Procurement delivery, so the two modules agree about
 * what arrived without either owning the other's record. The link is unique:
 * one goods receipt books into stock exactly once, however many times somebody
 * clicks (PRD #20 §91).
 */

const MODULE = "inventory" as const;
const ENTITY = "InventoryReceipt";
const NOUN = "receipt";

const LIST_SELECT = {
  id: true,
  receiptNumber: true,
  status: true,
  receiptDate: true,
  goodsReceiptId: true,
  updatedAt: true,
  warehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.InventoryReceiptSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  notes: true,
  postedAt: true,
  reversedAt: true,
  postedByMemberId: true,
  createdByMemberId: true,
  createdAt: true,
  lines: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      quantity: true,
      unit: true,
      notes: true,
      movementId: true,
      inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
      location: { select: { id: true, code: true, name: true, warehouseId: true } },
    },
  },
} satisfies Prisma.InventoryReceiptSelect;

type ListRow = Prisma.InventoryReceiptGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.InventoryReceiptGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listReceipts(context: UserContext, query: TransactionListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.view");

  const filters: Prisma.InventoryReceiptWhereInput[] = [buildReceiptScopeWhere(context)];
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.warehouseId) filters.push({ warehouseId: query.warehouseId });

  const search = searchClause(query.search, ["receiptNumber", "notes"]);
  if (search) filters.push(search);

  const where: Prisma.InventoryReceiptWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.inventoryReceipt.findMany({
      where,
      orderBy: orderFor(query.sort),
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.inventoryReceipt.count({ where }),
  ]);

  return {
    data: rows.map((row) => toSummaryDTO(context, row)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

function orderFor(
  sort: TransactionListQuery["sort"],
): Prisma.InventoryReceiptOrderByWithRelationInput[] {
  switch (sort) {
    case "date-asc":
      return [{ receiptDate: "asc" }];
    case "number-asc":
      return [{ receiptNumber: "asc" }];
    case "updated-desc":
      return [{ updatedAt: "desc" }];
    default:
      return [{ receiptDate: "desc" }];
  }
}

export async function getReceipt(
  context: UserContext,
  receiptId: string,
): Promise<ReceiptDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.view");

  const row = assertFound(
    await prisma.inventoryReceipt.findFirst({
      where: { AND: [buildReceiptScopeWhere(context), { id: receiptId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [postedBy, createdBy] = await Promise.all([
    loadMemberRef(row.postedByMemberId),
    loadMemberRef(row.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(context, row),
    notes: row.notes,
    lines: row.lines.map((line) => ({
      id: line.id,
      item: toItemRef(line.inventoryItem)!,
      location: toLocationRef(line.location),
      quantity: quantityString(line.quantity),
      unit: line.unit,
      notes: line.notes,
      movementId: line.movementId,
    })),
    postedAt: row.postedAt?.toISOString() ?? null,
    reversedAt: row.reversedAt?.toISOString() ?? null,
    postedBy,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row.status),
  };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createReceipt(
  context: UserContext,
  input: ReceiptInput,
): Promise<ReceiptDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.create");

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);

  const id = await prisma.$transaction(async (tx) => {
    const receiptNumber = await nextDocumentNumber(tx, "inventoryReceipt", context.companyId);

    const receipt = await tx.inventoryReceipt.create({
      data: {
        companyId: context.companyId,
        receiptNumber,
        warehouseId: warehouse.id,
        receiptDate: input.receiptDate,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            quantity: toStoredQuantity(line.quantity),
            // The item's own unit, never one the browser chose (PRD #20 §73).
            unit: targets.units.get(line.inventoryItemId)!,
            notes: line.notes ?? null,
          })),
        },
      },
      select: { id: true, receiptNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: receipt.id,
      action: "INVENTORY_RECEIPT_CREATED",
      message: `drafted receipt ${receipt.receiptNumber}`,
    });

    return receipt.id;
  });

  return getReceipt(context, id);
}

export async function updateReceipt(
  context: UserContext,
  receiptId: string,
  input: ReceiptInput,
): Promise<ReceiptDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.create");

  const existing = await loadForWrite(context, receiptId);
  assertEditable(existing.status, NOUN);
  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);

  await prisma.$transaction(async (tx) => {
    await tx.inventoryReceiptLine.deleteMany({ where: { inventoryReceiptId: receiptId } });

    await tx.inventoryReceipt.update({
      where: { id: receiptId },
      data: {
        warehouseId: warehouse.id,
        receiptDate: input.receiptDate,
        notes: input.notes ?? null,
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            quantity: toStoredQuantity(line.quantity),
            unit: targets.units.get(line.inventoryItemId)!,
            notes: line.notes ?? null,
          })),
        },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: receiptId,
      action: "INVENTORY_RECEIPT_UPDATED",
      message: `updated receipt ${existing.receiptNumber}`,
    });
  });

  return getReceipt(context, receiptId);
}

/** Commits the receipt to the ledger: stock exists after this (PRD #20 §97). */
export async function postReceipt(context: UserContext, receiptId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.post");

  const existing = await loadForWrite(context, receiptId);
  assertPostable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    const lines = await tx.inventoryReceiptLine.findMany({
      where: { inventoryReceiptId: receiptId },
      select: { id: true, inventoryItemId: true, locationId: true, quantity: true, unit: true },
    });

    if (lines.length === 0) {
      throw new AccessError("VALIDATION_ERROR", "Add at least one line before posting.", {
        code: "DOCUMENT_EMPTY",
      });
    }

    const posted = await postLines(
      tx,
      context,
      lines.map((line) => ({
        id: line.id,
        inventoryItemId: line.inventoryItemId,
        warehouseId: existing.warehouseId,
        locationId: line.locationId,
        quantity: line.quantity,
        unit: line.unit,
        movementType: "RECEIPT" as const,
      })),
      { module: MODULE, entityType: "inventory_receipt", entityId: receiptId },
      existing.receiptDate,
    );

    for (const entry of posted) {
      await tx.inventoryReceiptLine.update({
        where: { id: entry.lineId },
        data: { movementId: entry.movementId },
      });
    }

    // Conditional on DRAFT, so two people posting at once settle once.
    const result = await tx.inventoryReceipt.updateMany({
      where: { id: receiptId, status: "DRAFT" },
      data: { status: "POSTED", postedAt: new Date(), postedByMemberId: context.membershipId },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "That receipt has already been posted.", {
        code: "STALE_RECORD",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: receiptId,
      action: "INVENTORY_RECEIPT_POSTED",
      message: `posted receipt ${existing.receiptNumber} to stock`,
      metadata: { lines: lines.length } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelReceipt(context: UserContext, receiptId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.create");

  const existing = await loadForWrite(context, receiptId);
  assertCancellable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    await tx.inventoryReceipt.update({ where: { id: receiptId }, data: { status: "CANCELLED" } });
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: receiptId,
      action: "INVENTORY_RECEIPT_CANCELLED",
      message: `cancelled draft receipt ${existing.receiptNumber}`,
    });
  });
}

/** Takes the stock back out again, without erasing that it came in (§100). */
export async function reverseReceipt(context: UserContext, receiptId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.reverse");

  const existing = await loadForWrite(context, receiptId);
  assertReversible(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    const lines = await tx.inventoryReceiptLine.findMany({
      where: { inventoryReceiptId: receiptId, movementId: { not: null } },
      select: { movementId: true },
    });

    await reverseMovements(
      tx,
      context,
      lines.map((line) => line.movementId!),
      { module: MODULE, entityType: "inventory_receipt", entityId: receiptId },
      new Date(),
    );

    const result = await tx.inventoryReceipt.updateMany({
      where: { id: receiptId, status: "POSTED" },
      data: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversedByMemberId: context.membershipId,
      },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "That receipt has already been reversed.", {
        code: "STALE_RECORD",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: receiptId,
      action: "INVENTORY_RECEIPT_REVERSED",
      message: `reversed receipt ${existing.receiptNumber}`,
    });
  });
}

/**
 * Books a Procurement delivery into stock (PRD #20 §89–§94).
 *
 * Idempotent by construction: `goodsReceiptId` is unique, so a second attempt
 * finds the receipt the first one made rather than doubling the stock
 * (PRD #20 §91).
 *
 * The caller supplies the mapping from delivery line to inventory item, because
 * Procurement buys "Rebar B500C 16mm" as free text and Inventory holds SKUs —
 * guessing the correspondence would put the wrong material on the shelf
 * (PRD #20 §93).
 */
export async function postFromGoodsReceipt(
  context: UserContext,
  goodsReceiptId: string,
  input: {
    warehouseId: string;
    lines: { goodsReceiptItemId: string; inventoryItemId: string; locationId: string }[];
  },
): Promise<ReceiptDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.receipt.create");

  const existing = await prisma.inventoryReceipt.findFirst({
    where: { goodsReceiptId, companyId: context.companyId },
    select: { id: true },
  });
  if (existing) return getReceipt(context, existing.id);

  const delivery = assertFound(
    await prisma.goodsReceipt.findFirst({
      where: { id: goodsReceiptId, companyId: context.companyId, status: "RECORDED" },
      select: {
        id: true,
        receiptNumber: true,
        receiptDate: true,
        items: { select: { id: true, acceptedQuantity: true } },
      },
    }),
  );

  /*
   * Only the accepted quantity becomes stock (PRD #20 §90). What was rejected
   * went back on the lorry, and booking it in would put material on the shelf
   * that is not there.
   */
  const acceptedById = new Map(
    delivery.items
      .filter((item) => item.acceptedQuantity.greaterThan(0))
      .map((item) => [item.id, item.acceptedQuantity]),
  );

  if (acceptedById.size === 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Nothing on that delivery was accepted, so there is nothing to book in.",
      { code: "NOTHING_ACCEPTED" },
    );
  }

  const mapped = input.lines.filter((line) => acceptedById.has(line.goodsReceiptItemId));
  if (mapped.length === 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Map at least one accepted delivery line to an inventory item.",
      { code: "MAPPING_REQUIRED" },
    );
  }

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const targets = await resolveLineTargets(context, mapped, [warehouse.id]);

  const id = await prisma.$transaction(async (tx) => {
    const receiptNumber = await nextDocumentNumber(tx, "inventoryReceipt", context.companyId);

    const receipt = await tx.inventoryReceipt.create({
      data: {
        companyId: context.companyId,
        receiptNumber,
        goodsReceiptId: delivery.id,
        warehouseId: warehouse.id,
        receiptDate: delivery.receiptDate,
        status: "DRAFT",
        notes: `Booked in from Procurement delivery ${delivery.receiptNumber}.`,
        createdByMemberId: context.membershipId,
        lines: {
          create: mapped.map((line) => ({
            goodsReceiptItemId: line.goodsReceiptItemId,
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            quantity: acceptedById.get(line.goodsReceiptItemId)!,
            unit: targets.units.get(line.inventoryItemId)!,
          })),
        },
      },
      select: { id: true, receiptNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: receipt.id,
      action: "INVENTORY_RECEIPT_FROM_PROCUREMENT",
      message: `drafted receipt ${receipt.receiptNumber} from delivery ${delivery.receiptNumber}`,
      metadata: { goodsReceiptId: delivery.id } as Prisma.InputJsonValue,
    });

    return receipt.id;
  });

  return getReceipt(context, id);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function loadForWrite(context: UserContext, receiptId: string) {
  return assertFound(
    await prisma.inventoryReceipt.findFirst({
      where: { AND: [buildReceiptScopeWhere(context), { id: receiptId }] },
      select: {
        id: true,
        receiptNumber: true,
        status: true,
        warehouseId: true,
        receiptDate: true,
        updatedAt: true,
      },
    }),
  );
}

async function requireWarehouse(context: UserContext, warehouseId: string) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { AND: [buildWarehouseScopeWhere(context), { id: warehouseId, status: "ACTIVE" }] },
    select: { id: true },
  });

  if (!warehouse) {
    throw new AccessError("VALIDATION_ERROR", "Choose an active warehouse.", {
      code: "INVALID_WAREHOUSE",
    });
  }

  return warehouse;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this receipt while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(context: UserContext, row: ListRow): ReceiptSummaryDTO {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    status: row.status,
    warehouse: toWarehouseRef(row.warehouse)!,
    receiptDate: dateString(row.receiptDate)!,
    lineCount: row._count.lines,
    goodsReceiptLink: row.goodsReceiptId
      ? moduleLink(
          row.goodsReceiptId,
          "Procurement delivery",
          `/procurement/orders`,
          can(context, "procurement.receipt.view"),
        )
      : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function capabilitiesFor(
  context: UserContext,
  status: DetailRow["status"],
): TransactionCapabilities {
  return {
    canEdit: status === "DRAFT" && can(context, "inventory.receipt.create"),
    canPost: status === "DRAFT" && can(context, "inventory.receipt.post"),
    canCancel: status === "DRAFT" && can(context, "inventory.receipt.create"),
    canReverse: status === "POSTED" && can(context, "inventory.receipt.reverse"),
    canViewDocuments: can(context, "inventory.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "inventory.activity.view"),
  };
}
