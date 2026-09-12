import { Prisma, type StockMovementType } from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { ZERO, toStoredQuantity } from "../inventory.quantity";

/**
 * The only code allowed to change stock (PRD #20 §289, §290).
 *
 * Everything else — receipts, issues, transfers, adjustments, reversals — asks
 * this service to post a movement, and the balance moves as a consequence.
 * Nothing writes `InventoryBalance` directly, because a stock figure that two
 * different code paths can change is a figure nobody can explain.
 *
 * Three invariants live here and nowhere else:
 *
 *   1. **The ledger is the truth, the balance is a projection.** A balance can
 *      always be rebuilt from movements; a disagreement is a bug in the
 *      projection, never a correction to history (PRD #20 §83).
 *   2. **Stock cannot go negative.** Checked inside the transaction, against a
 *      locked row, so two issues racing for the last pallet cannot both win
 *      (PRD #20 §77, §282).
 *   3. **`available = onHand − reserved`,** stored so it can be indexed, and
 *      recomputed on every write rather than maintained separately (PRD #20 §76).
 */

export type PostMovementInput = {
  inventoryItemId: string;
  warehouseId: string;
  locationId: string;
  movementType: StockMovementType;
  /** Always positive; direction comes from the movement type (PRD #20 §71). */
  quantity: Prisma.Decimal;
  unit: string;
  projectId?: string | null;
  source: { module: string; entityType: string; entityId: string; lineId?: string | null };
  occurredAt: Date;
  reversalOfMovementId?: string | null;
  notes?: string | null;
  /** Opening balances are allowed to create stock from nothing (PRD #20 §149). */
  allowNegative?: boolean;
};

/** Which way a movement type moves stock (PRD #20 §68, §71). */
const DIRECTION: Record<StockMovementType, 1 | -1> = {
  RECEIPT: 1,
  RETURN_TO_STOCK: 1,
  TRANSFER_IN: 1,
  ADJUSTMENT_IN: 1,
  ISSUE: -1,
  TRANSFER_OUT: -1,
  ADJUSTMENT_OUT: -1,
  // A reversal's direction is carried by its signed quantity, which the caller
  // computes from the movement being undone.
  REVERSAL: 1,
};

export function signedQuantityFor(
  movementType: StockMovementType,
  amount: Prisma.Decimal,
): Prisma.Decimal {
  return amount.mul(DIRECTION[movementType]);
}

/**
 * Posts one movement and moves the balance with it, in the caller's transaction.
 *
 * The balance row is locked before it is read, so the check and the write
 * cannot be separated by another transaction (PRD #20 §281, §283).
 */
export async function applyStockMovement(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: PostMovementInput,
  signedOverride?: Prisma.Decimal,
): Promise<string> {
  const amount = toStoredQuantity(input.quantity);

  if (amount.lessThanOrEqualTo(ZERO) && signedOverride === undefined) {
    throw new AccessError("VALIDATION_ERROR", "A movement needs a quantity above zero.", {
      code: "INVALID_QUANTITY",
    });
  }

  const signed = signedOverride ?? signedQuantityFor(input.movementType, amount);

  const balance = await lockBalance(tx, context, {
    inventoryItemId: input.inventoryItemId,
    warehouseId: input.warehouseId,
    locationId: input.locationId,
  });

  const nextOnHand = balance.onHandQuantity.plus(signed);

  /*
   * Negative stock is refused rather than recorded (PRD #20 §77). The one
   * exception is an opening balance, which by definition has no history behind
   * it to draw from.
   */
  if (nextOnHand.lessThan(ZERO) && !input.allowNegative) {
    throw new AccessError(
      "CONFLICT",
      `There is not enough stock in that location: ${balance.onHandQuantity.toString()} on hand, ${signed.abs().toString()} needed.`,
      { code: "INSUFFICIENT_STOCK" },
    );
  }

  const movement = await tx.stockMovement.create({
    data: {
      companyId: context.companyId,
      inventoryItemId: input.inventoryItemId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      movementType: input.movementType,
      quantity: amount,
      signedQuantity: signed,
      unit: input.unit,
      projectId: input.projectId ?? null,
      sourceModule: input.source.module,
      sourceEntityType: input.source.entityType,
      sourceEntityId: input.source.entityId,
      sourceLineId: input.source.lineId ?? null,
      reversalOfMovementId: input.reversalOfMovementId ?? null,
      occurredAt: input.occurredAt,
      postedByMemberId: context.membershipId,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  await writeBalance(tx, balance.id, nextOnHand, balance.reservedQuantity);

  return movement.id;
}

/**
 * Moves quantity from available into reserved (PRD #20 §152, §166).
 *
 * Writes no ledger row: nothing has physically happened, and a reservation that
 * appeared in the movement history would make the ledger disagree with what is
 * on the shelf.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: {
    inventoryItemId: string;
    warehouseId: string;
    locationId: string;
    quantity: Prisma.Decimal;
  },
): Promise<void> {
  const amount = toStoredQuantity(input.quantity);
  const balance = await lockBalance(tx, context, input);

  const nextReserved = balance.reservedQuantity.plus(amount);

  // Reserving more than is available would promise the same pallet twice
  // (PRD #20 §78, §284).
  if (balance.onHandQuantity.minus(nextReserved).lessThan(ZERO)) {
    const available = balance.onHandQuantity.minus(balance.reservedQuantity);
    throw new AccessError(
      "CONFLICT",
      `Only ${available.toString()} is available to reserve in that location.`,
      { code: "INSUFFICIENT_AVAILABLE" },
    );
  }

  await writeBalance(tx, balance.id, balance.onHandQuantity, nextReserved);
}

/** Gives reserved quantity back to available (PRD #20 §161). */
export async function releaseReservation(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: {
    inventoryItemId: string;
    warehouseId: string;
    locationId: string;
    quantity: Prisma.Decimal;
  },
): Promise<void> {
  const amount = toStoredQuantity(input.quantity);
  const balance = await lockBalance(tx, context, input);

  // Never below zero: a release that over-releases would invent available stock.
  const nextReserved = Prisma.Decimal.max(balance.reservedQuantity.minus(amount), ZERO);
  await writeBalance(tx, balance.id, balance.onHandQuantity, nextReserved);
}

/**
 * Recomputes one balance from the ledger and the live reservations (PRD #20 §82).
 *
 * The repair path. It never invents a number: it replays what is already
 * recorded, so running it twice changes nothing the second time.
 */
export async function rebuildBalance(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: { inventoryItemId: string; locationId: string },
): Promise<{ onHand: Prisma.Decimal; reserved: Prisma.Decimal }> {
  const [movements, reservations, location] = await Promise.all([
    tx.stockMovement.aggregate({
      where: {
        companyId: context.companyId,
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
      },
      _sum: { signedQuantity: true },
    }),
    tx.stockReservation.findMany({
      where: {
        companyId: context.companyId,
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
        status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
      },
      select: { quantity: true, fulfilledQuantity: true },
    }),
    tx.inventoryLocation.findUnique({
      where: { id: input.locationId },
      select: { warehouseId: true },
    }),
  ]);

  if (!location) {
    throw new AccessError("VALIDATION_ERROR", "That location does not exist.", {
      code: "INVALID_LOCATION",
    });
  }

  const onHand = movements._sum.signedQuantity ?? ZERO;
  const reserved = reservations.reduce(
    (total, row) => total.plus(row.quantity.minus(row.fulfilledQuantity)),
    ZERO,
  );

  const balance = await lockBalance(tx, context, {
    inventoryItemId: input.inventoryItemId,
    warehouseId: location.warehouseId,
    locationId: input.locationId,
  });

  await writeBalance(tx, balance.id, onHand, reserved);
  return { onHand, reserved };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type LockedBalance = {
  id: string;
  onHandQuantity: Prisma.Decimal;
  reservedQuantity: Prisma.Decimal;
};

/**
 * Fetches the balance row for writing, creating it if this is the first
 * movement for that item and location (PRD #20 §283).
 *
 * `SELECT ... FOR UPDATE` after the upsert, so the row is held for the rest of
 * the transaction and a concurrent posting waits rather than reading a figure
 * that is about to change (PRD #20 §281, §282).
 */
async function lockBalance(
  tx: Prisma.TransactionClient,
  context: UserContext,
  input: { inventoryItemId: string; warehouseId: string; locationId: string },
): Promise<LockedBalance> {
  // The unique constraint settles the create race; whoever loses simply finds
  // the row the winner made.
  await tx.inventoryBalance.upsert({
    where: {
      inventoryItemId_locationId: {
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
      },
    },
    update: {},
    create: {
      companyId: context.companyId,
      inventoryItemId: input.inventoryItemId,
      warehouseId: input.warehouseId,
      locationId: input.locationId,
      onHandQuantity: ZERO,
      reservedQuantity: ZERO,
      availableQuantity: ZERO,
    },
  });

  const rows = await tx.$queryRaw<
    { id: string; onHandQuantity: Prisma.Decimal; reservedQuantity: Prisma.Decimal }[]
  >`
    SELECT "id", "onHandQuantity", "reservedQuantity"
    FROM "inventory_balances"
    WHERE "inventoryItemId" = ${input.inventoryItemId}
      AND "locationId" = ${input.locationId}
    FOR UPDATE
  `;

  const row = rows[0];
  if (!row) {
    throw new AccessError("CONFLICT", "That stock balance could not be read for update.", {
      code: "BALANCE_LOCK_FAILED",
    });
  }

  return {
    id: row.id,
    onHandQuantity: new Prisma.Decimal(row.onHandQuantity),
    reservedQuantity: new Prisma.Decimal(row.reservedQuantity),
  };
}

/** `available` is derived on every write, never maintained separately (§76). */
async function writeBalance(
  tx: Prisma.TransactionClient,
  balanceId: string,
  onHand: Prisma.Decimal,
  reserved: Prisma.Decimal,
): Promise<void> {
  await tx.inventoryBalance.update({
    where: { id: balanceId },
    data: {
      onHandQuantity: onHand,
      reservedQuantity: reserved,
      availableQuantity: onHand.minus(reserved),
    },
  });
}
