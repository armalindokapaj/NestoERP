import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { moduleLink, toItemRef, toLocationRef, toMemberRef, toWarehouseRef } from "../inventory.dto";
import { quantityString } from "../inventory.quantity";
import { buildBalanceScopeWhere, buildMovementScopeWhere } from "../inventory.scope";
import type { BalanceListQuery, MovementListQuery } from "../inventory.schema";
import type { MovementDTO, StockRowDTO } from "../inventory.types";
import { BALANCE_SELECT, toStockRow } from "../items/item.service";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * The stock ledger, read (PRD #20 §173–§179).
 *
 * Every row says what moved, where, when, who posted it and which document
 * caused it. That last link is what makes a stock figure explainable: "there
 * are forty bags" is only useful next to "because these eleven things happened"
 * (PRD #20 §179).
 */

const SELECT = {
  id: true,
  movementType: true,
  quantity: true,
  signedQuantity: true,
  unit: true,
  occurredAt: true,
  notes: true,
  postedByMemberId: true,
  sourceModule: true,
  sourceEntityType: true,
  sourceEntityId: true,
  reversalOfMovementId: true,
  inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
  warehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  location: { select: { id: true, code: true, name: true, warehouseId: true } },
  project: { select: { id: true, code: true, name: true } },
  reversals: { select: { id: true }, take: 1 },
} satisfies Prisma.StockMovementSelect;

type Row = Prisma.StockMovementGetPayload<{ select: typeof SELECT }>;

export async function listMovements(context: UserContext, query: MovementListQuery) {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.movement.view");

  const filters: Prisma.StockMovementWhereInput[] = [buildMovementScopeWhere(context)];
  if (query.movementType?.length) filters.push({ movementType: { in: query.movementType } });
  if (query.inventoryItemId) filters.push({ inventoryItemId: query.inventoryItemId });
  if (query.warehouseId) filters.push({ warehouseId: query.warehouseId });
  if (query.locationId) filters.push({ locationId: query.locationId });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.from) filters.push({ occurredAt: { gte: query.from } });
  if (query.to) filters.push({ occurredAt: { lte: query.to } });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { inventoryItem: { name: { contains: term, mode: "insensitive" } } },
        { inventoryItem: { sku: { contains: term, mode: "insensitive" } } },
        { notes: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.StockMovementWhereInput = { AND: filters };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "inventory.movements.list",
    async (tx) => {
      const window = pageWindow(await tx.stockMovement.count({ where }), query.page, query.limit);
      const rows = await tx.stockMovement.findMany({
        where,
        orderBy: withTieBreaker(query.sort === "occurred-asc" ? [{ occurredAt: "asc" }] : [{ occurredAt: "desc" }]),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const members = await loadMembers(rows.map((row) => row.postedByMemberId));

  return {
    data: rows.map((row) => toDTO(context, row, members)),
    pagination: window,
  };
}

/** One item's ledger, for its detail page (PRD #20 §173). */
export async function listForItem(
  context: UserContext,
  itemId: string,
  limit = 50,
): Promise<MovementDTO[]> {
  if (!can(context, "inventory.movement.view")) return [];

  const rows = await prisma.stockMovement.findMany({
    where: { AND: [buildMovementScopeWhere(context), { inventoryItemId: itemId }] },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.postedByMemberId));
  return rows.map((row) => toDTO(context, row, members));
}

/** What is where, across everything the reader can see (PRD #20 §180, §181). */
export async function listBalances(context: UserContext, query: BalanceListQuery) {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.balance.view");

  const filters: Prisma.InventoryBalanceWhereInput[] = [buildBalanceScopeWhere(context)];
  if (query.warehouseId) filters.push({ warehouseId: query.warehouseId });
  if (query.locationId) filters.push({ locationId: query.locationId });
  if (query.inventoryItemId) filters.push({ inventoryItemId: query.inventoryItemId });
  // Most rows hold nothing; showing them all buries what is actually there.
  if (query.heldOnly) filters.push({ onHandQuantity: { gt: 0 } });

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { inventoryItem: { name: { contains: term, mode: "insensitive" } } },
        { inventoryItem: { sku: { contains: term, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.InventoryBalanceWhereInput = { AND: filters };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "inventory.balances.list",
    async (tx) => {
      const window = pageWindow(await tx.inventoryBalance.count({ where }), query.page, query.limit);
      const rows = await tx.inventoryBalance.findMany({
        where,
        // One item in several locations has one fixed order: location code, then the id (AUD-08 §4, DT-04).
        orderBy: withTieBreaker<Prisma.InventoryBalanceOrderByWithRelationInput>(
          query.sort === "available-desc"
            ? [{ availableQuantity: "desc" }, { inventoryItem: { name: "asc" } }]
            : query.sort === "available-asc"
              ? [{ availableQuantity: "asc" }, { inventoryItem: { name: "asc" } }]
              : [{ inventoryItem: { name: "asc" } }, { warehouse: { code: "asc" } }, { location: { code: "asc" } }],
        ),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: BALANCE_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const data: StockRowDTO[] = rows.map(toStockRow);
  return { data, pagination: window };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function loadMembers(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<string, ReturnType<typeof toMemberRef>>();

  const rows = await prisma.companyMember.findMany({
    where: { id: { in: unique } },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });

  return new Map(rows.map((row) => [row.id, toMemberRef(row)]));
}

/** Where a movement came from, and whether the reader may open it (§179). */
const SOURCE_ROUTES: Record<string, { label: string; href: (id: string) => string; permission: Parameters<typeof can>[1] }> = {
  inventory_receipt: {
    label: "Stock receipt",
    href: (id) => `/inventory/receipts/${id}`,
    permission: "inventory.receipt.view",
  },
  stock_issue: {
    label: "Stock issue",
    href: (id) => `/inventory/issues/${id}`,
    permission: "inventory.issue.view",
  },
  stock_return: {
    label: "Stock return",
    href: (id) => `/inventory/returns/${id}`,
    permission: "inventory.return.view",
  },
  stock_transfer: {
    label: "Stock transfer",
    href: (id) => `/inventory/transfers/${id}`,
    permission: "inventory.transfer.view",
  },
  stock_adjustment: {
    label: "Stock adjustment",
    href: (id) => `/inventory/adjustments/${id}`,
    permission: "inventory.adjustment.view",
  },
};

function toDTO(
  context: UserContext,
  row: Row,
  members: Map<string, ReturnType<typeof toMemberRef>>,
): MovementDTO {
  const route = SOURCE_ROUTES[row.sourceEntityType];

  return {
    id: row.id,
    movementType: row.movementType,
    item: toItemRef(row.inventoryItem)!,
    warehouse: toWarehouseRef(row.warehouse)!,
    location: toLocationRef(row.location)!,
    project: row.project,
    quantity: quantityString(row.quantity),
    signedQuantity: quantityString(row.signedQuantity),
    unit: row.unit,
    occurredAt: row.occurredAt.toISOString(),
    postedBy: members.get(row.postedByMemberId) ?? null,
    source: route
      ? moduleLink(
          row.sourceEntityId,
          route.label,
          route.href(row.sourceEntityId),
          can(context, route.permission),
        )
      : null,
    isReversal: row.reversalOfMovementId !== null,
    reversedByMovementId: row.reversals[0]?.id ?? null,
    notes: row.notes,
  };
}
