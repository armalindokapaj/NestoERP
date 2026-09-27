import { Prisma, type InspectionRequestStatus } from "@prisma/client";

import { can } from "@/lib/access/can";
import {
  AccessError,
  assertFound,
  assertModule,
  assertPermission,
} from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { resolveReceiptItem } from "../qaqc.references";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { SNAPSHOT } from "../qaqc.list";
import {
  dateString,
  isOverdue,
  loadMemberRef,
  loadMembers,
  procurementLink,
  toProjectRef,
} from "../qaqc.dto";
import { nextQualityNumber } from "../qaqc.numbering";
import {
  buildQaqcMemberWhere,
  buildQaqcProjectWhere,
  buildRequestScopeWhere,
} from "../qaqc.scope";
import type { RequestInput, RequestListQuery } from "../qaqc.schema";
import {
  isRequestAssignable,
  isRequestCancellable,
  isRequestEditable,
} from "../qaqc.status";
import type { RequestDetailDTO, RequestSummaryDTO } from "../qaqc.types";

/**
 * Inspection requests (PRD #21 §34–§48).
 *
 * Somebody asking for an inspection is not the inspection (PRD #21 §3). A site
 * engineer raises a request; the quality function assigns an inspector; the
 * inspection is a separate record with its own verdict. Collapsing the two
 * would mean the person who wants the work signed off is also the person who
 * signs it off.
 */

const MODULE = "qaqc" as const;
const ENTITY = "InspectionRequest";

const LIST_SELECT = {
  id: true,
  requestNumber: true,
  title: true,
  inspectionType: true,
  status: true,
  priority: true,
  requestedByMemberId: true,
  assignedInspectorMemberId: true,
  requestedDate: true,
  requiredByDate: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  _count: { select: { inspections: true } },
} satisfies Prisma.InspectionRequestSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  locationText: true,
  goodsReceiptId: true,
  goodsReceiptItemId: true,
  projectId: true,
  createdByMemberId: true,
  createdAt: true,
  cancelledAt: true,
  goodsReceipt: { select: { id: true, receiptNumber: true, purchaseOrderId: true } },
} satisfies Prisma.InspectionRequestSelect;

type ListRow = Prisma.InspectionRequestGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.InspectionRequestGetPayload<{ select: typeof DETAIL_SELECT }>;

const OPEN_STATUSES: InspectionRequestStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS"];

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The inspection-request register's predicate (AUD-08 §3, DT-02, DT-03):
 * scope, then the section (`view`), then filters and search — shared by the
 * page, its count and the CSV export. OR within a filter, AND across filters;
 * a foreign project or member id is ANDed with scope and narrows to nothing
 * (DT-22).
 */
export function buildRequestListWhere(
  context: UserContext,
  query: RequestListQuery,
): Prisma.InspectionRequestWhereInput {
  const filters: Prisma.InspectionRequestWhereInput[] = [buildRequestScopeWhere(context)];

  if (query.view === "open") filters.push({ status: { in: OPEN_STATUSES } });
  if (query.view === "unassigned") {
    filters.push({ status: "OPEN", assignedInspectorMemberId: null });
  }
  if (query.view === "mine") {
    filters.push({
      OR: [
        { assignedInspectorMemberId: context.membershipId },
        { requestedByMemberId: context.membershipId },
      ],
    });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.inspectionType?.length) {
    filters.push({ inspectionType: { in: query.inspectionType } });
  }
  if (query.priority?.length) filters.push({ priority: { in: query.priority } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.assignedInspectorMemberId) {
    filters.push({ assignedInspectorMemberId: query.assignedInspectorMemberId });
  }

  if (query.search) {
    const term = query.search.trim();
    filters.push({
      OR: [
        { requestNumber: { contains: term, mode: "insensitive" } },
        { title: { contains: term, mode: "insensitive" } },
        { locationText: { contains: term, mode: "insensitive" } },
      ],
    });
  }

  return { AND: filters };
}

/**
 * The allowlisted request sorts (AUD-08 §4, DT-04). A request with no
 * needed-by date sorts after every dated one; priority compares the enum's
 * declared order. Every order ends in the id.
 */
export function requestListOrder(sort: RequestListQuery["sort"]): Prisma.InspectionRequestOrderByWithRelationInput[] {
  return withTieBreaker<Prisma.InspectionRequestOrderByWithRelationInput>(
    sort === "required-asc"
      ? [{ requiredByDate: { sort: "asc", nulls: "last" } }]
      : sort === "priority-desc"
        ? [{ priority: "desc" }, { requiredByDate: { sort: "asc", nulls: "last" } }]
        : sort === "number-asc"
          ? [{ requestNumber: "asc" }]
          : [{ createdAt: "desc" }],
  );
}

export async function listRequests(context: UserContext, query: RequestListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.request.view");

  const where = buildRequestListWhere(context, query);

  // Rows and total from one snapshot (AUD-08 §4, DT-06).
  const [rows, total] = await prisma.$transaction(
    [
      prisma.inspectionRequest.findMany({
        where,
        orderBy: requestListOrder(query.sort),
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        select: LIST_SELECT,
      }),
      prisma.inspectionRequest.count({ where }),
    ],
    SNAPSHOT,
  );

  const members = await loadMembers(
    context.companyId,
    rows.flatMap((row) => [row.requestedByMemberId, row.assignedInspectorMemberId]),
  );

  return {
    data: rows.map((row) => toSummaryDTO(row, members)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getRequest(
  context: UserContext,
  requestId: string,
): Promise<RequestDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.request.view");

  const row = assertFound(
    await prisma.inspectionRequest.findFirst({
      where: { AND: [buildRequestScopeWhere(context), { id: requestId }] },
      select: DETAIL_SELECT,
    }),
  );

  const [members, createdBy, inspections] = await Promise.all([
    loadMembers(context.companyId, [row.requestedByMemberId, row.assignedInspectorMemberId]),
    loadMemberRef(context.companyId, row.createdByMemberId),
    listInspectionsForRequest(context, requestId),
  ]);

  return {
    ...toSummaryDTO(row, members),
    description: row.description,
    locationText: row.locationText,
    source: procurementLink(context, row.goodsReceipt),
    inspections,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: dateString(row.cancelledAt),
    capabilities: capabilitiesFor(context, row),
  };
}

/**
 * Every inspection raised from this request — complete, not the first 50 the
 * detail page used to stop at without saying so (AUD-08 §4, DT-01). A request
 * has a handful; the list is record-bound, scoped and in a stable order.
 */
async function listInspectionsForRequest(context: UserContext, requestId: string) {
  if (!can(context, "qaqc.inspection.view")) return [];

  const { listForRequest } = await import("../inspections/inspection.service");
  return listForRequest(context, requestId);
}

export async function requestFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.request.view");

  const scope = buildRequestScopeWhere(context);

  const [projects, inspectors] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [buildQaqcProjectWhere(context), { inspectionRequests: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, assignedInspectionRequests: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, inspectors };
}

/** What a request form may offer (PRD #21 §43). */
export async function requestFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, members, receipts] = await Promise.all([
    prisma.project.findMany({
      where: buildQaqcProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildQaqcMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
    // Deliveries this reader may raise quality work against (PRD #21 §4).
    can(context, "qaqc.material.view")
      ? prisma.goodsReceipt.findMany({
          where: { companyId: context.companyId, status: "RECORDED" },
          select: {
            id: true,
            receiptNumber: true,
            receiptDate: true,
            supplier: { select: { name: true } },
          },
          orderBy: { receiptDate: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  return { projects, members, receipts };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createRequest(
  context: UserContext,
  input: RequestInput,
): Promise<RequestDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.request.create");

  const projectId = input.projectId ? (await requireProject(context, input.projectId)).id : null;
  const receipt = input.goodsReceiptId
    ? await requireGoodsReceipt(context, input.goodsReceiptId)
    : null;
  // A delivery line of this company's delivery, never another's (AUD-09 §5, FV-09).
  const goodsReceiptItemId = await resolveReceiptItem(context, { sent: input.goodsReceiptItemId ?? null, receiptId: receipt?.id ?? null });

  if (input.assignedInspectorMemberId) {
    await requireMember(context, input.assignedInspectorMemberId);
    assertPermission(context, "qaqc.request.assign");
  }

  const id = await prisma.$transaction(async (tx) => {
    const requestNumber = await nextQualityNumber(tx, "inspectionRequest", context.companyId);

    const request = await tx.inspectionRequest.create({
      data: {
        companyId: context.companyId,
        requestNumber,
        title: input.title,
        inspectionType: input.inspectionType,
        projectId,
        goodsReceiptId: receipt?.id ?? null,
        goodsReceiptItemId,
        requestedByMemberId: context.membershipId,
        assignedInspectorMemberId: input.assignedInspectorMemberId ?? null,
        requestedDate: input.requestedDate,
        requiredByDate: input.requiredByDate ?? null,
        priority: input.priority,
        status: input.assignedInspectorMemberId ? "ASSIGNED" : "OPEN",
        description: input.description ?? null,
        locationText: input.locationText ?? null,
        createdByMemberId: context.membershipId,
      },
      select: { id: true, requestNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: request.id,
      action: "QAQC_REQUEST_CREATED",
      message: `raised inspection request ${request.requestNumber}`,
    });

    return request.id;
  });

  return getRequest(context, id);
}

export async function updateRequest(
  context: UserContext,
  requestId: string,
  input: RequestInput,
): Promise<RequestDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.request.update");

  const existing = await requireRequest(context, requestId);

  if (!isRequestEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "An inspection has already started against this request, so it cannot be changed.",
      { code: "REQUEST_LOCKED" },
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const projectId = input.projectId ? (await requireProject(context, input.projectId)).id : null;
  const receipt = input.goodsReceiptId
    ? await requireGoodsReceipt(context, input.goodsReceiptId)
    : null;
  // The form never carries the delivery line: absent keeps it while the delivery is the same (AUD-09 §4, FV-05).
  const goodsReceiptItemId = await resolveReceiptItem(context, {
    sent: input.goodsReceiptItemId,
    receiptId: receipt?.id ?? null,
    stored: { receiptId: existing.goodsReceiptId, itemId: existing.goodsReceiptItemId },
  });

  await prisma.$transaction(async (tx) => {
    await tx.inspectionRequest.update({
      where: { id: requestId },
      data: {
        title: input.title,
        inspectionType: input.inspectionType,
        projectId,
        goodsReceiptId: receipt?.id ?? null,
        goodsReceiptItemId,
        requestedDate: input.requestedDate,
        requiredByDate: input.requiredByDate ?? null,
        priority: input.priority,
        description: input.description ?? null,
        locationText: input.locationText ?? null,
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "QAQC_REQUEST_UPDATED",
      message: `updated request ${existing.requestNumber}`,
    });
  });

  return getRequest(context, requestId);
}

/** Giving the request to an inspector (PRD #21 §45). */
export async function assignRequest(
  context: UserContext,
  requestId: string,
  memberId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.request.assign");

  const existing = await requireRequest(context, requestId);

  if (!isRequestAssignable(existing.status)) {
    throw new AccessError("CONFLICT", "This request can no longer be reassigned.", {
      code: "REQUEST_LOCKED",
    });
  }

  const member = await requireMember(context, memberId);

  await prisma.$transaction(async (tx) => {
    await tx.inspectionRequest.update({
      where: { id: requestId },
      data: {
        assignedInspectorMemberId: member.id,
        status: "ASSIGNED",
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "QAQC_REQUEST_ASSIGNED",
      message: `assigned request ${existing.requestNumber}`,
      metadata: { memberId: member.id } as Prisma.InputJsonValue,
    });
  });
}

export async function cancelRequest(
  context: UserContext,
  requestId: string,
  reason: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "qaqc.request.cancel");

  const existing = await requireRequest(context, requestId);

  if (!isRequestCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This request has already been settled.", {
      code: "REQUEST_SETTLED",
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.inspectionRequest.update({
      where: { id: requestId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        updatedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "QAQC_REQUEST_CANCELLED",
      message: `cancelled request ${existing.requestNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Moves a request along as its inspections progress (PRD #21 §46, §47).
 *
 * Called by the inspection service rather than by a person: the request's
 * status is a summary of what happened to it, not something anybody sets.
 */
export async function syncRequestStatus(
  tx: Prisma.TransactionClient,
  context: UserContext,
  requestId: string,
): Promise<void> {
  const request = await tx.inspectionRequest.findFirst({
    where: { id: requestId, companyId: context.companyId },
    select: { id: true, status: true },
  });

  if (!request || request.status === "CANCELLED") return;

  const inspections = await tx.qualityInspection.findMany({
    where: { requestId },
    select: { status: true },
  });

  if (inspections.length === 0) return;

  const settled = inspections.every(
    (row) => row.status === "CLOSED" || row.status === "CANCELLED",
  );
  const anyLive = inspections.some((row) => row.status !== "CANCELLED");

  const next = settled && anyLive ? "COMPLETED" : "IN_PROGRESS";
  if (next === request.status) return;

  await tx.inspectionRequest.update({ where: { id: requestId }, data: { status: next } });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function requireRequest(context: UserContext, requestId: string) {
  return assertFound(
    await prisma.inspectionRequest.findFirst({
      where: { AND: [buildRequestScopeWhere(context), { id: requestId }] },
      select: { id: true, requestNumber: true, status: true, updatedAt: true, goodsReceiptId: true, goodsReceiptItemId: true },
    }),
  );
}

async function requireProject(context: UserContext, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { AND: [buildQaqcProjectWhere(context), { id: projectId }] },
    select: { id: true },
  });

  if (!project) {
    throw new AccessError("VALIDATION_ERROR", "That project does not exist.", {
      code: "INVALID_PROJECT",
    });
  }

  return project;
}

async function requireMember(context: UserContext, memberId: string) {
  const member = await prisma.companyMember.findFirst({
    where: { AND: [buildQaqcMemberWhere(context), { id: memberId }] },
    select: { id: true },
  });

  if (!member) {
    throw new AccessError("VALIDATION_ERROR", "That person is not an active member.", {
      code: "INVALID_MEMBER",
    });
  }

  return member;
}

async function requireGoodsReceipt(context: UserContext, goodsReceiptId: string) {
  /*
   * Named through the reader's own quality access: a material inspection is
   * about a delivery, so choosing one is part of the quality act rather than a
   * way into Procurement (PRD #21 §4, §183).
   */
  if (!can(context, "qaqc.material.view")) {
    throw new AccessError("VALIDATION_ERROR", "That delivery does not exist.", {
      code: "INVALID_RECEIPT",
    });
  }

  const receipt = await prisma.goodsReceipt.findFirst({
    where: { id: goodsReceiptId, companyId: context.companyId, status: "RECORDED" },
    select: { id: true },
  });

  if (!receipt) {
    throw new AccessError("VALIDATION_ERROR", "That delivery does not exist.", {
      code: "INVALID_RECEIPT",
    });
  }

  return receipt;
}

function assertNotStale(sent: Date | undefined, actual: Date): void {
  if (!sent) return;
  if (sent.getTime() !== actual.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "Somebody else changed this request while you were editing. Reload and try again.",
      { code: "STALE_RECORD" },
    );
  }
}

function toSummaryDTO(
  row: ListRow,
  members: Map<string, { memberId: string; fullName: string; active: boolean }>,
): RequestSummaryDTO {
  const open = OPEN_STATUSES.includes(row.status);

  return {
    id: row.id,
    requestNumber: row.requestNumber,
    title: row.title,
    inspectionType: row.inspectionType,
    status: row.status,
    priority: row.priority,
    project: toProjectRef(row.project),
    requestedBy: members.get(row.requestedByMemberId) ?? null,
    assignedInspector: row.assignedInspectorMemberId
      ? (members.get(row.assignedInspectorMemberId) ?? null)
      : null,
    requestedDate: row.requestedDate.toISOString(),
    requiredByDate: dateString(row.requiredByDate),
    overdue: isOverdue(row.requiredByDate, open),
    inspectionCount: row._count.inspections,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function capabilitiesFor(context: UserContext, row: DetailRow) {
  return {
    canEdit: isRequestEditable(row.status) && can(context, "qaqc.request.update"),
    canAssign: isRequestAssignable(row.status) && can(context, "qaqc.request.assign"),
    canCancel: isRequestCancellable(row.status) && can(context, "qaqc.request.cancel"),
    canStartInspection:
      row.status !== "CANCELLED" &&
      row.status !== "COMPLETED" &&
      can(context, "qaqc.inspection.create"),
    canViewActivity: can(context, "qaqc.activity.view"),
  };
}
