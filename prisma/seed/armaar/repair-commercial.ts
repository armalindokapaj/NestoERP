/**
 * Puts back an ARMAAR unit's commercial profile where it has gone missing
 * (D-04). The sales step reads "a unit with a profile is already on sale" to
 * stay idempotent; a database whose profiles were deleted since — by a test's
 * cleanup, say — kept the unit's status and price history, so the profile is
 * rebuilt from them rather than the sale being written a second time.
 *
 * Only units with history and no profile are touched; nothing else changes.
 */
import type { PrismaClient } from "@prisma/client";

import { ARMAAR_GROUP_ID } from "./records";

export async function repairArmaarCommercialProfiles(prisma: PrismaClient) {
  const units = await prisma.projectUnit.findMany({
    where: { company: { parentGroupId: ARMAAR_GROUP_ID }, commercialProfile: null },
    select: { id: true, projectId: true, companyId: true },
  });
  let repaired = 0;
  for (const unit of units) {
    const [status, price] = await Promise.all([
      prisma.unitCommercialStatusHistory.findFirst({ where: { unitId: unit.id }, orderBy: [{ changedAt: "desc" }, { id: "desc" }] }),
      prisma.unitPriceHistory.findFirst({ where: { unitId: unit.id }, orderBy: [{ changedAt: "desc" }, { id: "desc" }] }),
    ]);
    if (!status && !price) continue;
    const held = status?.toStatus === "ON_HOLD";
    await prisma.unitCommercialProfile.create({
      data: {
        companyId: unit.companyId,
        projectId: unit.projectId,
        unitId: unit.id,
        status: status?.toStatus ?? "NOT_FOR_SALE",
        askingPrice: price?.newPrice ?? null,
        currency: price?.currency ?? null,
        priceBasis: price?.priceBasis ?? "SALEABLE_AREA",
        holdReason: held ? status?.reason ?? null : null,
        heldByMemberId: held ? status?.actorMemberId ?? null : null,
        statusChangedAt: status?.changedAt ?? null,
        updatedByMemberId: status?.actorMemberId ?? price?.changedByMemberId ?? null,
      },
    });
    repaired += 1;
  }
  return { repaired };
}
