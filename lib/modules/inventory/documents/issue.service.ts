import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import { releaseReservation } from "../balances/balance.service";
import {
  dateString,
  loadMemberRef,
  toItemRef,
  toLocationRef,
  toMemberRef,
  toWarehouseRef,
} from "../inventory.dto";
import { nextDocumentNumber } from "../inventory.numbering";
import { ZERO, quantityString, toStoredQuantity } from "../inventory.quantity";
import { buildInventoryProjectWhere, buildIssueScopeWhere, buildWarehouseScopeWhere } from "../inventory.scope";
import type { IssueInput, TransactionListQuery } from "../inventory.schema";
import type {
  IssueDetailDTO,
  IssueSummaryDTO,
  MemberRef,
  TransactionCapabilities,
} from "../inventory.types";
import {
  assertCancellable,
  assertEditable,
  assertPostable,
  assertReversible,
  postLines,
  resolveLineTargets,
  reverseMovements,
} from "./posting";

/**
 * Stock going out (PRD #20 §104–§120).
 *
 * Posting an issue is what actually consumes material: the ledger says it left
 * the store, and if the issue names a project, that project has consumed it
 * (PRD #20 §183).
 *
 * V0.1 stops at consumption. What the material *cost* the project is a Finance
 * question, and Inventory does not answer it (PRD #20 §188).
 */

const MODULE = "inventory" as const;
const ENTITY = "StockIssue";
const NOUN = "issue";

const LIST_SELECT = {
  id: true,
  issueNumber: true,
  status: true,
  issueDate: true,
  updatedAt: true,
  warehouse: { select: { id: true, code: true, name: true, warehouseType: true } },
  project: { select: { id: true, code: true, name: true } },
  issuedToMemberId: true,
  _count: { select: { lines: true } },
} satisfies Prisma.StockIssueSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  notes: true,
  warehouseId: true,
  projectId: true,
  requestedByMemberId: true,
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
      reservationId: true,
      inventoryItem: { select: { id: true, sku: true, name: true, baseUnit: true } },
      location: { select: { id: true, code: true, name: true, warehouseId: true } },
    },
  },
} satisfies Prisma.StockIssueSelect;

type ListRow = Prisma.StockIssueGetPayload<{ select: typeof LIST_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listIssues(context: UserContext, query: TransactionListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.issue.view");

  const filters: Prisma.StockIssueWhereInput[] = [buildIssueScopeWhere(context)];
  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.warehouseId) filters.push({ warehouseId: query.warehouseId });
  if (query.projectId) filters.push({ projectId: query.projectId });

  const search = searchClause(query.search, ["issueNumber", "notes"]);
  if (search) filters.push(search);

  const where: Prisma.StockIssueWhereInput = { AND: filters };

  const [rows, total] = await Promise.all([
    prisma.stockIssue.findMany({
      where,
      orderBy:
        query.sort === "date-asc"
          ? [{ issueDate: "asc" }]
          : query.sort === "number-asc"
            ? [{ issueNumber: "asc" }]
            : query.sort === "updated-desc"
              ? [{ updatedAt: "desc" }]
              : [{ issueDate: "desc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.stockIssue.count({ where }),
  ]);

  const members = await loadMembers(rows.map((row) => row.issuedToMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/** The people named on a page of issues, resolved in one query (PRD #20 §303). */
async function loadMembers(ids: (string | null)[]): Promise<Map<string, MemberRef>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();

  const rows = await prisma.companyMember.findMany({
    where: { id: { in: unique } },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });

  return new Map(rows.map((row) => [row.id, toMemberRef(row)!]));
}

export async function getIssue(context: UserContext, issueId: string): Promise<IssueDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.issue.view");

  const row = assertFound(
    await prisma.stockIssue.findFirst({
      where: { AND: [buildIssueScopeWhere(context), { id: issueId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [requestedBy, postedBy, createdBy] = await Promise.all([
    loadMemberRef(row.requestedByMemberId),
    loadMemberRef(row.postedByMemberId),
    loadMemberRef(row.createdByMemberId),
  ]);

  const members = await loadMembers([row.issuedToMemberId]);

  return {
    ...toSummaryDTO(row, members),
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
    requestedBy,
    postedBy,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row.status),
  };
}

/** What one project has consumed, issued less returned (PRD #20 §185). */
export async function listForProject(
  context: UserContext,
  projectId: string,
): Promise<IssueSummaryDTO[]> {
  if (!can(context, "inventory.issue.view")) return [];

  const rows = await prisma.stockIssue.findMany({
    where: { AND: [buildIssueScopeWhere(context), { projectId, status: "POSTED" }] },
    orderBy: { issueDate: "desc" },
    take: 100,
    select: LIST_SELECT,
  });

  const members = await loadMembers(rows.map((row) => row.issuedToMemberId));
  return rows.map((row) => toSummaryDTO(row, members));
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createIssue(
  context: UserContext,
  input: IssueInput,
): Promise<IssueDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.issue.create");

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const projectId = await resolveProject(context, input.projectId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);

  const id = await prisma.$transaction(async (tx) => {
    const issueNumber = await nextDocumentNumber(tx, "stockIssue", context.companyId);

    const issue = await tx.stockIssue.create({
      data: {
        companyId: context.companyId,
        issueNumber,
        warehouseId: warehouse.id,
        projectId,
        issueDate: input.issueDate,
        issuedToMemberId: input.issuedToMemberId ?? null,
        requestedByMemberId: input.requestedByMemberId ?? null,
        status: "DRAFT",
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
      select: { id: true, issueNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: issue.id,
      action: "INVENTORY_ISSUE_CREATED",
      message: `drafted issue ${issue.issueNumber}`,
    });

    return issue.id;
  });

  return getIssue(context, id);
}

export async function updateIssue(
  context: UserContext,
  issueId: string,
  input: IssueInput,
): Promise<IssueDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.issue.update");

  const existing = await loadForWrite(context, issueId);
  assertEditable(existing.status, NOUN);
  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const warehouse = await requireWarehouse(context, input.warehouseId);
  const projectId = await resolveProject(context, input.projectId);
  const targets = await resolveLineTargets(context, input.lines, [warehouse.id]);

  await prisma.$transaction(async (tx) => {
    await tx.stockIssueLine.deleteMany({ where: { stockIssueId: issueId } });

    await tx.stockIssue.update({
      where: { id: issueId },
      data: {
        warehouseId: warehouse.id,
        projectId,
        issueDate: input.issueDate,
        issuedToMemberId: input.issuedToMemberId ?? null,
        requestedByMemberId: input.requestedByMemberId ?? null,
        notes: input.notes ?? null,
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

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: issueId,
      action: "INVENTORY_ISSUE_UPDATED",
      message: `updated issue ${existing.issueNumber}`,
    });
  });

  return getIssue(context, issueId);
}

/**
 * Takes the stock out (PRD #20 §114–§117).
 *
 * Where a line draws on a reservation, the reservation is consumed in the same
 * transaction: otherwise the quantity would be counted twice — once as issued
 * and once as still reserved (PRD #20 §117).
 */
export async function postIssue(context: UserContext, issueId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.issue.post");

  const existing = await loadForWrite(context, issueId);
  assertPostable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    const lines = await tx.stockIssueLine.findMany({
      where: { stockIssueId: issueId },
      select: {
        id: true,
        inventoryItemId: true,
        locationId: true,
        quantity: true,
        unit: true,
        reservationId: true,
      },
    });

    if (lines.length === 0) {
      throw new AccessError("VALIDATION_ERROR", "Add at least one line before posting.", {
        code: "DOCUMENT_EMPTY",
      });
    }

    /*
     * Reservations are consumed first, so the stock they were holding becomes
     * issuable rather than blocking the very issue it was reserved for
     * (PRD #20 §116, §117).
     */
    for (const line of lines) {
      if (!line.reservationId) continue;

      const reservation = await tx.stockReservation.findFirst({
        where: { id: line.reservationId, companyId: context.companyId },
        select: { id: true, quantity: true, fulfilledQuantity: true, locationId: true, warehouseId: true, inventoryItemId: true },
      });
      if (!reservation) continue;

      const remaining = reservation.quantity.minus(reservation.fulfilledQuantity);
      const consumed = Prisma.Decimal.min(remaining, line.quantity);
      if (consumed.lessThanOrEqualTo(ZERO)) continue;

      await releaseReservation(tx, context, {
        inventoryItemId: reservation.inventoryItemId,
        warehouseId: reservation.warehouseId,
        locationId: reservation.locationId,
        quantity: consumed,
      });

      const fulfilled = reservation.fulfilledQuantity.plus(consumed);
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: {
          fulfilledQuantity: fulfilled,
          status: fulfilled.greaterThanOrEqualTo(reservation.quantity)
            ? "FULFILLED"
            : "PARTIALLY_FULFILLED",
        },
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
        movementType: "ISSUE" as const,
        projectId: existing.projectId,
      })),
      { module: MODULE, entityType: "stock_issue", entityId: issueId },
      existing.issueDate,
    );

    for (const entry of posted) {
      await tx.stockIssueLine.update({
        where: { id: entry.lineId },
        data: { movementId: entry.movementId },
      });
    }

    const result = await tx.stockIssue.updateMany({
      where: { id: issueId, status: "DRAFT" },
      data: { status: "POSTED", postedByMemberId: context.membershipId },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "That issue has already been posted.", {
        code: "STALE_RECORD",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: issueId,
      action: "INVENTORY_ISSUE_POSTED",
      message: `issued stock on ${existing.issueNumber}`,
      metadata: { lines: lines.length } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelIssue(context: UserContext, issueId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.issue.cancel");

  const existing = await loadForWrite(context, issueId);
  assertCancellable(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    await tx.stockIssue.update({
      where: { id: issueId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: issueId,
      action: "INVENTORY_ISSUE_CANCELLED",
      message: `cancelled draft issue ${existing.issueNumber}`,
    });
  });
}

/** Puts the stock back, without erasing that it went out (PRD #20 §119, §120). */
export async function reverseIssue(context: UserContext, issueId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "inventory.issue.reverse");

  const existing = await loadForWrite(context, issueId);
  assertReversible(existing.status, NOUN);

  await prisma.$transaction(async (tx) => {
    const lines = await tx.stockIssueLine.findMany({
      where: { stockIssueId: issueId, movementId: { not: null } },
      select: { movementId: true },
    });

    await reverseMovements(
      tx,
      context,
      lines.map((line) => line.movementId!),
      { module: MODULE, entityType: "stock_issue", entityId: issueId },
      new Date(),
    );

    const result = await tx.stockIssue.updateMany({
      where: { id: issueId, status: "POSTED" },
      data: { status: "REVERSED", reversedAt: new Date() },
    });

    if (result.count === 0) {
      throw new AccessError("CONFLICT", "That issue has already been reversed.", {
        code: "STALE_RECORD",
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: issueId,
      action: "INVENTORY_ISSUE_REVERSED",
      // A reversal undoes the consumption for the project too (PRD #20 §120).
      message: `reversed issue ${existing.issueNumber}`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function loadForWrite(context: UserContext, issueId: string) {
  return assertFound(
    await prisma.stockIssue.findFirst({
      where: { AND: [buildIssueScopeWhere(context), { id: issueId }] },
      select: {
        id: true,
        issueNumber: true,
        status: true,
        warehouseId: true,
        projectId: true,
        issueDate: true,
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

async function resolveProject(
  context: UserContext,
  projectId: string | undefined,
): Promise<string | null> {
  if (!projectId) return null;

  const project = await prisma.project.findFirst({
    where: { AND: [buildInventoryProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project.id;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this issue while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(row: ListRow, members: Map<string, MemberRef>): IssueSummaryDTO {
  return {
    id: row.id,
    issueNumber: row.issueNumber,
    status: row.status,
    warehouse: toWarehouseRef(row.warehouse)!,
    project: row.project,
    issueDate: dateString(row.issueDate)!,
    issuedTo: row.issuedToMemberId ? (members.get(row.issuedToMemberId) ?? null) : null,
    lineCount: row._count.lines,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  status: ListRow["status"],
): TransactionCapabilities {
  return {
    canEdit: status === "DRAFT" && can(context, "inventory.issue.update"),
    canPost: status === "DRAFT" && can(context, "inventory.issue.post"),
    canCancel: status === "DRAFT" && can(context, "inventory.issue.cancel"),
    canReverse: status === "POSTED" && can(context, "inventory.issue.reverse"),
    canViewDocuments: can(context, "inventory.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "inventory.activity.view"),
  };
}
