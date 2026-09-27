import { Prisma, type PurchaseRequestStatus, type RFQStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { recordActivity } from "@/lib/modules/shared/activity";
import { pageWindow, searchClause, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import {
  dateString,
  loadMemberRef,
  moduleLink,
  toSupplierRef,
} from "../procurement.dto";
import { quantityString } from "../procurement.money";
import { nextDocumentNumber } from "../procurement.numbering";
import {
  buildProcurementProjectWhere,
  buildRfqScopeWhere,
  buildRequestScopeWhere,
} from "../procurement.scope";
import type { RfqInput, RfqListQuery } from "../procurement.schema";
import {
  acceptsQuotes,
  canTransitionRfqStatus,
  daysBetween,
  isRfqEditable,
  isRfqSupplierEditable,
} from "../procurement.status";
import type { RfqCapabilities, RfqDetailDTO, RfqSummaryDTO } from "../procurement.types";
import { purchaseRequestMachine } from "../requests/request.machine";
import { rfqMachine } from "./rfq.machine";

/**
 * Requests for quotation (PRD #19 §64–§77).
 *
 * The same ask, sent to several suppliers, so their answers can be compared
 * line by line. Two rules matter:
 *
 *   1. **An issued enquiry's items are fixed.** Suppliers priced what they were
 *      sent; editing the lines afterwards would compare answers to different
 *      questions (PRD #19 §73).
 *   2. **At least two suppliers to issue.** An enquiry sent to one supplier is
 *      not a comparison, and V0.1 says so rather than pretending (PRD #19 §72).
 */

const MODULE = "procurement" as const;
const ENTITY = "RFQ";

export const MINIMUM_SUPPLIERS_TO_ISSUE = 2;

const LIST_SELECT = {
  id: true,
  rfqNumber: true,
  title: true,
  status: true,
  currency: true,
  responseDueDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  purchaseRequest: { select: { id: true, requestNumber: true } },
  suppliers: { select: { id: true, status: true } },
} satisfies Prisma.RFQSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  projectId: true,
  purchaseRequestId: true,
  issuedAt: true,
  closedAt: true,
  cancelledAt: true,
  createdAt: true,
  createdByMemberId: true,
  items: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unit: true,
      specification: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.RFQSelect;

type ListRow = Prisma.RFQGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.RFQGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

export async function listRfqs(context: UserContext, query: RfqListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.view");

  const filters: Prisma.RFQWhereInput[] = [buildRfqScopeWhere(context)];

  switch (query.view) {
    case "draft":
      filters.push({ status: "DRAFT" });
      break;
    case "issued":
      filters.push({ status: "ISSUED" });
      break;
    case "closed":
      filters.push({ status: { in: ["CLOSED", "CANCELLED"] } });
      break;
    default:
      break;
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.projectId) filters.push({ projectId: query.projectId });

  const search = searchClause(query.search, ["rfqNumber", "title"]);
  if (search) filters.push(search);

  const where: Prisma.RFQWhereInput = { AND: filters };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "procurement.rfqs.list",
    async (tx) => {
      const window = pageWindow(await tx.rFQ.count({ where }), query.page, query.limit);
      const rows = await tx.rFQ.findMany({
        where,
        orderBy: withTieBreaker(orderFor(query.sort)),
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: LIST_SELECT,
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const today = new Date();
  return {
    data: rows.map((row) => toSummaryDTO(row, today)),
    pagination: window,
  };
}

function orderFor(sort: RfqListQuery["sort"]): Prisma.RFQOrderByWithRelationInput[] {
  switch (sort) {
    case "created-desc":
      return [{ createdAt: "desc" }];
    case "number-asc":
      return [{ rfqNumber: "asc" }];
    case "due-asc":
      return [{ responseDueDate: { sort: "asc", nulls: "last" } }];
    default:
      return [{ updatedAt: "desc" }];
  }
}

export async function getRfq(context: UserContext, rfqId: string): Promise<RfqDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.view");

  const row = assertFound(
    await prisma.rFQ.findFirst({
      where: { AND: [buildRfqScopeWhere(context), { id: rfqId }] },
      select: DETAIL_SELECT,
    }),
  );

  const today = new Date();

  const [invited, quotes, createdBy, requestReachable, projectReachable] = await Promise.all([
    prisma.rFQSupplier.findMany({
      where: { rfqId },
      orderBy: { supplier: { name: "asc" } },
      select: {
        id: true,
        status: true,
        invitedAt: true,
        respondedAt: true,
        supplier: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.supplierQuote.findMany({
      where: { rfqId },
      select: { id: true, supplierId: true },
    }),
    loadMemberRef(row.createdByMemberId),
    row.purchaseRequestId
      ? isRequestReachable(context, row.purchaseRequestId)
      : Promise.resolve(false),
    row.projectId ? isProjectReachable(context, row.projectId) : Promise.resolve(false),
  ]);

  const quoteBySupplier = new Map(quotes.map((quote) => [quote.supplierId, quote.id]));

  return {
    ...toSummaryDTO(row, today),
    items: row.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: quantityString(item.quantity),
      unit: item.unit,
      specification: item.specification,
      sortOrder: item.sortOrder,
    })),
    suppliers: invited.map((entry) => ({
      id: entry.id,
      supplier: toSupplierRef(entry.supplier)!,
      status: entry.status,
      invitedAt: entry.invitedAt?.toISOString() ?? null,
      respondedAt: entry.respondedAt?.toISOString() ?? null,
      quoteId: quoteBySupplier.get(entry.supplier.id) ?? null,
    })),
    requestLink: row.purchaseRequest
      ? moduleLink(
          row.purchaseRequest.id,
          row.purchaseRequest.requestNumber,
          `/procurement/requests/${row.purchaseRequest.id}`,
          requestReachable,
        )
      : null,
    projectLink: row.project
      ? moduleLink(
          row.project.id,
          `${row.project.code} — ${row.project.name}`,
          `/projects/${row.project.id}`,
          projectReachable,
        )
      : null,
    dates: {
      issuedAt: row.issuedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    },
    createdBy,
    createdAt: row.createdAt.toISOString(),
    capabilities: capabilitiesFor(context, row, invited.length),
  };
}

async function isRequestReachable(context: UserContext, requestId: string): Promise<boolean> {
  if (!can(context, "procurement.request.view")) return false;
  const found = await prisma.purchaseRequest.findFirst({
    where: { AND: [buildRequestScopeWhere(context), { id: requestId }] },
    select: { id: true },
  });
  return found !== null;
}

async function isProjectReachable(context: UserContext, projectId: string): Promise<boolean> {
  if (!can(context, "project.view")) return false;
  const found = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: { id: true },
  });
  return found !== null;
}

export async function listForRequest(
  context: UserContext,
  requestId: string,
): Promise<RfqSummaryDTO[]> {
  if (!can(context, "procurement.rfq.view")) return [];

  const rows = await prisma.rFQ.findMany({
    where: { AND: [buildRfqScopeWhere(context), { purchaseRequestId: requestId }] },
    orderBy: { createdAt: "desc" },
    select: LIST_SELECT,
  });

  const today = new Date();
  return rows.map((row) => toSummaryDTO(row, today));
}

export async function rfqFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.view");

  const projects = await prisma.project.findMany({
    where: { AND: [buildProcurementProjectWhere(context), { rfqs: { some: buildRfqScopeWhere(context) } }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  return { projects };
}

/** What an enquiry form may offer (PRD #19 §267, §268). */
export async function rfqFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [suppliers, projects, requests] = await Promise.all([
    prisma.supplier.findMany({
      where: { companyId: context.companyId, status: "ACTIVE" },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: buildProcurementProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    can(context, "procurement.request.view")
      ? prisma.purchaseRequest.findMany({
          where: {
            AND: [
              buildRequestScopeWhere(context),
              { status: { in: ["APPROVED", "IN_SOURCING", "PARTIALLY_ORDERED"] }, archivedAt: null },
            ],
          },
          select: {
            id: true,
            requestNumber: true,
            title: true,
            items: {
              orderBy: { sortOrder: "asc" },
              select: { id: true, description: true, quantity: true, unit: true },
            },
          },
          orderBy: { requestNumber: "asc" },
          take: 200,
        })
      : Promise.resolve([]),
  ]);

  return { suppliers, projects, requests };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createRfq(context: UserContext, input: RfqInput): Promise<RfqDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.create");

  const related = await resolveRelated(context, input);
  const supplierIds = await resolveSuppliers(context, input.supplierIds);
  await assertSourceLines(input.items, related.purchaseRequestId);

  const id = await prisma.$transaction(async (tx) => {
    const rfqNumber = await nextDocumentNumber(tx, "rFQ", context.companyId);

    const rfq = await tx.rFQ.create({
      data: {
        companyId: context.companyId,
        rfqNumber,
        title: input.title,
        purchaseRequestId: related.purchaseRequestId,
        projectId: related.projectId,
        currency: input.currency,
        responseDueDate: input.responseDueDate ?? null,
        status: "DRAFT",
        createdByMemberId: context.membershipId,
        items: {
          create: input.items.map((item, index) => ({
            sourceRequestItemId: item.sourceRequestItemId ?? null,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unit: item.unit,
            specification: item.specification ?? null,
            sortOrder: index + 1,
          })),
        },
        suppliers: {
          create: supplierIds.map((supplierId) => ({ supplierId, status: "INVITED" as const })),
        },
      },
      select: { id: true, rfqNumber: true },
    });

    // Sourcing has begun, so the request behind it says so (PRD #19 §61). Only
    // an approved request moves; one that a second enquiry started sourcing a
    // moment earlier is already where this was going, and settles quietly.
    if (related.purchaseRequestId && related.purchaseRequestStatus === "APPROVED") {
      await applyTransition(tx, {
        machine: purchaseRequestMachine,
        action: "start_sourcing",
        id: related.purchaseRequestId,
        context,
        from: related.purchaseRequestStatus,
        idempotent: true,
      });
    }

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: rfq.id,
      action: "PROCUREMENT_RFQ_CREATED",
      message: `drafted enquiry ${rfq.rfqNumber}`,
      metadata: { suppliers: supplierIds.length } as Prisma.InputJsonValue,
    });

    return rfq.id;
  });

  return getRfq(context, id);
}

export async function updateRfq(
  context: UserContext,
  rfqId: string,
  input: RfqInput,
): Promise<RfqDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.update");

  const existing = await loadForWrite(context, rfqId);

  if (!isRfqEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "This enquiry has been issued, so its lines are fixed. Suppliers priced what they were sent.",
      { code: "RFQ_NOT_EDITABLE" },
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const related = await resolveRelated(context, input);
  const supplierIds = await resolveSuppliers(context, input.supplierIds);

  // What the editor does not send is kept (AUD-09 §4, FV-05, FV-10): a line
  // that comes back with its id keeps the request line it was sourced from and
  // its specification unless the key says otherwise.
  const savedLines = new Map(
    (
      await prisma.rFQItem.findMany({
        where: { rfqId },
        select: { id: true, sourceRequestItemId: true, specification: true },
      })
    ).map((line) => [line.id, line]),
  );
  const items = input.items.map((item) => {
    const saved = item.id ? savedLines.get(item.id) : undefined;
    return {
      ...item,
      sourceRequestItemId: item.sourceRequestItemId !== undefined ? item.sourceRequestItemId : (saved?.sourceRequestItemId ?? null),
      specification: item.specification !== undefined ? item.specification : (saved?.specification ?? null),
    };
  });
  await assertSourceLines(items, related.purchaseRequestId);

  await prisma.$transaction(async (tx) => {
    await tx.rFQItem.deleteMany({ where: { rfqId } });
    await tx.rFQSupplier.deleteMany({ where: { rfqId } });

    await tx.rFQ.update({
      where: { id: rfqId },
      data: {
        title: input.title,
        purchaseRequestId: related.purchaseRequestId,
        projectId: related.projectId,
        currency: input.currency,
        responseDueDate: input.responseDueDate ?? null,
        updatedByMemberId: context.membershipId,
        items: {
          create: items.map((item, index) => ({
            sourceRequestItemId: item.sourceRequestItemId ?? null,
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unit: item.unit,
            specification: item.specification ?? null,
            sortOrder: index + 1,
          })),
        },
        suppliers: {
          create: supplierIds.map((supplierId) => ({ supplierId, status: "INVITED" as const })),
        },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: rfqId,
      action: "PROCUREMENT_RFQ_UPDATED",
      message: `updated enquiry ${existing.rfqNumber}`,
    });
  });

  return getRfq(context, rfqId);
}

export async function issueRfq(context: UserContext, rfqId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.issue");

  const existing = await loadForWrite(context, rfqId);

  const [suppliers, items] = await Promise.all([
    prisma.rFQSupplier.count({ where: { rfqId } }),
    prisma.rFQItem.count({ where: { rfqId } }),
  ]);

  if (items === 0) {
    throw new AccessError("VALIDATION_ERROR", "Add at least one line before issuing.", {
      code: "RFQ_EMPTY",
    });
  }

  /*
   * An enquiry to one supplier is a price check, not a comparison. V0.1 refuses
   * it rather than producing a one-row comparison screen that looks like a
   * competitive process (PRD #19 §72).
   */
  if (suppliers < MINIMUM_SUPPLIERS_TO_ISSUE) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `Invite at least ${MINIMUM_SUPPLIERS_TO_ISSUE} suppliers before issuing this enquiry.`,
      { code: "RFQ_TOO_FEW_SUPPLIERS" },
    );
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: rfqMachine,
      action: "issue",
      id: rfqId,
      context,
      from: existing.status,
      data: { issuedAt: new Date() },
    });
    await tx.rFQSupplier.updateMany({
      where: { rfqId, invitedAt: null },
      data: { invitedAt: new Date() },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: rfqId,
      action: "PROCUREMENT_RFQ_ISSUED",
      message: `issued enquiry ${existing.rfqNumber} to ${suppliers} suppliers`,
    });
  });
}

export async function closeRfq(context: UserContext, rfqId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.close");

  const existing = await loadForWrite(context, rfqId);

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: rfqMachine,
      action: "close",
      id: rfqId,
      context,
      from: existing.status,
      data: { closedAt: new Date() },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: rfqId,
      action: "PROCUREMENT_RFQ_CLOSED",
      message: `closed enquiry ${existing.rfqNumber}`,
    });
  });
}

export async function cancelRfq(
  context: UserContext,
  rfqId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.cancel");

  const existing = await loadForWrite(context, rfqId);

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: rfqMachine,
      action: "cancel",
      id: rfqId,
      context,
      from: existing.status,
      data: { cancelledAt: new Date() },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: rfqId,
      action: "PROCUREMENT_RFQ_CANCELLED",
      message: `cancelled enquiry ${existing.rfqNumber}`,
      metadata: note ? ({ note } as Prisma.InputJsonValue) : undefined,
    });
  });
}

/** Invites one more supplier to an enquiry already in flight (PRD #19 §67). */
export async function inviteSupplier(
  context: UserContext,
  rfqId: string,
  supplierId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.update");

  const existing = await loadForWrite(context, rfqId);

  if (!isRfqSupplierEditable(existing.status)) {
    throw new AccessError("CONFLICT", "This enquiry is closed.", { code: "RFQ_CLOSED" });
  }

  const [supplier] = await resolveSuppliers(context, [supplierId]);

  await prisma.$transaction(async (tx) => {
    // Only ever an insert. A supplier already on the enquiry keeps whatever
    // they have done since being asked — answered, declined, been disqualified
    // — and inviting them again changes none of it.
    await tx.rFQSupplier.createMany({
      data: [
        {
          rfqId,
          supplierId: supplier,
          status: "INVITED",
          invitedAt: existing.status === "ISSUED" ? new Date() : null,
        },
      ],
      skipDuplicates: true,
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: rfqId,
      action: "PROCUREMENT_RFQ_SUPPLIER_INVITED",
      message: `invited another supplier to enquiry ${existing.rfqNumber}`,
    });
  });
}

export async function removeSupplier(
  context: UserContext,
  rfqId: string,
  rfqSupplierId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.update");

  const existing = await loadForWrite(context, rfqId);

  if (!isRfqSupplierEditable(existing.status)) {
    throw new AccessError("CONFLICT", "This enquiry is closed.", { code: "RFQ_CLOSED" });
  }

  const entry = assertFound(
    await prisma.rFQSupplier.findFirst({
      where: { id: rfqSupplierId, rfqId },
      select: { id: true, supplierId: true },
    }),
  );

  // A supplier who has already answered stays on the record: removing them
  // would orphan their quote and hide that they were asked.
  const quoted = await prisma.supplierQuote.count({
    where: { rfqId, supplierId: entry.supplierId },
  });

  if (quoted > 0) {
    throw new AccessError(
      "CONFLICT",
      "This supplier has already quoted. Disqualify the quote instead of removing them.",
      { code: "SUPPLIER_HAS_QUOTED" },
    );
  }

  await prisma.rFQSupplier.delete({ where: { id: entry.id } });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type WriteRow = { id: string; rfqNumber: string; status: RFQStatus; updatedAt: Date };

async function loadForWrite(context: UserContext, rfqId: string): Promise<WriteRow> {
  return assertFound(
    await prisma.rFQ.findFirst({
      where: { AND: [buildRfqScopeWhere(context), { id: rfqId }] },
      select: { id: true, rfqNumber: true, status: true, updatedAt: true },
    }),
  );
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this enquiry while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

async function resolveRelated(context: UserContext, input: RfqInput) {
  let purchaseRequestId: string | null = null;
  let purchaseRequestStatus: PurchaseRequestStatus | null = null;
  if (input.purchaseRequestId) {
    const request = await prisma.purchaseRequest.findFirst({
      where: { AND: [buildRequestScopeWhere(context), { id: input.purchaseRequestId }] },
      select: { id: true, status: true },
    });
    if (!request) {
      throw new AccessError("VALIDATION_ERROR", "That purchase request does not exist.", {
        code: "INVALID_REQUEST",
      });
    }
    purchaseRequestId = request.id;
    purchaseRequestStatus = request.status;
  }

  let projectId: string | null = null;
  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { AND: [buildProjectScopeWhere(context), { id: input.projectId, archivedAt: null }] },
      select: { id: true },
    });
    if (!project) {
      throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
        code: "INVALID_PROJECT",
      });
    }
    projectId = project.id;
  }

  return { purchaseRequestId, purchaseRequestStatus, projectId };
}

/** Only active suppliers may be invited (PRD #19 §28, §68). */
async function resolveSuppliers(context: UserContext, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return [];

  const rows = await prisma.supplier.findMany({
    where: { id: { in: unique }, companyId: context.companyId, status: "ACTIVE" },
    select: { id: true },
  });

  if (rows.length !== unique.length) {
    throw new AccessError(
      "VALIDATION_ERROR",
      "One of those suppliers is not active, or does not exist.",
      { code: "INVALID_SUPPLIER" },
    );
  }

  return rows.map((row) => row.id);
}

function toSummaryDTO(row: ListRow, today: Date): RfqSummaryDTO {
  const responded = row.suppliers.filter((entry) => entry.status === "RESPONDED").length;
  const open = row.status === "ISSUED";

  return {
    id: row.id,
    rfqNumber: row.rfqNumber,
    title: row.title,
    status: row.status,
    currency: row.currency,
    project: row.project,
    requestNumber: row.purchaseRequest?.requestNumber ?? null,
    responseDueDate: dateString(row.responseDueDate),
    overdue: open && row.responseDueDate !== null && daysBetween(today, row.responseDueDate) < 0,
    invitedCount: row.suppliers.length,
    respondedCount: responded,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  supplierCount: number,
): RfqCapabilities {
  const allow = (permission: Parameters<typeof can>[1], condition: boolean) =>
    condition && can(context, permission);

  return {
    canEdit: allow("procurement.rfq.update", isRfqEditable(row.status)),
    canIssue: allow(
      "procurement.rfq.issue",
      row.status === "DRAFT" && supplierCount >= MINIMUM_SUPPLIERS_TO_ISSUE,
    ),
    canClose: allow("procurement.rfq.close", row.status === "ISSUED"),
    canCancel: allow("procurement.rfq.cancel", canTransitionRfqStatus(row.status, "CANCELLED")),
    canManageSuppliers: allow("procurement.rfq.update", isRfqSupplierEditable(row.status)),
    canViewQuotes: can(context, "procurement.quote.view"),
    canRecordQuote: allow("procurement.quote.create", acceptsQuotes(row.status)),
    canSelectQuote: allow(
      "procurement.quote.select",
      row.status === "ISSUED" || row.status === "CLOSED",
    ),
    canViewDocuments: can(context, "procurement.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "procurement.activity.view"),
  };
}

/**
 * A line's `sourceRequestItemId` must be a line of the enquiry's own request
 * (AUD-09 §5, FV-09): request sourcing counts these ids, so a forged or stale
 * one would mark somebody else's line as covered.
 */
async function assertSourceLines(
  items: { sourceRequestItemId?: string | null }[],
  purchaseRequestId: string | null,
): Promise<void> {
  const ids = [...new Set(items.map((item) => item.sourceRequestItemId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const found = purchaseRequestId
    ? await prisma.purchaseRequestItem.count({ where: { id: { in: ids }, purchaseRequestId } })
    : 0;
  if (found !== ids.length) {
    throw new AccessError("VALIDATION_ERROR", "A line refers to a request line that is not part of this enquiry's request.", {
      code: "INVALID_SOURCE_LINE",
      items: ["A line refers to a request line that is not part of this enquiry's request."],
    });
  }
}
