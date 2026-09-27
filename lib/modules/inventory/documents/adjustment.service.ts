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
import { ZERO, quantityString, toStoredQuantity } from "../inventory.quantity";
import { buildAdjustmentScopeWhere, buildWarehouseScopeWhere } from "../inventory.scope";
import type { AdjustmentInput, TransactionListQuery } from "../inventory.schema";
import { allowsNegativeResult } from "../inventory.status";
import type {
  AdjustmentDetailDTO,
  AdjustmentSummaryDTO,
  TransactionCapabilities,
} from "../inventory.types";
import {
  assertCancellable,
  assertEditable,
  assertPostable,
  assertReversible,
  resolveLineTargets,
  reverseMovements,
} from "./posting";
import { stockAdjustmentMachine } from "./adjustment.machine";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Corrections to what the system believes is there (PRD #20 §141–§151).
 *
 * The only action that can make stock appear without anything arriving, which
 * is why it carries a reason, sits behind its own permission, and is the one
 * place an audit looks first (PRD #20 §144, §146).
 *
 * An opening balance is the single exception to the no-negative rule: it has no
 * history behind it to draw from, because it *is* the history (PRD #20 §149).
 */

const MODULE = "inventory" as const;
const ENTITY = "StockAdjustment";
const NOUN = "adjustment";

const LIST_SELECT = {
  id: true,
  adjustmentNumber: true,
  status: true,
  adjustmentDate: true,
  reason: true,
  updatedAt: true,
  warehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.StockAdjustmentSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  notes: true,
  warehouseId: true,
  postedByMemberId: true,
  createdByMemberId: true,
  createdAt: true,
  lines: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      quantityDelta: true,
      unit: true,
      notes: true,
      inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
      location: { select: { id: true, code: true, name: true, warehouseId: true } },
    },
  },
} satisfies Prisma.StockAdjustmentSelect;

type ListRow = Prisma.StockAdjustmentGetPayload<{ select: typeof LIST_SELECT }>;

export async function listAdjustments(context: UserContext, query: TransactionListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.adjustment.view");

  const filters: Prisma.StockAdjustmentWhereInput[] = [buildAdjustmentScopeWhere(context)];
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.warehouseId) filters.push({ warehouseId: query.warehouseId });
  if (query.reason) filters.push({ reason: query.reason });

  const search = searchClause(query.search, ["adjustmentNumber", "notes"]);
  if (search) filters.push(search);

  const where: Prisma.StockAdjustmentWhereInput = { AND: filters };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "inventory.adjustments.list",
    async (tx) => {
      const window = pageWindow(await tx.stockAdjustment.count({ where }), query.page, query.limit);
      const rows = await tx.stockAdjustment.findMany({
        where,
        // Every sort the toolbar offers, each ending in the id — number and updated no longer fall back to the date (AUD-08 §4, DT-04).
        orderBy: withTieBreaker<Prisma.StockAdjustmentOrderByWithRelationInput>(
          query.sort === "date-asc"
            ? [{ adjustmentDate: "asc" }]
            : query.sort === "number-asc"
              ? [{ adjustmentNumber: "asc" }]
              : query.sort === "updated-desc"
                ? [{ updatedAt: "desc" }]
                : [{ adjustmentDate: "desc" }],
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

export async function getAdjustment(
  context: UserContext,
  adjustmentId: string,
): Promise<AdjustmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.adjustment.view");

  const row = assertFound(
    await prisma.stockAdjustment.findFirst({
      where: { AND: [buildAdjustmentScopeWhere(context), { id: adjustmentId }] },
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
      location: toLocationRef(line.location)!,
      quantityDelta: quantityString(line.quantityDelta),
      unit: line.unit,
      notes: line.notes,
    })),
    postedBy,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row.status),
  };
}

export async function createAdjustment(
  context: UserContext,
  input: AdjustmentInput,
): Promise<AdjustmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.adjustment.create");

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);

  const id = await prisma.$transaction(async (tx) => {
    const adjustmentNumber = await nextDocumentNumber(tx, "stockAdjustment", context.companyId);

    const adjustment = await tx.stockAdjustment.create({
      data: {
        companyId: context.companyId,
        adjustmentNumber,
        warehouseId: warehouse.id,
        adjustmentDate: input.adjustmentDate,
        reason: input.reason,
        status: "DRAFT",
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            quantityDelta: toStoredQuantity(line.quantityDelta),
            unit: targets.units.get(line.inventoryItemId)!,
            notes: line.notes ?? null,
          })),
        },
      },
      select: { id: true, adjustmentNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: adjustment.id,
      action: "INVENTORY_ADJUSTMENT_CREATED",
      message: `drafted adjustment ${adjustment.adjustmentNumber}`,
      metadata: { reason: input.reason } as Prisma.InputJsonValue,
    });

    return adjustment.id;
  });

  return getAdjustment(context, id);
}

export async function updateAdjustment(
  context: UserContext,
  adjustmentId: string,
  input: AdjustmentInput,
): Promise<AdjustmentDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.adjustment.update");

  const existing = await loadForWrite(context, adjustmentId);
  assertEditable(existing.status, NOUN);
  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);

  await prisma.$transaction(async (tx) => {
    // Still a draft, decided by the write rather than by the read above: an
    // adjustment posted while this form was open keeps the lines and the
    // reason it was posted with, instead of having them replaced.
    const editing = await tx.stockAdjustment.updateMany({
      where: { id: adjustmentId, companyId: context.companyId, status: existing.status },
      data: {
        warehouseId: warehouse.id,
        adjustmentDate: input.adjustmentDate,
        reason: input.reason,
        notes: input.notes ?? null,
      },
    });
    if (editing.count === 0) {
      throw new AccessError("CONFLICT", "This adjustment was posted or cancelled while you were editing it. Reload to see the latest.", {
        code: "STOCK_ADJUSTMENT_STALE",
      });
    }

    await tx.stockAdjustmentLine.deleteMany({ where: { stockAdjustmentId: adjustmentId } });
    await tx.stockAdjustment.update({
      where: { id: adjustmentId },
      data: {
        lines: {
          create: input.lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            locationId: line.locationId,
            quantityDelta: toStoredQuantity(line.quantityDelta),
            unit: targets.units.get(line.inventoryItemId)!,
            notes: line.notes ?? null,
          })),
        },
      },
    });
  });

  return getAdjustment(context, adjustmentId);
}

/** Applies the correction to the ledger (PRD #20 §150). */
export async function postAdjustment(
  context: UserContext,
  adjustmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.adjustment.post");

  const existing = await loadForWrite(context, adjustmentId);
  assertPostable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    /*
     * Claimed before anything reaches the ledger. Two people posting at once
     * both read a draft; the second waits here on the first, finds the
     * adjustment posted, and stops before applying the correction twice. The
     * lines are read after the claim, so they are the lines that were posted.
     */
    await applyTransition(tx, {
      machine: stockAdjustmentMachine,
      action: "post",
      id: adjustmentId,
      context,
      from: existing.status,
      data: { postedByMemberId: context.membershipId },
    });

    const lines = await tx.stockAdjustmentLine.findMany({
      where: { stockAdjustmentId: adjustmentId },
      orderBy: [{ locationId: "asc" }, { inventoryItemId: "asc" }],
      select: {
        id: true,
        inventoryItemId: true,
        locationId: true,
        quantityDelta: true,
        unit: true,
      },
    });

    if (lines.length === 0) {
      throw new AccessError("VALIDATION_ERROR", "Add at least one line before posting.", {
        code: "DOCUMENT_EMPTY",
      });
    }

    const source = { module: MODULE, entityType: "stock_adjustment", entityId: adjustmentId };
    const openingBalance = allowsNegativeResult(existing.reason);

    for (const line of lines) {
      const writesOn = line.quantityDelta.greaterThan(ZERO);

      const movementId = await applyStockMovement(tx, context, {
        inventoryItemId: line.inventoryItemId,
        warehouseId: existing.warehouseId,
        locationId: line.locationId,
        movementType: writesOn ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: line.quantityDelta.abs(),
        unit: line.unit,
        source: { ...source, lineId: line.id },
        occurredAt: existing.adjustmentDate,
        allowNegative: openingBalance,
      });

      await tx.stockAdjustmentLine.update({ where: { id: line.id }, data: { movementId } });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: adjustmentId,
      action: "INVENTORY_ADJUSTMENT_POSTED",
      message: `posted adjustment ${existing.adjustmentNumber}`,
      metadata: { reason: existing.reason, lines: lines.length } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelAdjustment(
  context: UserContext,
  adjustmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.adjustment.cancel");

  const existing = await loadForWrite(context, adjustmentId);
  assertCancellable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: stockAdjustmentMachine,
      action: "cancel",
      id: adjustmentId,
      context,
      from: existing.status,
    });
  });
}

export async function reverseAdjustment(
  context: UserContext,
  adjustmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.adjustment.reverse");

  const existing = await loadForWrite(context, adjustmentId);
  assertReversible(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    // Claimed first for the same reason as posting: a second reversal stops
    // here rather than undoing the correction twice.
    await applyTransition(tx, {
      machine: stockAdjustmentMachine,
      action: "reverse",
      id: adjustmentId,
      context,
      from: existing.status,
    });

    const lines = await tx.stockAdjustmentLine.findMany({
      where: { stockAdjustmentId: adjustmentId, movementId: { not: null } },
      select: { movementId: true },
    });

    await reverseMovements(
      tx,
      context,
      lines.map((line) => line.movementId!),
      { module: MODULE, entityType: "stock_adjustment", entityId: adjustmentId },
      new Date(),
    );

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: adjustmentId,
      action: "INVENTORY_ADJUSTMENT_REVERSED",
      message: `reversed adjustment ${existing.adjustmentNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function loadForWrite(context: UserContext, adjustmentId: string) {
  return assertFound(
    await prisma.stockAdjustment.findFirst({
      where: { AND: [buildAdjustmentScopeWhere(context), { id: adjustmentId }] },
      select: {
        id: true,
        adjustmentNumber: true,
        status: true,
        warehouseId: true,
        adjustmentDate: true,
        reason: true,
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
      "Somebody else changed this adjustment while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(row: ListRow): AdjustmentSummaryDTO {
  return {
    id: row.id,
    adjustmentNumber: row.adjustmentNumber,
    status: row.status,
    warehouse: toWarehouseRef(row.warehouse)!,
    adjustmentDate: dateString(row.adjustmentDate)!,
    reason: row.reason,
    lineCount: row._count.lines,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  status: ListRow["status"],
): TransactionCapabilities {
  return {
    canEdit: status === "DRAFT" && can(context, "inventory.adjustment.update"),
    canPost: status === "DRAFT" && can(context, "inventory.adjustment.post"),
    canCancel: status === "DRAFT" && can(context, "inventory.adjustment.cancel"),
    canReverse: status === "POSTED" && can(context, "inventory.adjustment.reverse"),
    canViewDocuments: can(context, "inventory.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "inventory.activity.view"),
  };
}
