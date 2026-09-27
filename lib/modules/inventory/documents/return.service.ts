import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { dateString, loadMemberRef, toItemRef, toLocationRef, toWarehouseRef } from "../inventory.dto";
import { nextDocumentNumber } from "../inventory.numbering";
import { quantityString, toStoredQuantity } from "../inventory.quantity";
import { buildInventoryProjectWhere, buildReturnScopeWhere, buildWarehouseScopeWhere } from "../inventory.scope";
import type { ReturnInput, TransactionListQuery } from "../inventory.schema";
import type {
  ReturnDetailDTO,
  ReturnSummaryDTO,
  TransactionCapabilities,
} from "../inventory.types";
import {
  assertCancellable,
  assertDocumentMembers,
  assertEditable,
  assertPostable,
  postLines,
  resolveLineTargets,
} from "./posting";
import { stockReturnMachine } from "./return.machine";

/**
 * Unused material coming back from a project (PRD #20 §121–§128).
 *
 * A return is its own document rather than a negative issue, because the two
 * are different events: one is a project consuming material, the other is the
 * store getting it back. Netting them into one number would lose which happened
 * (PRD #20 §122, §185).
 */

const MODULE = "inventory" as const;
const ENTITY = "StockReturn";
const NOUN = "return";

const LIST_SELECT = {
  id: true,
  returnNumber: true,
  status: true,
  returnDate: true,
  updatedAt: true,
  warehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  project: { select: { id: true, code: true, name: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.StockReturnSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  notes: true,
  warehouseId: true,
  projectId: true,
  returnedByMemberId: true,
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
} satisfies Prisma.StockReturnSelect;

type ListRow = Prisma.StockReturnGetPayload<{ select: typeof LIST_SELECT }>;

export async function listReturns(context: UserContext, query: TransactionListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.return.view");

  const filters: Prisma.StockReturnWhereInput[] = [buildReturnScopeWhere(context)];
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.warehouseId) filters.push({ warehouseId: query.warehouseId });
  if (query.projectId) filters.push({ projectId: query.projectId });

  const search = searchClause(query.search, ["returnNumber", "notes"]);
  if (search) filters.push(search);

  const where: Prisma.StockReturnWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.stockReturn.findMany({
      where,
      orderBy: query.sort === "date-asc" ? [{ returnDate: "asc" }] : [{ returnDate: "desc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.stockReturn.count({ where }),
  ]);

  return {
    data: rows.map(toSummaryDTO),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getReturn(
  context: UserContext,
  returnId: string,
): Promise<ReturnDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.return.view");

  const row = assertFound(
    await prisma.stockReturn.findFirst({
      where: { AND: [buildReturnScopeWhere(context), { id: returnId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [returnedBy, postedBy, createdBy] = await Promise.all([
    loadMemberRef(row.returnedByMemberId),
    loadMemberRef(row.postedByMemberId),
    loadMemberRef(row.createdByMemberId),
  ]);

  return {
    ...toSummaryDTO(row),
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
    returnedBy,
    postedBy,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row.status),
  };
}

export async function createReturn(
  context: UserContext,
  input: ReturnInput,
): Promise<ReturnDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.return.create");

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const project = await requireProject(context, input.projectId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);
  await assertDocumentMembers(context, { returnedByMemberId: input.returnedByMemberId });

  const id = await prisma.$transaction(async (tx) => {
    const returnNumber = await nextDocumentNumber(tx, "stockReturn", context.companyId);

    const record = await tx.stockReturn.create({
      data: {
        companyId: context.companyId,
        returnNumber,
        warehouseId: warehouse.id,
        projectId: project.id,
        returnDate: input.returnDate,
        status: "DRAFT",
        returnedByMemberId: input.returnedByMemberId ?? null,
        notes: input.notes ?? null,
        createdByMemberId: context.membershipId,
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
      select: { id: true, returnNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: record.id,
      action: "INVENTORY_RETURN_CREATED",
      message: `drafted return ${record.returnNumber}`,
    });

    return record.id;
  });

  return getReturn(context, id);
}

export async function updateReturn(
  context: UserContext,
  returnId: string,
  input: ReturnInput,
): Promise<ReturnDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.return.create");

  const existing = await loadForWrite(context, returnId);
  assertEditable(existing.status, NOUN);
  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const project = await requireProject(context, input.projectId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);
  await assertDocumentMembers(context, { returnedByMemberId: input.returnedByMemberId }, { returnedByMemberId: existing.returnedByMemberId });

  await prisma.$transaction(async (tx) => {
    // Still a draft, decided by the write rather than by the read above: a
    // return posted while this form was open keeps the lines it was posted
    // with, instead of having them replaced under its movements.
    const editing = await tx.stockReturn.updateMany({
      where: { id: returnId, companyId: context.companyId, status: existing.status },
      data: {
        warehouseId: warehouse.id,
        projectId: project.id,
        returnDate: input.returnDate,
        returnedByMemberId: input.returnedByMemberId ?? null,
        notes: input.notes ?? null,
      },
    });
    if (editing.count === 0) {
      throw new AccessError("CONFLICT", "This return was posted or cancelled while you were editing it. Reload to see the latest.", {
        code: "STOCK_RETURN_STALE",
      });
    }

    await tx.stockReturnLine.deleteMany({ where: { stockReturnId: returnId } });
    await tx.stockReturn.update({
      where: { id: returnId },
      data: {
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
  });

  return getReturn(context, returnId);
}

/** Puts the material back on the shelf (PRD #20 §126). */
export async function postReturn(context: UserContext, returnId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.return.post");

  const existing = await loadForWrite(context, returnId);
  assertPostable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    /*
     * Claimed before anything reaches the ledger. Two people posting at once
     * both read a draft; the second waits here on the first, finds the return
     * posted, and stops before putting the material on the shelf twice. The
     * lines are read after the claim, so they are the lines that were posted.
     */
    await applyTransition(tx, {
      machine: stockReturnMachine,
      action: "post",
      id: returnId,
      context,
      from: existing.status,
      data: { postedByMemberId: context.membershipId },
    });

    const lines = await tx.stockReturnLine.findMany({
      where: { stockReturnId: returnId },
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
        movementType: "RETURN_TO_STOCK" as const,
        // Tagged with the project so its net consumption is issued less
        // returned rather than issued alone (PRD #20 §185).
        projectId: existing.projectId,
      })),
      { module: MODULE, entityType: "stock_return", entityId: returnId },
      existing.returnDate,
    );

    for (const entry of posted) {
      await tx.stockReturnLine.update({
        where: { id: entry.lineId },
        data: { movementId: entry.movementId },
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: returnId,
      action: "INVENTORY_RETURN_POSTED",
      message: `returned stock on ${existing.returnNumber}`,
    });
  });
}

export async function cancelReturn(context: UserContext, returnId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.return.create");

  const existing = await loadForWrite(context, returnId);
  assertCancellable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: stockReturnMachine,
      action: "cancel",
      id: returnId,
      context,
      from: existing.status,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function loadForWrite(context: UserContext, returnId: string) {
  return assertFound(
    await prisma.stockReturn.findFirst({
      where: { AND: [buildReturnScopeWhere(context), { id: returnId }] },
      select: {
        id: true,
        returnNumber: true,
        status: true,
        warehouseId: true,
        projectId: true,
        returnDate: true,
        returnedByMemberId: true,
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

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this return while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(row: ListRow): ReturnSummaryDTO {
  return {
    id: row.id,
    returnNumber: row.returnNumber,
    status: row.status,
    warehouse: toWarehouseRef(row.warehouse)!,
    project: row.project,
    returnDate: dateString(row.returnDate)!,
    lineCount: row._count.lines,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  status: ListRow["status"],
): TransactionCapabilities {
  return {
    canEdit: status === "DRAFT" && can(context, "inventory.return.create"),
    canPost: status === "DRAFT" && can(context, "inventory.return.post"),
    canCancel: status === "DRAFT" && can(context, "inventory.return.create"),
    // V0.1 does not reverse a return: the material is physically back, and a
    // correction is an adjustment with a reason (PRD #20 §122).
    canReverse: false,
    canViewDocuments: can(context, "inventory.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "inventory.activity.view"),
  };
}
