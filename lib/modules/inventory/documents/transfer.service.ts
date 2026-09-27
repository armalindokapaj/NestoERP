import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { recordActivity } from "@/lib/modules/shared/activity";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { applyStockMovement } from "../balances/balance.service";
import { dateString, loadMemberRef, toItemRef, toLocationRef, toWarehouseRef } from "../inventory.dto";
import { nextDocumentNumber } from "../inventory.numbering";
import { quantityString, toStoredQuantity } from "../inventory.quantity";
import { buildTransferScopeWhere, buildWarehouseScopeWhere } from "../inventory.scope";
import type { TransactionListQuery, TransferInput } from "../inventory.schema";
import type {
  TransactionCapabilities,
  TransferDetailDTO,
  TransferSummaryDTO,
} from "../inventory.types";
import {
  assertCancellable,
  assertEditable,
  assertPostable,
  assertReversible,
  resolveLineTargets,
  reverseMovements,
} from "./posting";
import { stockTransferMachine } from "./transfer.machine";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Stock moving between locations (PRD #20 §129–§140).
 *
 * Each line posts **two** movements — out of one place, into another — in one
 * transaction. Total stock does not change; only where it is does. Posting the
 * two halves separately would allow a state where material exists in neither
 * warehouse, which is the one thing a transfer must never produce
 * (PRD #20 §137, §138).
 */

const MODULE = "inventory" as const;
const ENTITY = "StockTransfer";
const NOUN = "transfer";

const LIST_SELECT = {
  id: true,
  transferNumber: true,
  status: true,
  transferDate: true,
  updatedAt: true,
  fromWarehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  toWarehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.StockTransferSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  notes: true,
  fromWarehouseId: true,
  toWarehouseId: true,
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
      outMovementId: true,
      inMovementId: true,
      inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
      fromLocation: { select: { id: true, code: true, name: true, warehouseId: true } },
      toLocation: { select: { id: true, code: true, name: true, warehouseId: true } },
    },
  },
} satisfies Prisma.StockTransferSelect;

type ListRow = Prisma.StockTransferGetPayload<{ select: typeof LIST_SELECT }>;

export async function listTransfers(context: UserContext, query: TransactionListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.transfer.view");

  const filters: Prisma.StockTransferWhereInput[] = [buildTransferScopeWhere(context)];
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.warehouseId) {
    filters.push({
      OR: [{ fromWarehouseId: query.warehouseId }, { toWarehouseId: query.warehouseId }],
    });
  }

  const search = searchClause(query.search, ["transferNumber", "notes"]);
  if (search) filters.push(search);

  const where: Prisma.StockTransferWhereInput = { AND: filters };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "inventory.transfers.list",
    async (tx) => {
      const window = pageWindow(await tx.stockTransfer.count({ where }), query.page, query.limit);
      const rows = await tx.stockTransfer.findMany({
        where,
        // Every sort the toolbar offers, each ending in the id — number and updated no longer fall back to the date (AUD-08 §4, DT-04).
        orderBy: withTieBreaker<Prisma.StockTransferOrderByWithRelationInput>(
          query.sort === "date-asc"
            ? [{ transferDate: "asc" }]
            : query.sort === "number-asc"
              ? [{ transferNumber: "asc" }]
              : query.sort === "updated-desc"
                ? [{ updatedAt: "desc" }]
                : [{ transferDate: "desc" }],
        ),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: LIST_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  return {
    data: rows.map(toSummaryDTO),
    pagination: window,
  };
}

export async function getTransfer(
  context: UserContext,
  transferId: string,
): Promise<TransferDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.transfer.view");

  const row = assertFound(
    await prisma.stockTransfer.findFirst({
      where: { AND: [buildTransferScopeWhere(context), { id: transferId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [postedBy, createdBy] = await Promise.all([
    loadMemberRef(row.postedByMemberId),
    loadMemberRef(row.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(row),
    notes: row.notes,
    lines: row.lines.map((line) => ({
      id: line.id,
      item: toItemRef(line.inventoryItem)!,
      fromLocation: toLocationRef(line.fromLocation)!,
      toLocation: toLocationRef(line.toLocation)!,
      quantity: quantityString(line.quantity),
      unit: line.unit,
      notes: line.notes,
    })),
    postedBy,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row.status),
  };
}

export async function createTransfer(
  context: UserContext,
  input: TransferInput,
): Promise<TransferDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.transfer.create");

  const [from, to] = await Promise.all([
    requireWarehouse(context, input.fromWarehouseId),
    requireWarehouse(context, input.toWarehouseId),
  ]);

  const targets = await resolveLineTargets(
    context,
    input.lines.flatMap((line) => [
      { inventoryItemId: line.inventoryItemId, locationId: line.fromLocationId },
      { inventoryItemId: line.inventoryItemId, locationId: line.toLocationId },
    ]),
    [from.id, to.id],
  );

  const id = await prisma.$transaction(async (tx) => {
    const transferNumber = await nextDocumentNumber(tx, "stockTransfer", context.companyId);

    const transfer = await tx.stockTransfer.create({
      data: {
        companyId: context.companyId,
        transferNumber,
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        transferDate: input.transferDate,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            fromLocationId: line.fromLocationId,
            toLocationId: line.toLocationId,
            quantity: toStoredQuantity(line.quantity),
            unit: targets.units.get(line.inventoryItemId)!,
            notes: line.notes ?? null,
          })),
        },
      },
      select: { id: true, transferNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: transfer.id,
      action: "INVENTORY_TRANSFER_CREATED",
      message: `drafted transfer ${transfer.transferNumber}`,
    });

    return transfer.id;
  });

  return getTransfer(context, id);
}

export async function updateTransfer(
  context: UserContext,
  transferId: string,
  input: TransferInput,
): Promise<TransferDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.transfer.update");

  const existing = await loadForWrite(context, transferId);
  assertEditable(existing.status, NOUN);
  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const [from, to] = await Promise.all([
    requireWarehouse(context, input.fromWarehouseId),
    requireWarehouse(context, input.toWarehouseId),
  ]);

  const targets = await resolveLineTargets(
    context,
    input.lines.flatMap((line) => [
      { inventoryItemId: line.inventoryItemId, locationId: line.fromLocationId },
      { inventoryItemId: line.inventoryItemId, locationId: line.toLocationId },
    ]),
    [from.id, to.id],
  );

  await prisma.$transaction(async (tx) => {
    // Still a draft, decided by the write rather than by the read above: a
    // transfer posted while this form was open keeps the lines it was posted
    // with, instead of having them replaced under its movements.
    const editing = await tx.stockTransfer.updateMany({
      where: { id: transferId, companyId: context.companyId, status: existing.status },
      data: {
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        transferDate: input.transferDate,
        notes: input.notes ?? null,
      },
    });
    if (editing.count === 0) {
      throw new AccessError("CONFLICT", "This transfer was posted or cancelled while you were editing it. Reload to see the latest.", {
        code: "STOCK_TRANSFER_STALE",
      });
    }

    await tx.stockTransferLine.deleteMany({ where: { stockTransferId: transferId } });
    await tx.stockTransfer.update({
      where: { id: transferId },
      data: {
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            fromLocationId: line.fromLocationId,
            toLocationId: line.toLocationId,
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
      entityId: transferId,
      action: "INVENTORY_TRANSFER_UPDATED",
      message: `updated transfer ${existing.transferNumber}`,
    });
  });

  return getTransfer(context, transferId);
}

/** Moves the stock: two movements per line, atomically (PRD #20 §136, §137). */
export async function postTransfer(context: UserContext, transferId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.transfer.post");

  const existing = await loadForWrite(context, transferId);
  assertPostable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    /*
     * Claimed before anything reaches the ledger. Two people posting at once
     * both read a draft; the second waits here on the first, finds the
     * transfer posted, and stops before moving the stock a second time. The
     * lines are read after the claim, so they are the lines that were posted.
     */
    await applyTransition(tx, {
      machine: stockTransferMachine,
      action: "post",
      id: transferId,
      context,
      from: existing.status,
      data: { postedByMemberId: context.membershipId },
    });

    const lines = await tx.stockTransferLine.findMany({
      where: { stockTransferId: transferId },
      // Ordered so concurrent transfers take their row locks in the same
      // sequence and cannot deadlock against each other (PRD #20 §286).
      orderBy: [{ fromLocationId: "asc" }, { inventoryItemId: "asc" }],
      select: {
        id: true,
        inventoryItemId: true,
        fromLocationId: true,
        toLocationId: true,
        quantity: true,
        unit: true,
      },
    });

    if (lines.length === 0) {
      throw new AccessError("VALIDATION_ERROR", "Add at least one line before posting.", {
        code: "DOCUMENT_EMPTY",
      });
    }

    const source = { module: MODULE, entityType: "stock_transfer", entityId: transferId };

    for (const line of lines) {
      // Out first: if the source has nothing, nothing arrives anywhere.
      const outId = await applyStockMovement(tx, context, {
        inventoryItemId: line.inventoryItemId,
        warehouseId: existing.fromWarehouseId,
        locationId: line.fromLocationId,
        movementType: "TRANSFER_OUT",
        quantity: line.quantity,
        unit: line.unit,
        source: { ...source, lineId: line.id },
        occurredAt: existing.transferDate,
      });

      const inId = await applyStockMovement(tx, context, {
        inventoryItemId: line.inventoryItemId,
        warehouseId: existing.toWarehouseId,
        locationId: line.toLocationId,
        movementType: "TRANSFER_IN",
        quantity: line.quantity,
        unit: line.unit,
        source: { ...source, lineId: line.id },
        occurredAt: existing.transferDate,
      });

      await tx.stockTransferLine.update({
        where: { id: line.id },
        data: { outMovementId: outId, inMovementId: inId },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: transferId,
      action: "INVENTORY_TRANSFER_POSTED",
      message: `posted transfer ${existing.transferNumber}`,
    });
  });
}

export async function cancelTransfer(context: UserContext, transferId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.transfer.cancel");

  const existing = await loadForWrite(context, transferId);
  assertCancellable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: stockTransferMachine,
      action: "cancel",
      id: transferId,
      context,
      from: existing.status,
    });
  });
}

export async function reverseTransfer(context: UserContext, transferId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.transfer.reverse");

  const existing = await loadForWrite(context, transferId);
  assertReversible(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    // Claimed first for the same reason as posting: a second reversal stops
    // here rather than moving the stock back twice.
    await applyTransition(tx, {
      machine: stockTransferMachine,
      action: "reverse",
      id: transferId,
      context,
      from: existing.status,
    });

    const lines = await tx.stockTransferLine.findMany({
      where: { stockTransferId: transferId },
      select: { outMovementId: true, inMovementId: true },
    });

    const movementIds = lines
      .flatMap((line) => [line.outMovementId, line.inMovementId])
      .filter((id): id is string => id !== null);

    await reverseMovements(
      tx,
      context,
      movementIds,
      { module: MODULE, entityType: "stock_transfer", entityId: transferId },
      new Date(),
    );

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: transferId,
      action: "INVENTORY_TRANSFER_REVERSED",
      message: `reversed transfer ${existing.transferNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function loadForWrite(context: UserContext, transferId: string) {
  return assertFound(
    await prisma.stockTransfer.findFirst({
      where: { AND: [buildTransferScopeWhere(context), { id: transferId }] },
      select: {
        id: true,
        transferNumber: true,
        status: true,
        fromWarehouseId: true,
        toWarehouseId: true,
        transferDate: true,
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
    throw new AccessError("VALIDATION_ERROR", "Choose an active warehouse at both ends.", {
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
      "Somebody else changed this transfer while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(row: ListRow): TransferSummaryDTO {
  return {
    id: row.id,
    transferNumber: row.transferNumber,
    status: row.status,
    fromWarehouse: toWarehouseRef(row.fromWarehouse)!,
    toWarehouse: toWarehouseRef(row.toWarehouse)!,
    transferDate: dateString(row.transferDate)!,
    lineCount: row._count.lines,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  status: ListRow["status"],
): TransactionCapabilities {
  return {
    canEdit: status === "DRAFT" && can(context, "inventory.transfer.update"),
    canPost: status === "DRAFT" && can(context, "inventory.transfer.post"),
    canCancel: status === "DRAFT" && can(context, "inventory.transfer.cancel"),
    canReverse: status === "POSTED" && can(context, "inventory.transfer.reverse"),
    canViewDocuments: can(context, "inventory.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "inventory.activity.view"),
  };
}
