import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { dateString, loadMemberRef } from "../qaqc.dto";
import {
  ZERO,
  balances,
  quantity,
  quantityString,
  releasableQuantity,
  sum,
  toStoredQuantity,
} from "../qaqc.quantity";
import { buildInspectionScopeWhere } from "../qaqc.scope";
import type { MaterialDecisionInput } from "../qaqc.schema";
import { allowsInventoryPosting, hasQualityEffect } from "../qaqc.status";
import type {
  MaterialDecisionDTO,
  MaterialQualityStatusDTO,
  MaterialReleaseDTO,
} from "../qaqc.types";

/**
 * Material quality (PRD #21 §89–§104).
 *
 * Two acts, deliberately separate:
 *
 *   1. **Deciding** — how much of a delivered line passed, failed, or passed
 *      with a condition. The three have to add back to the quantity inspected,
 *      exactly, in Decimal (§91). A decision that has silently lost material is
 *      the one thing a goods-inwards record must never do.
 *   2. **Releasing** — letting the accepted material through to stock. This is
 *      the act with consequences outside Quality, so it needs its own grant and
 *      happens only after the inspection has been approved (§98, §102).
 *
 * Quality decides; Inventory records the movement. Neither module is the other's
 * authority: Procurement says what physically arrived, Quality says what may be
 * used, Inventory says where it went (PRD #21 §93).
 */

const MODULE = "qaqc" as const;
const ENTITY = "QualityInspection";

/* -------------------------------------------------------------------------- */
/* Decisions                                                                   */
/* -------------------------------------------------------------------------- */

export async function listDecisions(
  context: UserContext,
  inspectionId: string,
): Promise<MaterialDecisionDTO[]> {
  if (!can(context, "qaqc.material.view")) return [];

  const rows = await prisma.materialInspectionDecision.findMany({
    where: {
      inspectionId,
      inspection: { is: buildInspectionScopeWhere(context) },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      goodsReceiptItemId: true,
      inspectedQuantity: true,
      acceptedQuantity: true,
      rejectedQuantity: true,
      conditionalQuantity: true,
      unit: true,
      notes: true,
      goodsReceiptItem: {
        select: {
          receivedQuantity: true,
          purchaseOrderItem: { select: { description: true } },
        },
      },
    },
  });

  // The line's description is part of what was inspected, so it travels with
  // the decision. Opening Procurement's own record stays a separate grant
  // (PRD #21 §183).
  const seeSource = can(context, "qaqc.material.view");

  return rows.map((row) => ({
    id: row.id,
    goodsReceiptItemId: row.goodsReceiptItemId,
    line: seeSource
      ? {
          description: row.goodsReceiptItem.purchaseOrderItem.description,
          receivedQuantity: quantityString(row.goodsReceiptItem.receivedQuantity),
        }
      : null,
    inspectedQuantity: quantityString(row.inspectedQuantity),
    acceptedQuantity: quantityString(row.acceptedQuantity),
    rejectedQuantity: quantityString(row.rejectedQuantity),
    conditionalQuantity: quantityString(row.conditionalQuantity),
    unit: row.unit,
    notes: row.notes,
  }));
}

/**
 * Records what was found on a delivery line (PRD #21 §90, §91, §92).
 *
 * Replaces any earlier decision on the same line — one decision per inspection
 * per line, so the record says what the inspector concluded rather than every
 * number they typed on the way there.
 */
export async function recordDecision(
  context: UserContext,
  inspectionId: string,
  input: MaterialDecisionInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.material.inspect");

  const inspection = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        inspectionType: true,
        goodsReceiptId: true,
      },
    }),
  );

  if (inspection.inspectionType !== "MATERIAL") {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Only a material inspection decides quantities.",
      { code: "NOT_MATERIAL" },
    );
  }

  if (inspection.status !== "DRAFT" && inspection.status !== "IN_PROGRESS") {
    throw new AccessError(
      "CONFLICT",
      "This inspection has been submitted, so its quantities can no longer be changed.",
      { code: "INSPECTION_SUBMITTED" },
    );
  }

  const line = await requireDeliveryLine(
    context,
    inspection.goodsReceiptId,
    input.goodsReceiptItemId,
  );

  const inspected = toStoredQuantity(input.inspectedQuantity);
  const accepted = toStoredQuantity(input.acceptedQuantity);
  const rejected = toStoredQuantity(input.rejectedQuantity);
  const conditional = toStoredQuantity(input.conditionalQuantity);

  // The equation, checked in Decimal rather than in floating point (§91, §220).
  if (!balances({ inspected, accepted, rejected, conditional })) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Accepted, rejected and conditional have to add up to the quantity inspected.",
      { code: "QUANTITY_IMBALANCE" },
    );
  }

  /*
   * Nobody may inspect more than actually arrived (§92). The check counts
   * every other decision on this line, so two inspections cannot between them
   * claim to have looked at more material than the lorry brought.
   */
  const others = await prisma.materialInspectionDecision.findMany({
    where: {
      goodsReceiptItemId: input.goodsReceiptItemId,
      inspectionId: { not: inspectionId },
      inspection: { is: { status: { notIn: ["CANCELLED", "REJECTED"] } } },
    },
    select: { inspectedQuantity: true },
  });

  const already = sum(others.map((row) => row.inspectedQuantity));
  if (already.plus(inspected).greaterThan(line.receivedQuantity)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `Only ${quantityString(line.receivedQuantity.minus(already))} ${line.unit} of that line is left to inspect.`,
      { code: "OVER_INSPECTED" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.materialInspectionDecision.upsert({
      where: {
        inspectionId_goodsReceiptItemId: {
          inspectionId,
          goodsReceiptItemId: input.goodsReceiptItemId,
        },
      },
      update: {
        inspectedQuantity: inspected,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
        conditionalQuantity: conditional,
        unit: line.unit,
        notes: input.notes ?? null,
      },
      create: {
        companyId: context.companyId,
        inspectionId,
        goodsReceiptItemId: input.goodsReceiptItemId,
        inspectedQuantity: inspected,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
        conditionalQuantity: conditional,
        unit: line.unit,
        notes: input.notes ?? null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_MATERIAL_DECISION",
      message: `recorded a material decision on ${inspection.inspectionNumber}`,
      metadata: { goodsReceiptItemId: input.goodsReceiptItemId } as Prisma.InputJsonValue,
    });
  });
}

export async function removeDecision(
  context: UserContext,
  inspectionId: string,
  goodsReceiptItemId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.material.inspect");

  const inspection = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: { id: true, status: true },
    }),
  );

  if (inspection.status !== "DRAFT" && inspection.status !== "IN_PROGRESS") {
    throw new AccessError("CONFLICT", "This inspection has already been submitted.", {
      code: "INSPECTION_SUBMITTED",
    });
  }

  await prisma.materialInspectionDecision.deleteMany({
    where: { inspectionId, goodsReceiptItemId },
  });
}

/* -------------------------------------------------------------------------- */
/* Release                                                                     */
/* -------------------------------------------------------------------------- */

export async function getRelease(
  context: UserContext,
  inspectionId: string,
): Promise<MaterialReleaseDTO | null> {
  if (!can(context, "qaqc.material.view")) return null;

  const row = await prisma.qualityMaterialRelease.findFirst({
    where: { inspectionId, inspection: { is: buildInspectionScopeWhere(context) } },
    orderBy: { releasedAt: "desc" },
    select: {
      id: true,
      goodsReceiptItemId: true,
      releasedQuantity: true,
      rejectedQuantity: true,
      heldQuantity: true,
      unit: true,
      status: true,
      releasedByMemberId: true,
      releasedAt: true,
      revokedAt: true,
      revocationReason: true,
      notes: true,
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    goodsReceiptItemId: row.goodsReceiptItemId,
    releasedQuantity: quantityString(row.releasedQuantity),
    rejectedQuantity: quantityString(row.rejectedQuantity),
    heldQuantity: quantityString(row.heldQuantity),
    unit: row.unit,
    status: row.status,
    releasedBy: await loadMemberRef(row.releasedByMemberId),
    releasedAt: row.releasedAt.toISOString(),
    revokedAt: dateString(row.revokedAt),
    revocationReason: row.revocationReason,
    notes: row.notes,
    capabilities: {
      canRevoke: row.status !== "REVOKED" && can(context, "qaqc.material.release"),
    },
  };
}

/**
 * Letting material through to stock (PRD #21 §96, §98, §101).
 *
 * Only from an approved or closed inspection, and only what the decisions
 * actually accepted. Conditional quantity is released too — it is material the
 * company has decided to use, with a condition recorded against it (§97) —
 * while rejected quantity never reaches a warehouse.
 */
export async function releaseMaterial(
  context: UserContext,
  inspectionId: string,
  notes: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.material.release");

  const inspection = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: {
        id: true,
        inspectionNumber: true,
        status: true,
        inspectionType: true,
        result: true,
      },
    }),
  );

  if (inspection.inspectionType !== "MATERIAL") {
    throw new AccessError("VALIDATION_ERROR", "Only a material inspection releases stock.", {
      code: "NOT_MATERIAL",
    });
  }

  if (!hasQualityEffect(inspection.status)) {
    throw new AccessError(
      "CONFLICT",
      "Material is released once the inspection has been approved.",
      { code: "NOT_APPROVED" },
    );
  }

  const decisions = await prisma.materialInspectionDecision.findMany({
    where: { inspectionId },
    select: {
      goodsReceiptItemId: true,
      inspectedQuantity: true,
      acceptedQuantity: true,
      rejectedQuantity: true,
      conditionalQuantity: true,
      unit: true,
    },
  });

  if (decisions.length === 0) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "Record what was accepted and rejected before releasing anything.",
      { code: "NO_DECISION" },
    );
  }

  // A conditional acceptance needs its condition in writing before the material
  // moves (PRD #21 §97).
  const conditional = sum(decisions.map((row) => row.conditionalQuantity));
  if (conditional.greaterThan(ZERO) && !can(context, "qaqc.material.conditional_accept")) {
    throw new AccessError(
      "FORBIDDEN",
      "Releasing material accepted with a condition needs the conditional-acceptance grant.",
      { code: "CONDITIONAL_NOT_PERMITTED" },
    );
  }

  await prisma.$transaction(async (tx) => {
    for (const decision of decisions) {
      const released = releasableQuantity({
        inspected: quantity(decision.inspectedQuantity),
        accepted: quantity(decision.acceptedQuantity),
        rejected: quantity(decision.rejectedQuantity),
        conditional: quantity(decision.conditionalQuantity),
      });

      const rejected = quantity(decision.rejectedQuantity);
      const status = released.isZero()
        ? "REJECTED"
        : rejected.isZero()
          ? "RELEASED"
          : "PARTIALLY_RELEASED";

      await tx.qualityMaterialRelease.upsert({
        where: {
          inspectionId_goodsReceiptItemId: {
            inspectionId,
            goodsReceiptItemId: decision.goodsReceiptItemId,
          },
        },
        update: {
          releasedQuantity: released,
          rejectedQuantity: rejected,
          heldQuantity: ZERO,
          unit: decision.unit,
          status,
          releasedByMemberId: context.membershipId,
          releasedAt: new Date(),
          revokedAt: null,
          revokedByMemberId: null,
          revocationReason: null,
          notes,
        },
        create: {
          companyId: context.companyId,
          inspectionId,
          goodsReceiptItemId: decision.goodsReceiptItemId,
          releasedQuantity: released,
          rejectedQuantity: rejected,
          heldQuantity: ZERO,
          unit: decision.unit,
          status,
          releasedByMemberId: context.membershipId,
          releasedAt: new Date(),
          notes,
        },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_MATERIAL_RELEASED",
      message: `released material on ${inspection.inspectionNumber}`,
    });
  });
}

/**
 * Taking a release back (PRD #21 §103).
 *
 * Only before Inventory has posted against it. Once the material is on a shelf,
 * the correction is a stock adjustment in Inventory — Quality cannot unmake a
 * movement it never made.
 */
export async function revokeRelease(
  context: UserContext,
  inspectionId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.material.release");

  const inspection = assertFound(
    await prisma.qualityInspection.findFirst({
      where: { AND: [buildInspectionScopeWhere(context), { id: inspectionId }] },
      select: { id: true, inspectionNumber: true, goodsReceiptId: true },
    }),
  );

  const posted = inspection.goodsReceiptId
    ? await prisma.inventoryReceipt.count({
        where: { goodsReceiptId: inspection.goodsReceiptId, status: "POSTED" },
      })
    : 0;

  if (posted > 0) {
    throw new AccessError(
      "CONFLICT",
      "Inventory has already booked this delivery in. Correct it with a stock adjustment instead.",
      { code: "ALREADY_POSTED" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.qualityMaterialRelease.updateMany({
      where: { inspectionId, status: { not: "REVOKED" } },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByMemberId: context.membershipId,
        revocationReason: reason,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: inspectionId,
      action: "QAQC_MATERIAL_REVOKED",
      message: `revoked the material release on ${inspection.inspectionNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* What other modules ask                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The quality position on a delivery, for Inventory and Procurement
 * (PRD #21 §13, §29, §102).
 *
 * Answered for a reader who holds quality *view* access on top of their own
 * module's access — a storeman is told how much they may book in, not shown the
 * inspector's findings.
 */
export async function materialQualityStatus(
  context: UserContext,
  goodsReceiptId: string,
): Promise<MaterialQualityStatusDTO | null> {
  if (!can(context, "qaqc.material.view")) return null;

  const inspection = await prisma.qualityInspection.findFirst({
    where: {
      companyId: context.companyId,
      goodsReceiptId,
      inspectionType: "MATERIAL",
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      inspectionNumber: true,
      status: true,
      result: true,
      materialDecisions: {
        select: {
          acceptedQuantity: true,
          rejectedQuantity: true,
          conditionalQuantity: true,
        },
      },
      materialReleases: { select: { releasedQuantity: true, heldQuantity: true, status: true } },
    },
  });

  if (!inspection) {
    return {
      goodsReceiptId,
      inspectionId: null,
      inspectionNumber: null,
      inspectionStatus: null,
      result: null,
      releasedQuantity: "0",
      rejectedQuantity: "0",
      conditionalQuantity: "0",
      heldQuantity: "0",
      // No inspection at all means quality is not gating this delivery, so
      // Inventory proceeds as it always has (PRD #21 §95).
      clearedForPosting: true,
      blockedReason: null,
    };
  }

  const releases = inspection.materialReleases.filter((row) =>
    allowsInventoryPosting(row.status),
  );

  const cleared = releases.length > 0;
  const blocked = cleared
    ? null
    : inspection.status === "APPROVED" || inspection.status === "CLOSED"
      ? "The inspection is approved but the material has not been released yet."
      : `Quality inspection ${inspection.inspectionNumber} is still ${inspection.status.toLowerCase().replace("_", " ")}.`;

  return {
    goodsReceiptId,
    inspectionId: inspection.id,
    inspectionNumber: inspection.inspectionNumber,
    inspectionStatus: inspection.status,
    result: inspection.result,
    releasedQuantity: quantityString(sum(releases.map((row) => row.releasedQuantity))),
    rejectedQuantity: quantityString(
      sum(inspection.materialDecisions.map((row) => row.rejectedQuantity)),
    ),
    conditionalQuantity: quantityString(
      sum(inspection.materialDecisions.map((row) => row.conditionalQuantity)),
    ),
    heldQuantity: quantityString(sum(releases.map((row) => row.heldQuantity))),
    clearedForPosting: cleared,
    blockedReason: blocked,
  };
}

/**
 * The delivery lines a material inspection may decide on (PRD #21 §90).
 *
 * Answered through `qaqc.material.inspect`, not through Procurement access: an
 * inspector who cannot see what arrived cannot say how much of it passed, and
 * material inspection is the module's primary flow (§4). Opening Procurement's
 * own pages remains a separate grant (§183).
 */
export async function inspectableLines(
  context: UserContext,
  goodsReceiptId: string,
): Promise<
  { id: string; description: string; receivedQuantity: string; unit: string }[]
> {
  if (!can(context, "qaqc.material.view")) return [];

  const rows = await prisma.goodsReceiptItem.findMany({
    where: { goodsReceiptId, goodsReceipt: { is: { companyId: context.companyId } } },
    select: {
      id: true,
      receivedQuantity: true,
      purchaseOrderItem: { select: { description: true, unit: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    description: row.purchaseOrderItem.description,
    receivedQuantity: quantityString(row.receivedQuantity),
    unit: row.purchaseOrderItem.unit,
  }));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireDeliveryLine(
  context: UserContext,
  goodsReceiptId: string | null,
  goodsReceiptItemId: string,
) {
  const row = await prisma.goodsReceiptItem.findFirst({
    where: {
      id: goodsReceiptItemId,
      goodsReceipt: { is: { companyId: context.companyId } },
      ...(goodsReceiptId ? { goodsReceiptId } : {}),
    },
    select: {
      id: true,
      receivedQuantity: true,
      purchaseOrderItem: { select: { unit: true } },
    },
  });

  if (!row) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "That delivery line is not on the delivery this inspection is about.",
      { code: "INVALID_LINE" },
    );
  }

  return {
    id: row.id,
    receivedQuantity: quantity(row.receivedQuantity),
    unit: row.purchaseOrderItem.unit,
  };
}
