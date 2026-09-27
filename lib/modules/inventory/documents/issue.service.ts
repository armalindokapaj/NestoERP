import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { recordActivity } from "@/lib/modules/shared/activity";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
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
import { isReservationHolding } from "../inventory.status";
import type {
  IssueDetailDTO,
  IssueSummaryDTO,
  MemberRef,
  TransactionCapabilities,
} from "../inventory.types";
import { stockReservationMachine } from "../reservations/reservation.machine";
import { stockIssueMachine } from "./issue.machine";
import {
  assertCancellable,
  assertDocumentMembers,
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

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

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

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "inventory.issues.list",
    async (tx) => {
      const window = pageWindow(await tx.stockIssue.count({ where }), query.page, query.limit);
      const rows = await tx.stockIssue.findMany({
        where,
        // Many issues share a day; every sort ends in the id (AUD-08 §4, DT-04).
        orderBy: withTieBreaker<Prisma.StockIssueOrderByWithRelationInput>(
          query.sort === "date-asc"
            ? [{ issueDate: "asc" }]
            : query.sort === "number-asc"
              ? [{ issueNumber: "asc" }]
              : query.sort === "updated-desc"
                ? [{ updatedAt: "desc" }]
                : [{ issueDate: "desc" }],
        ),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: LIST_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const members = await loadMembers(rows.map((row) => row.issuedToMemberId));

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: window,
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
    orderBy: [{ issueDate: "desc" }, { id: "asc" }],
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
  await assertDocumentMembers(context, {
    issuedToMemberId: input.issuedToMemberId,
    requestedByMemberId: input.requestedByMemberId,
  });

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
  await assertDocumentMembers(
    context,
    { issuedToMemberId: input.issuedToMemberId, requestedByMemberId: input.requestedByMemberId },
    { issuedToMemberId: existing.issuedToMemberId, requestedByMemberId: existing.requestedByMemberId },
  );

  await prisma.$transaction(async (tx) => {
    // Still a draft, decided by the write rather than by the read above: an
    // issue posted while this form was open keeps the lines it was posted
    // with, instead of having them replaced under its movements.
    const editing = await tx.stockIssue.updateMany({
      where: { id: issueId, companyId: context.companyId, status: existing.status },
      data: {
        warehouseId: warehouse.id,
        projectId,
        issueDate: input.issueDate,
        issuedToMemberId: input.issuedToMemberId ?? null,
        requestedByMemberId: input.requestedByMemberId ?? null,
        notes: input.notes ?? null,
      },
    });
    if (editing.count === 0) {
      throw new AccessError("CONFLICT", "This issue was posted or cancelled while you were editing it. Reload to see the latest.", {
        code: "STOCK_ISSUE_STALE",
      });
    }

    await tx.stockIssueLine.deleteMany({ where: { stockIssueId: issueId } });

    await tx.stockIssue.update({
      where: { id: issueId },
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
    /*
     * Claimed before anything reaches the ledger or a reservation. Two people
     * posting at once both read a draft; the second waits here on the first,
     * finds the issue posted, and stops before taking the stock out twice. The
     * lines are read after the claim, so they are the lines that were posted.
     */
    await applyTransition(tx, {
      machine: stockIssueMachine,
      action: "post",
      id: issueId,
      context,
      from: existing.status,
      data: { postedByMemberId: context.membershipId },
    });

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
        select: { id: true, status: true, quantity: true, fulfilledQuantity: true, locationId: true, warehouseId: true, inventoryItemId: true },
      });
      // Released, cancelled or expired since the line named it, a reservation
      // holds nothing any more: there is nothing to consume, and releasing it
      // again would hand out stock another reservation is holding.
      if (!reservation || !isReservationHolding(reservation.status)) continue;

      const remaining = reservation.quantity.minus(reservation.fulfilledQuantity);
      const consumed = Prisma.Decimal.min(remaining, line.quantity);
      if (consumed.lessThanOrEqualTo(ZERO)) continue;

      const fulfilled = reservation.fulfilledQuantity.plus(consumed);
      // The reservation's own transition, taken under this issue's post
      // permission, and before its hold is given back so a reservation closed
      // meanwhile is not released twice.
      await applyTransition(tx, {
        machine: stockReservationMachine,
        action: "fulfill",
        id: reservation.id,
        context,
        from: reservation.status,
        to: fulfilled.greaterThanOrEqualTo(reservation.quantity) ? "FULFILLED" : "PARTIALLY_FULFILLED",
        data: { fulfilledQuantity: fulfilled },
      });

      await releaseReservation(tx, context, {
        inventoryItemId: reservation.inventoryItemId,
        warehouseId: reservation.warehouseId,
        locationId: reservation.locationId,
        quantity: consumed,
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
    await applyTransition(tx, {
      machine: stockIssueMachine,
      action: "cancel",
      id: issueId,
      context,
      from: existing.status,
      data: { cancelledAt: new Date() },
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
    // Claimed first for the same reason as posting: a second reversal stops
    // here rather than putting the stock back twice.
    await applyTransition(tx, {
      machine: stockIssueMachine,
      action: "reverse",
      id: issueId,
      context,
      from: existing.status,
      data: { reversedAt: new Date() },
    });

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
        issuedToMemberId: true,
        requestedByMemberId: true,
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
