import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { releaseReservation, reserveStock } from "../balances/balance.service";
import {
  dateString,
  toItemRef,
  toLocationRef,
  toWarehouseRef,
} from "../inventory.dto";
import { nextDocumentNumber } from "../inventory.numbering";
import { quantityString, toStoredQuantity } from "../inventory.quantity";
import { buildInventoryProjectWhere, buildReservationScopeWhere, buildWarehouseScopeWhere } from "../inventory.scope";
import type { ReservationInput, ReservationListQuery } from "../inventory.schema";
import { isReservationHolding } from "../inventory.status";
import type { ReservationDTO } from "../inventory.types";

/**
 * Stock spoken for but not yet issued (PRD #20 §152–§166).
 *
 * A reservation moves quantity from available to reserved. Nothing physically
 * moves, so nothing goes in the ledger — the shelf still holds what it held
 * (PRD #20 §166).
 *
 * Releasing and fulfilling are different endings. Released means "we are not
 * taking it after all"; fulfilled means "we took it", and only an issue can say
 * that (PRD #20 §161, §164).
 */

const MODULE = "inventory" as const;
const ENTITY = "StockReservation";

const SELECT = {
  id: true,
  reservationNumber: true,
  status: true,
  quantity: true,
  fulfilledQuantity: true,
  requiredDate: true,
  expiresAt: true,
  createdAt: true,
  createdByMemberId: true,
  inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
  warehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  location: { select: { id: true, code: true, name: true, warehouseId: true } },
  project: { select: { id: true, code: true, name: true } },
} satisfies Prisma.StockReservationSelect;

type Row = Prisma.StockReservationGetPayload<{ select: typeof SELECT }>;

export async function listReservations(context: UserContext, query: ReservationListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.reservation.view");

  const filters: Prisma.StockReservationWhereInput[] = [buildReservationScopeWhere(context)];
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.warehouseId) filters.push({ warehouseId: query.warehouseId });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.inventoryItemId) filters.push({ inventoryItemId: query.inventoryItemId });

  const search = searchClause(query.search, ["reservationNumber"]);
  if (search) filters.push(search);

  const where: Prisma.StockReservationWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.stockReservation.findMany({
      where,
      orderBy:
        query.sort === "required-asc"
          ? [{ requiredDate: { sort: "asc", nulls: "last" } }]
          : query.sort === "expires-asc"
            ? [{ expiresAt: { sort: "asc", nulls: "last" } }]
            : [{ createdAt: "desc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SELECT,
    }),
    prisma.stockReservation.count({ where }),
  ]);

  const today = new Date();
  return {
    data: rows.map((row) => toDTO(context, row, today)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getReservation(
  context: UserContext,
  reservationId: string,
): Promise<ReservationDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.reservation.view");

  const row = assertFound(
    await prisma.stockReservation.findFirst({
      where: { AND: [buildReservationScopeWhere(context), { id: reservationId }] },
      select: SELECT,
    }),
  );

  return toDTO(context, row, new Date());
}

/**
 * Holds stock back (PRD #20 §158, §159).
 *
 * The availability check happens inside the transaction against a locked
 * balance row, so two reservations racing for the last pallet cannot both
 * succeed (PRD #20 §284).
 */
export async function createReservation(
  context: UserContext,
  input: ReservationInput,
): Promise<ReservationDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.reservation.create");

  const location = assertFound(
    await prisma.inventoryLocation.findFirst({
      where: {
        AND: [
          { warehouse: { is: buildWarehouseScopeWhere(context) } },
          { id: input.locationId, archivedAt: null },
        ],
      },
      select: { id: true, warehouseId: true },
    }),
  );

  if (location.warehouseId !== input.warehouseId) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That location is not in the warehouse you chose.",
      { code: "LOCATION_WAREHOUSE_MISMATCH" },
    );
  }

  const projectId = input.projectId ? (await requireProject(context, input.projectId)).id : null;
  const amount = toStoredQuantity(input.quantity);

  const id = await prisma.$transaction(async (tx) => {
    await reserveStock(tx, context, {
      inventoryItemId: input.inventoryItemId,
      warehouseId: location.warehouseId,
      locationId: location.id,
      quantity: amount,
    });

    const reservationNumber = await nextDocumentNumber(
      tx,
      "stockReservation",
      context.companyId,
    );

    const reservation = await tx.stockReservation.create({
      data: {
        companyId: context.companyId,
        reservationNumber,
        inventoryItemId: input.inventoryItemId,
        warehouseId: location.warehouseId,
        locationId: location.id,
        projectId,
        quantity: amount,
        status: "ACTIVE",
        requiredDate: input.requiredDate ?? null,
        expiresAt: input.expiresAt ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, reservationNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: reservation.id,
      action: "INVENTORY_RESERVATION_CREATED",
      message: `reserved stock on ${reservation.reservationNumber}`,
    });

    return reservation.id;
  });

  return getReservation(context, id);
}

/** Gives the held stock back to available (PRD #20 §161). */
export async function release(context: UserContext, reservationId: string): Promise<void> {
  await close(context, reservationId, "RELEASED", "inventory.reservation.release");
}

export async function cancel(context: UserContext, reservationId: string): Promise<void> {
  await close(context, reservationId, "CANCELLED", "inventory.reservation.cancel");
}

async function close(
  context: UserContext,
  reservationId: string,
  status: "RELEASED" | "CANCELLED",
  permission: Parameters<typeof assertPermission>[1],
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, permission);

  const existing = assertFound(
    await prisma.stockReservation.findFirst({
      where: { AND: [buildReservationScopeWhere(context), { id: reservationId }] },
      select: {
        id: true,
        reservationNumber: true,
        status: true,
        quantity: true,
        fulfilledQuantity: true,
        inventoryItemId: true,
        warehouseId: true,
        locationId: true,
      },
    }),
  );

  if (!isReservationHolding(existing.status)) return;

  await prisma.$transaction(async (tx) => {
    // Only what is still held goes back; the fulfilled part already left.
    await releaseReservation(tx, context, {
      inventoryItemId: existing.inventoryItemId,
      warehouseId: existing.warehouseId,
      locationId: existing.locationId,
      quantity: existing.quantity.minus(existing.fulfilledQuantity),
    });

    const result = await tx.stockReservation.updateMany({
      where: { id: reservationId, status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } },
      data: { status, updatedByMemberId: context.membershipId },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "That reservation has already been closed.", {
        code: "STALE_RECORD",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: reservationId,
      action: status === "RELEASED" ? "INVENTORY_RESERVATION_RELEASED" : "INVENTORY_RESERVATION_CANCELLED",
      message: `${status === "RELEASED" ? "released" : "cancelled"} reservation ${existing.reservationNumber}`,
    });
  });
}

/**
 * Expires reservations whose date has passed (PRD #20 §163).
 *
 * A maintenance action rather than a background job in V0.1: the held stock is
 * released so it stops blocking work nobody is waiting on any more.
 */
export async function expireOverdue(context: UserContext, today = new Date()): Promise<number> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.reservation.release");

  const overdue = await prisma.stockReservation.findMany({
    where: {
      AND: [
        buildReservationScopeWhere(context),
        { status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] }, expiresAt: { lt: today } },
      ],
    },
    select: {
      id: true,
      quantity: true,
      fulfilledQuantity: true,
      inventoryItemId: true,
      warehouseId: true,
      locationId: true,
    },
  });

  for (const reservation of overdue) {
    await prisma.$transaction(async (tx) => {
      await releaseReservation(tx, context, {
        inventoryItemId: reservation.inventoryItemId,
        warehouseId: reservation.warehouseId,
        locationId: reservation.locationId,
        quantity: reservation.quantity.minus(reservation.fulfilledQuantity),
      });

      await tx.stockReservation.updateMany({
        where: { id: reservation.id, status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] } },
        data: { status: "EXPIRED" },
      });
    });
  }

  return overdue.length;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildInventoryProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });
  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }
  return project;
}

function toDTO(context: UserContext, row: Row, today: Date): ReservationDTO {
  const remaining = row.quantity.minus(row.fulfilledQuantity);
  const holding = isReservationHolding(row.status);

  return {
    id: row.id,
    reservationNumber: row.reservationNumber,
    status: row.status,
    item: toItemRef(row.inventoryItem)!,
    warehouse: toWarehouseRef(row.warehouse)!,
    location: toLocationRef(row.location)!,
    project: row.project,
    quantity: quantityString(row.quantity),
    fulfilledQuantity: quantityString(row.fulfilledQuantity),
    remainingQuantity: quantityString(remaining),
    requiredDate: dateString(row.requiredDate),
    expiresAt: dateString(row.expiresAt),
    // Derived, never stored: a stored flag would be wrong every night.
    expired: holding && row.expiresAt !== null && row.expiresAt.getTime() < today.getTime(),
    createdBy: null,
    createdAt: row.createdAt.toISOString(),
    capabilities: {
      canEdit: holding && can(context, "inventory.reservation.update"),
      canRelease: holding && can(context, "inventory.reservation.release"),
      canCancel: holding && can(context, "inventory.reservation.cancel"),
    },
  };
}
