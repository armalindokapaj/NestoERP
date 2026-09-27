import { Prisma, type InventoryTransactionStatus, type StockMovementType } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { applyStockMovement } from "../balances/balance.service";
import { toStoredQuantity } from "../inventory.quantity";
import {
  isTransactionCancellable,
  isTransactionEditable,
  isTransactionPostable,
  isTransactionReversible,
} from "../inventory.status";

/**
 * The lifecycle every stock document shares (PRD #20 §280, §281).
 *
 * Drafted, then posted. Posting is the only thing that touches the ledger, and
 * it happens in one transaction: either every line moves or none does. A
 * half-posted transfer would leave stock that exists in neither warehouse
 * (PRD #20 §137).
 *
 * After posting there is no edit. A mistake is reversed — which writes
 * balancing ledger rows — so the record shows both what somebody believed and
 * what corrected it (PRD #20 §70, §100).
 */

export type PostableLine = {
  id: string;
  inventoryItemId: string;
  warehouseId: string;
  locationId: string;
  quantity: Prisma.Decimal;
  unit: string;
  movementType: StockMovementType;
  projectId?: string | null;
  allowNegative?: boolean;
};

export type PostedMovement = { lineId: string; movementId: string };

/**
 * Posts a document's lines to the ledger, inside the caller's transaction.
 *
 * Lines are posted in a stable order so two documents touching the same
 * locations acquire their row locks in the same sequence — which is what stops
 * them deadlocking against each other (PRD #20 §282).
 */
export async function postLines(
  tx: Prisma.TransactionClient,
  context: UserContext,
  lines: PostableLine[],
  source: { module: string; entityType: string; entityId: string },
  occurredAt: Date,
): Promise<PostedMovement[]> {
  const ordered = [...lines].sort((a, b) =>
    a.locationId === b.locationId
      ? a.inventoryItemId.localeCompare(b.inventoryItemId)
      : a.locationId.localeCompare(b.locationId),
  );

  const posted: PostedMovement[] = [];

  for (const line of ordered) {
    const movementId = await applyStockMovement(tx, context, {
      inventoryItemId: line.inventoryItemId,
      warehouseId: line.warehouseId,
      locationId: line.locationId,
      movementType: line.movementType,
      quantity: line.quantity,
      unit: line.unit,
      projectId: line.projectId ?? null,
      source: { ...source, lineId: line.id },
      occurredAt,
      allowNegative: line.allowNegative,
    });

    posted.push({ lineId: line.id, movementId });
  }

  return posted;
}

/**
 * Writes the balancing rows that undo a posted document (PRD #20 §100, §101).
 *
 * Each reversal points at the movement it undoes and carries the opposite sign,
 * so the ledger reads as a history rather than as a set of corrections applied
 * in place. A movement that has already been reversed is refused (PRD #20 §288).
 */
export async function reverseMovements(
  tx: Prisma.TransactionClient,
  context: UserContext,
  movementIds: string[],
  source: { module: string; entityType: string; entityId: string },
  occurredAt: Date,
): Promise<void> {
  const movements = await tx.stockMovement.findMany({
    where: { id: { in: movementIds }, companyId: context.companyId },
    select: {
      id: true,
      inventoryItemId: true,
      warehouseId: true,
      locationId: true,
      quantity: true,
      signedQuantity: true,
      unit: true,
      projectId: true,
      sourceLineId: true,
    },
    orderBy: [{ locationId: "asc" }, { inventoryItemId: "asc" }],
  });

  const alreadyReversed = await tx.stockMovement.findMany({
    where: { reversalOfMovementId: { in: movementIds } },
    select: { reversalOfMovementId: true },
  });

  if (alreadyReversed.length > 0) {
    throw new AccessError("CONFLICT", "This has already been reversed.", {
      code: "ALREADY_REVERSED",
    });
  }

  for (const movement of movements) {
    await applyStockMovement(
      tx,
      context,
      {
        inventoryItemId: movement.inventoryItemId,
        warehouseId: movement.warehouseId,
        locationId: movement.locationId,
        movementType: "REVERSAL",
        quantity: toStoredQuantity(movement.quantity),
        unit: movement.unit,
        projectId: movement.projectId,
        source: { ...source, lineId: movement.sourceLineId },
        occurredAt,
        reversalOfMovementId: movement.id,
      },
      // The opposite of whatever the original did.
      movement.signedQuantity.negated(),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

export function assertEditable(status: InventoryTransactionStatus, noun: string): void {
  if (!isTransactionEditable(status)) {
    throw new AccessError(
      "CONFLICT",
      `This ${noun} has been posted to the stock ledger, so it can no longer be edited. Reverse it instead.`,
      { code: "NOT_EDITABLE" },
    );
  }
}

export function assertPostable(status: InventoryTransactionStatus, noun: string): void {
  if (!isTransactionPostable(status)) {
    throw new AccessError("CONFLICT", `Only a draft ${noun} can be posted.`, {
      code: "NOT_POSTABLE",
    });
  }
}

export function assertCancellable(status: InventoryTransactionStatus, noun: string): void {
  if (!isTransactionCancellable(status)) {
    throw new AccessError(
      "CONFLICT",
      `A posted ${noun} is cancelled by reversing it, not by cancelling it.`,
      { code: "NOT_CANCELLABLE" },
    );
  }
}

export function assertReversible(status: InventoryTransactionStatus, noun: string): void {
  if (!isTransactionReversible(status)) {
    throw new AccessError("CONFLICT", `Only a posted ${noun} can be reversed.`, {
      code: "NOT_REVERSIBLE",
    });
  }
}

/**
 * Checks that every line names an item and a location the caller may use, and
 * that the location belongs to the document's warehouse (PRD #20 §95, §300).
 *
 * Resolved in one query per kind rather than per line: a twenty-line issue must
 * not become forty lookups.
 */
export async function resolveLineTargets(
  context: UserContext,
  lines: { inventoryItemId: string; locationId: string }[],
  warehouseIds: string[],
): Promise<{
  units: Map<string, string>;
  warehouseByLocation: Map<string, string>;
}> {
  const itemIds = [...new Set(lines.map((line) => line.inventoryItemId))];
  const locationIds = [...new Set(lines.map((line) => line.locationId))];

  const [items, locations] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { id: { in: itemIds }, companyId: context.companyId, archivedAt: null },
      select: { id: true, baseUnit: true, status: true },
    }),
    prisma.inventoryLocation.findMany({
      where: { id: { in: locationIds }, companyId: context.companyId, archivedAt: null },
      select: { id: true, warehouseId: true, status: true },
    }),
  ]);

  if (items.length !== itemIds.length) {
    throw new AccessError("VALIDATION_ERROR", "One of those items does not exist.", {
      code: "INVALID_ITEM",
    });
  }

  if (locations.length !== locationIds.length) {
    throw new AccessError("VALIDATION_ERROR", "One of those locations does not exist.", {
      code: "INVALID_LOCATION",
    });
  }

  for (const location of locations) {
    if (!warehouseIds.includes(location.warehouseId)) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "A line names a location that is not in this document's warehouse.",
        { code: "LOCATION_WAREHOUSE_MISMATCH" },
      );
    }
  }

  return {
    units: new Map(items.map((item) => [item.id, item.baseUnit])),
    warehouseByLocation: new Map(locations.map((location) => [location.id, location.warehouseId])),
  };
}

/**
 * The people a stock document names — issued to, requested by, returned by —
 * must be members of this company (AUD-09 §5, FV-09). Nothing checked them
 * before, and the document page looked them up by id without a company filter,
 * so a forged id showed another company's person on this company's document.
 *
 * A new choice must be an active member. The person a draft already names may
 * have left since; keeping them is not a new assignment, so the saved value
 * passes as long as it is still this company's (FV-10).
 */
export async function assertDocumentMembers(
  context: UserContext,
  fields: Record<string, string | null | undefined>,
  saved: Record<string, string | null | undefined> = {},
): Promise<void> {
  for (const [field, memberId] of Object.entries(fields)) {
    if (!memberId) continue;
    const keeping = saved[field] === memberId;
    const member = await prisma.companyMember.findFirst({
      where: { id: memberId, companyId: context.companyId, ...(keeping ? {} : { status: "ACTIVE" }) },
      select: { id: true },
    });
    if (!member) {
      const message = "Choose an active member of this company.";
      throw new AccessError("VALIDATION_ERROR", message, { code: "INVALID_MEMBER", [field]: [message] });
    }
  }
}
