import { Prisma, type UnitCommercialChangeSource, type UnitCommercialStatus, type UnitReservationStatus } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { canMove } from "@/lib/core/state/machine";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { structureOpen } from "@/lib/modules/project-structure/structure.permissions";
import { fail, findReadableUnit } from "@/lib/modules/project-structure/structure.service";
import { readableUnitWhere } from "@/lib/modules/project-structure/structure.permissions";
import { unitCommercialMachine } from "./unit-commercial.machine";
import type { UnitSalesCapabilities } from "./unit-sales.types";

/**
 * What every unit sale shares (E-05E §9, §21, §23, §44, §49-§52): who may do what,
 * the unit's commercial profile — created the first time Sales acts on the unit —
 * the row lock every change queues behind, the status trail, and closing a
 * reservation, whether a person or the expiry job does it.
 */

type Tx = Prisma.TransactionClient;

export const SALES_ACTIVITY_MODULE = "sales";
export const UNIT_ENTITY = "ProjectUnit";

export function salesCapabilities(context: UserContext): UnitSalesCapabilities {
  const open = structureOpen(context);
  const has = (permission: Parameters<typeof can>[1]) => open && can(context, permission);
  const view = has("project.unit.sales.view");
  return {
    canView: view,
    canManageStatus: view && has("project.unit.sales_status.manage"),
    canManagePrice: view && has("project.unit.price.manage"),
    canReserve: view && has("project.unit.reserve"),
    canExtend: view && has("project.unit.reservation.extend"),
    canRelease: view && has("project.unit.reservation.release"),
    canMarkSold: view && has("project.unit.mark_sold"),
    canReopen: view && has("project.unit.reopen_sale"),
    canCorrect: view && has("project.unit.sales_correct"),
    canSeeClients: canAccessModule(context, "clients") && can(context, "client.view"),
    canSeeDeals: canAccessModule(context, "sales") && can(context, "sales.opportunity.view"),
    canCreateClient: canAccessModule(context, "clients") && can(context, "client.create"),
    canCreateDeal: canAccessModule(context, "sales") && can(context, "sales.opportunity.create"),
  };
}

/**
 * A unit whose commercial side the reader may open: through its project's door
 * (E-05B), then the sales view grant. A reader who can open the unit but not its
 * sales is refused, not shown an empty page (§32).
 */
export async function findSellableUnit(context: UserContext, unitId: string) {
  const unit = await findReadableUnit(context, unitId);
  if (!salesCapabilities(context).canView) throw new AccessError("FORBIDDEN", "You cannot see this unit's sales.");
  return unit;
}

export type SellableUnit = Awaited<ReturnType<typeof findSellableUnit>>;

/** A reservation, reached only through a unit the reader may open (§46). */
export async function findReadableReservation(context: UserContext, reservationId: string) {
  const reservation = await prisma.unitReservation.findFirst({
    where: { companyId: context.companyId, id: reservationId, unit: { is: readableUnitWhere(context) } },
    select: { id: true, unitId: true },
  });
  if (!reservation) throw fail("RESERVATION_NOT_FOUND", "That reservation could not be found.", "NOT_FOUND");
  const unit = await findSellableUnit(context, reservation.unitId);
  return { reservationId: reservation.id, unit };
}

export const PROFILE_SELECT = {
  id: true,
  companyId: true,
  unitId: true,
  status: true,
  askingPrice: true,
  currency: true,
  priceBasis: true,
  holdReason: true,
  holdUntil: true,
  heldByMemberId: true,
  salesNotes: true,
  statusChangedAt: true,
  version: true,
} satisfies Prisma.UnitCommercialProfileSelect;

export type ProfileRow = Prisma.UnitCommercialProfileGetPayload<{ select: typeof PROFILE_SELECT }>;

/** The unit's commercial profile, created Not For Sale the first time Sales touches the unit (§58). */
export async function ensureProfile(tx: Tx, unit: { id: string; projectId: string; companyId: string }): Promise<ProfileRow> {
  return tx.unitCommercialProfile.upsert({
    where: { unitId: unit.id },
    create: { companyId: unit.companyId, projectId: unit.projectId, unitId: unit.id },
    update: {},
    select: PROFILE_SELECT,
  });
}

/**
 * Holds the profile row for the rest of the transaction, then reads it again:
 * reservations, sales, holds and price changes on one unit queue behind each
 * other (§23, §50), and each decides on what the unit is now.
 */
export async function lockProfile(tx: Tx, profile: { id: string; companyId: string }): Promise<ProfileRow> {
  await tx.$queryRaw`SELECT "id" FROM "unit_commercial_profiles" WHERE "id" = ${profile.id} FOR UPDATE`;
  return tx.unitCommercialProfile.findFirstOrThrow({ where: { companyId: profile.companyId, id: profile.id }, select: PROFILE_SELECT });
}

export async function lockedProfile(tx: Tx, unit: { id: string; projectId: string; companyId: string }): Promise<ProfileRow> {
  return lockProfile(tx, await ensureProfile(tx, unit));
}

export function checkVersion(profile: ProfileRow, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && profile.version !== expectedVersion) {
    throw fail("UNIT_SALES_STALE", "This unit's sales were updated by another user. Refresh before continuing.", "CONFLICT");
  }
}

export async function recordStatusChange(
  tx: Tx,
  input: { companyId: string; projectId: string; unitId: string; from: UnitCommercialStatus | null; to: UnitCommercialStatus; reason?: string | null; source: UnitCommercialChangeSource; actorMemberId: string | null; reservationId?: string | null; opportunityId?: string | null },
) {
  await tx.unitCommercialStatusHistory.create({
    data: {
      companyId: input.companyId,
      projectId: input.projectId,
      unitId: input.unitId,
      fromStatus: input.from,
      toStatus: input.to,
      reason: input.reason ?? null,
      source: input.source,
      actorMemberId: input.actorMemberId,
      reservationId: input.reservationId ?? null,
      opportunityId: input.opportunityId ?? null,
    },
  });
}

/**
 * The one move the expiry job makes, as the system (docs/state-machines.md,
 * "guarded without a machine"): the machine's `expire_reservation`, checked against
 * the table, with the state it moves from in the write.
 */
export async function expireReservedProfile(tx: Tx, profile: { id: string; companyId: string }): Promise<boolean> {
  if (!canMove(unitCommercialMachine, "RESERVED", "FOR_SALE")) throw new AccessError("CONFLICT", "A reserved unit cannot return to sale.");
  const moved = await tx.unitCommercialProfile.updateMany({
    where: { id: profile.id, companyId: profile.companyId, status: "RESERVED" },
    data: { status: "FOR_SALE", statusChangedAt: new Date(), version: { increment: 1 } },
  });
  return moved.count > 0;
}

/**
 * Ends an ACTIVE reservation — released, expired, converted to the sale or
 * cancelled. Conditional on it still being active, so a release and the expiry
 * job racing end it once (§25, §50). Never deletes it (§27).
 */
export async function closeReservation(
  tx: Tx,
  input: { companyId: string; reservationId: string; status: Exclude<UnitReservationStatus, "ACTIVE">; closedByMemberId: string | null; reason: string | null; expiredBefore?: Date },
): Promise<boolean> {
  const closed = await tx.unitReservation.updateMany({
    // Undefined leaves the date out: a person may end a reservation before its expiry, the job only after.
    where: { id: input.reservationId, companyId: input.companyId, status: "ACTIVE", expiresAt: input.expiredBefore ? { lte: input.expiredBefore } : undefined },
    data: { status: input.status, closedAt: new Date(), closedByMemberId: input.closedByMemberId, closeReason: input.reason, version: { increment: 1 } },
  });
  return closed.count > 0;
}

export async function activeReservation(tx: Tx | typeof prisma, companyId: string, unitId: string) {
  return tx.unitReservation.findFirst({
    where: { companyId, unitId, status: "ACTIVE" },
    select: { id: true, clientId: true, opportunityId: true, agreedPrice: true, currency: true, notes: true, expiresAt: true, reservedAt: true, createdByMemberId: true, version: true, opportunity: { select: { ownerMemberId: true } } },
  });
}

/** The people a reservation's news is for (§52): who reserved it and who owns the deal. */
export function reservationAudience(reservation: { createdByMemberId: string; opportunity: { ownerMemberId: string } | null }): string[] {
  return [...new Set([reservation.createdByMemberId, reservation.opportunity?.ownerMemberId].filter((id): id is string => Boolean(id)))];
}

export async function notifyReservation(
  tx: Tx,
  input: {
    eventType: (typeof NotificationEvent)["UNIT_RESERVATION_EXPIRING" | "UNIT_RESERVATION_EXPIRED" | "UNIT_RESERVATION_RELEASED" | "UNIT_MARKED_SOLD"];
    companyId: string;
    unit: { id: string; unitCode: string; projectId: string; projectName: string };
    reservationId: string;
    memberIds: string[];
    actorMemberId: string | null;
    expiresAt?: Date;
    whenLabel?: string;
  },
) {
  const memberIds = input.memberIds.filter((id) => id !== input.actorMemberId);
  if (memberIds.length === 0) return;
  await enqueueNotificationEvent(tx, {
    companyId: input.companyId,
    eventType: input.eventType,
    moduleKey: "projects",
    entityType: "project_unit",
    entityId: input.unit.id,
    actorMemberId: input.actorMemberId,
    projectId: input.unit.projectId,
    payload: { memberIds, unitCode: input.unit.unitCode, projectName: input.unit.projectName, reservationId: input.reservationId, expiresAt: input.expiresAt?.toISOString() ?? null, whenLabel: input.whenLabel ?? null },
  });
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
