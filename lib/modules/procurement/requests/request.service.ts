import { Prisma, type PurchaseRequestStatus } from "@prisma/client";

import { inGroupWorkspace } from "@/config/workspace";
import { can } from "@/lib/access/can";
import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { applyTransition } from "@/lib/core/state/transition";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { paginationMeta, searchClause, skipFor } from "@/lib/modules/shared/list-query";
import * as approvals from "../approvals/approval.service";
import { requireDecisionNote, type ApprovalGuard } from "@/lib/core/approvals/approval-guard";
import {
  dateString,
  loadMemberRef,
  moduleLink,
  toAmountString,
  toMemberRef,
} from "../procurement.dto";
import { estimatedTotal, quantityString } from "../procurement.money";
import { nextDocumentNumber } from "../procurement.numbering";
import {
  buildProcurementMemberWhere,
  buildProcurementProjectWhere,
  buildRequestScopeWhere,
} from "../procurement.scope";
import type { RequestInput, RequestItemInput, RequestListQuery } from "../procurement.schema";
import {
  companyFilterOptions,
  groupProcurementContexts,
  narrowToCompany,
  unionWhere,
} from "../procurement.workspace";
import {
  acceptsSourcing,
  canTransitionRequestStatus,
  daysBetween,
  isRequestArchivable,
  isRequestCancellable,
  isRequestEditable,
  isRequestSubmittable,
} from "../procurement.status";
import type {
  RequestCapabilities,
  RequestDetailDTO,
  RequestItemDTO,
  RequestSummaryDTO,
} from "../procurement.types";
import { purchaseRequestMachine, type PurchaseRequestAction } from "./request.machine";

/**
 * Purchase requests (PRD #19 §41–§63).
 *
 * A request is somebody asking to buy something. It is a need, not a
 * commitment: nothing is owed to anybody until a purchase order is issued,
 * which is why the two are separate records rather than one with a status
 * (PRD #19 §3).
 *
 * Its estimated total is computed from its lines, never taken from the client.
 * A header total a browser sent is a number nobody checked (PRD #19 §49).
 */

const MODULE = "procurement" as const;
const ENTITY = "PurchaseRequest";

const LIST_SELECT = {
  id: true,
  requestNumber: true,
  title: true,
  status: true,
  priority: true,
  requiredDate: true,
  currency: true,
  estimatedTotal: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, name: true } },
  requestedBy: {
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  },
  owner: {
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  },
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseRequestSelect;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  description: true,
  departmentId: true,
  projectId: true,
  submittedAt: true,
  approvedAt: true,
  approvedByMemberId: true,
  rejectedAt: true,
  rejectedByMemberId: true,
  rejectionReason: true,
  cancelledAt: true,
  archivedAt: true,
  createdAt: true,
  createdByMemberId: true,
  items: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unit: true,
      estimatedUnitPrice: true,
      estimatedAmount: true,
      category: true,
      specification: true,
      sortOrder: true,
    },
  },
} satisfies Prisma.PurchaseRequestSelect;

/** What a Group list adds: the company each row belongs to (Workspace Context §45). */
const GROUP_LIST_SELECT = {
  ...LIST_SELECT,
  company: { select: { id: true, name: true } },
} satisfies Prisma.PurchaseRequestSelect;

type ListRow = Prisma.PurchaseRequestGetPayload<{ select: typeof LIST_SELECT }> & {
  company?: { id: string; name: string };
};
type DetailRow = Prisma.PurchaseRequestGetPayload<{ select: typeof DETAIL_SELECT }>;

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function listRequests(context: UserContext, query: RequestListQuery) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.view");

  const where = buildListWhere([context], query);

  const [rows, total] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where,
      orderBy: orderFor(query.sort),
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: LIST_SELECT,
    }),
    prisma.purchaseRequest.count({ where }),
  ]);

  const today = new Date();
  return {
    data: rows.map((row) => toSummaryDTO(row, today)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

/**
 * The register's `where`, for one company's context or for every company a
 * Group read spans. Each company's own scope is unioned in the database before
 * any filter, sort or page, so a page of the group list is a page of exactly
 * what the companies would each have shown (Workspace Context §57).
 */
function buildListWhere(
  contexts: UserContext[],
  query: RequestListQuery,
): Prisma.PurchaseRequestWhereInput {
  const filters: Prisma.PurchaseRequestWhereInput[] = [unionWhere(contexts, buildRequestScopeWhere)];

  // The named views are the same list with a different default filter, so
  // /procurement/requests/pending and ?status=PENDING_APPROVAL cannot disagree.
  switch (query.view) {
    case "mine":
      // Raised by the person, as whichever membership they hold in each company.
      filters.push(
        unionWhere<Prisma.PurchaseRequestWhereInput>(contexts, (context) => ({
          requestedByMemberId: context.membershipId,
          archivedAt: null,
        })),
      );
      break;
    case "drafts":
      filters.push({ status: { in: ["DRAFT", "REJECTED"] }, archivedAt: null });
      break;
    case "pending":
      filters.push({ status: "PENDING_APPROVAL", archivedAt: null });
      break;
    case "approved":
      filters.push({ status: "APPROVED", archivedAt: null });
      break;
    case "sourcing":
      filters.push({ status: { in: ["IN_SOURCING", "PARTIALLY_ORDERED"] }, archivedAt: null });
      break;
    case "ordered":
      filters.push({ status: { in: ["ORDERED", "COMPLETED"] }, archivedAt: null });
      break;
    case "archived":
      filters.push({ archivedAt: { not: null } });
      break;
    default:
      filters.push({ archivedAt: null });
  }

  if (query.status?.length) filters.push({ status: { in: query.status } });
  if (query.priority?.length) filters.push({ priority: { in: query.priority } });
  if (query.projectId) filters.push({ projectId: query.projectId });
  if (query.departmentId) filters.push({ departmentId: query.departmentId });
  if (query.requestedByMemberId) filters.push({ requestedByMemberId: query.requestedByMemberId });
  if (query.category?.length) {
    filters.push({ items: { some: { category: { in: query.category } } } });
  }

  /*
   * Search reaches the line descriptions as well as the header, because people
   * look for "rebar" and not for "PR-2026-0014". The join sits inside the same
   * scoped `where`, so a request outside scope stays invisible whatever the
   * term matches (PRD #19 §250, §257).
   */
  const search = searchClause(query.search, ["requestNumber", "title", "description"]);
  if (search) {
    const term = query.search!.trim();
    filters.push({
      OR: [...search.OR, { items: { some: { description: { contains: term, mode: "insensitive" } } } }],
    });
  }

  return { AND: filters };
}

function orderFor(
  sort: RequestListQuery["sort"],
): Prisma.PurchaseRequestOrderByWithRelationInput[] {
  switch (sort) {
    case "created-desc":
      return [{ createdAt: "desc" }];
    case "number-asc":
      return [{ requestNumber: "asc" }];
    case "required-asc":
      return [{ requiredDate: { sort: "asc", nulls: "last" } }];
    case "priority-desc":
      return [{ priority: "desc" }, { requiredDate: { sort: "asc", nulls: "last" } }];
    case "value-desc":
      return [{ estimatedTotal: "desc" }];
    case "status-asc":
      return [{ status: "asc" }, { updatedAt: "desc" }];
    default:
      return [{ updatedAt: "desc" }];
  }
}

/**
 * The register the active workspace shows (Workspace Context §38).
 *
 * A company workspace is `listRequests`, untouched. The Group workspace is one
 * query over the union of each authorised company's own request scope, every
 * row labelled with its company; the `company` filter may narrow it to one of
 * those companies and is ignored for any other (§86).
 */
export async function listRequestsForWorkspace(session: UserContext, query: RequestListQuery) {
  if (!inGroupWorkspace(session)) return listRequests(session, query);

  const contexts = narrowToCompany(
    await groupProcurementContexts(session, "procurement.request.view"),
    query.companyId,
  );
  const where = buildListWhere(contexts, query);

  const [rows, total] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where,
      // The list's own sort first; the id keeps a page boundary stable when rows tie.
      orderBy: [...orderFor(query.sort), { id: "asc" }],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: GROUP_LIST_SELECT,
    }),
    prisma.purchaseRequest.count({ where }),
  ]);

  const today = new Date();
  return {
    data: rows.map((row) => toSummaryDTO(row, today)),
    pagination: paginationMeta(total, query.page, query.limit),
  };
}

export async function getRequest(
  context: UserContext,
  requestId: string,
): Promise<RequestDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.view");

  // Out of scope answers "not found", so the response cannot confirm that a
  // request exists to somebody who may not open it (PRD #19 §223).
  const row = assertFound(
    await prisma.purchaseRequest.findFirst({
      where: { AND: [buildRequestScopeWhere(context), { id: requestId }] },
      select: DETAIL_SELECT,
    }),
  );

  const today = new Date();

  const [history, createdBy, approvedBy, rejectedBy, sourcing, projectReachable] =
    await Promise.all([
      approvals.approvalHistory(context, "PURCHASE_REQUEST", row.id),
      loadMemberRef(row.createdByMemberId),
      loadMemberRef(row.approvedByMemberId),
      loadMemberRef(row.rejectedByMemberId),
      sourcingSummary(context, row.id),
      row.projectId ? isProjectReachable(context, row.projectId) : Promise.resolve(false),
    ]);

  return {
    ...toSummaryDTO(row, today),
    description: row.description,
    items: row.items.map(toItemDTO),
    dates: {
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    },
    rejectionReason: row.rejectionReason,
    approvedBy,
    rejectedBy,
    projectLink: row.project
      ? moduleLink(
          row.project.id,
          `${row.project.code} — ${row.project.name}`,
          `/projects/${row.project.id}`,
          projectReachable,
        )
      : null,
    sourcing,
    approvals: history,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    capabilities: capabilitiesFor(context, row, history.find((entry) => entry.status === "PENDING")),
  };
}

/** The contracts on one project record (PRD #19 §9). */
export async function listForProject(
  context: UserContext,
  projectId: string,
): Promise<RequestSummaryDTO[]> {
  if (!can(context, "procurement.request.view")) return [];

  const rows = await prisma.purchaseRequest.findMany({
    where: { AND: [buildRequestScopeWhere(context), { projectId, archivedAt: null }] },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: LIST_SELECT,
  });

  const today = new Date();
  return rows.map((row) => toSummaryDTO(row, today));
}

async function isProjectReachable(context: UserContext, projectId: string): Promise<boolean> {
  if (!can(context, "project.view")) return false;
  const found = await prisma.project.findFirst({
    where: { AND: [buildProjectScopeWhere(context), { id: projectId }] },
    select: { id: true },
  });
  return found !== null;
}

/** How far the sourcing has got, for the detail page (PRD #19 §61, §62). */
async function sourcingSummary(context: UserContext, requestId: string) {
  const [rfqs, orders] = await Promise.all([
    can(context, "procurement.rfq.view")
      ? prisma.rFQ.count({ where: { purchaseRequestId: requestId } })
      : Promise.resolve(0),
    can(context, "procurement.order.view")
      ? prisma.purchaseOrder.findMany({
          where: { purchaseRequestId: requestId, status: { notIn: ["CANCELLED", "REJECTED"] } },
          select: { totalAmount: true, currency: true },
        })
      : Promise.resolve([]),
  ]);

  // Only summed when every order is in one currency: V0.1 never adds two
  // together (PRD #19 §190).
  const currencies = new Set(orders.map((row) => row.currency));
  const orderedValue =
    orders.length > 0 && currencies.size === 1
      ? toAmountString(
          orders.reduce((sum, row) => sum.plus(row.totalAmount), new Prisma.Decimal(0)),
        )
      : null;

  return { rfqs, orders: orders.length, orderedValue };
}

export async function requestFilterOptions(context: UserContext) {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.view");

  const scope = buildRequestScopeWhere(context);

  const [projects, departments, requesters] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [buildProcurementProjectWhere(context), { purchaseRequests: { some: scope } }] },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.department.findMany({
      where: { companyId: context.companyId, purchaseRequests: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { companyId: context.companyId, requestedPurchases: { some: scope } },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, departments, requesters };
}

type InCompany = { company?: { name: string } };

export type RequestFilterOptions = {
  projects: ({ id: string; code: string; name: string } & InCompany)[];
  departments: ({ id: string; name: string } & InCompany)[];
  requesters: ({ id: string; user: { firstName: string; lastName: string } } & InCompany)[];
  /** The Group `company` filter's choices; empty in a company workspace, where the filter is locked (§86). */
  companies: { value: string; label: string }[];
};

/**
 * The filter choices for the workspace's register: a company's own, or in the
 * Group workspace the union across companies, each named with its company so
 * two projects that share a code stay distinguishable (Workspace Context §45).
 */
export async function requestFilterOptionsForWorkspace(session: UserContext): Promise<RequestFilterOptions> {
  if (!inGroupWorkspace(session)) {
    return { ...(await requestFilterOptions(session)), companies: [] };
  }

  const contexts = await groupProcurementContexts(session, "procurement.request.view");
  const inCompany = { select: { name: true } } as const;

  const [projects, departments, requesters] = await Promise.all([
    prisma.project.findMany({
      where: {
        OR: contexts.map((context) => ({
          AND: [
            buildProcurementProjectWhere(context),
            { purchaseRequests: { some: buildRequestScopeWhere(context) } },
          ],
        })),
      },
      select: { id: true, code: true, name: true, company: inCompany },
      orderBy: [{ code: "asc" }, { id: "asc" }],
    }),
    prisma.department.findMany({
      where: {
        OR: contexts.map((context) => ({
          companyId: context.companyId,
          purchaseRequests: { some: buildRequestScopeWhere(context) },
        })),
      },
      select: { id: true, name: true, company: inCompany },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.companyMember.findMany({
      where: {
        OR: contexts.map((context) => ({
          companyId: context.companyId,
          requestedPurchases: { some: buildRequestScopeWhere(context) },
        })),
      },
      select: { id: true, user: { select: { firstName: true, lastName: true } }, company: inCompany },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }, { id: "asc" }],
    }),
  ]);

  return { projects, departments, requesters, companies: companyFilterOptions(contexts) };
}

/**
 * What a request form may offer (PRD #19 §51, §258).
 *
 * Every list is resolved through the caller's own access to the other module,
 * so a picker never becomes a directory of projects they cannot open.
 */
export async function requestFormOptions(context: UserContext) {
  assertModule(context, MODULE);

  const [projects, departments, members] = await Promise.all([
    prisma.project.findMany({
      where: buildProcurementProjectWhere(context),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.department.findMany({
      where: { companyId: context.companyId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: buildProcurementMemberWhere(context),
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
  ]);

  return { projects, departments, members };
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createRequest(
  context: UserContext,
  input: RequestInput,
): Promise<RequestDetailDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.create");

  const related = await resolveRelated(context, input);

  const id = await prisma.$transaction(async (tx) => {
    const requestNumber = await nextDocumentNumber(tx, "purchaseRequest", context.companyId);

    const request = await tx.purchaseRequest.create({
      data: {
        companyId: context.companyId,
        requestNumber,
        title: input.title,
        description: input.description ?? null,
        projectId: related.projectId,
        departmentId: related.departmentId,
        requestedByMemberId: context.membershipId,
        ownerMemberId: related.ownerMemberId,
        requiredDate: input.requiredDate ?? null,
        priority: input.priority,
        currency: input.currency ?? null,
        estimatedTotal: estimatedTotal(
          input.items.map((item) => ({
            quantity: item.quantity,
            estimatedUnitPrice: item.estimatedUnitPrice ?? null,
          })),
        ),
        status: "DRAFT",
        createdByMemberId: context.membershipId,
        items: {
          create: input.items.map((item, index) => ({
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unit: item.unit,
            estimatedUnitPrice:
              item.estimatedUnitPrice === undefined
                ? null
                : new Prisma.Decimal(item.estimatedUnitPrice),
            estimatedAmount: estimatedTotal([
              { quantity: item.quantity, estimatedUnitPrice: item.estimatedUnitPrice ?? null },
            ]),
            category: item.category ?? null,
            specification: item.specification ?? null,
            sortOrder: index + 1,
          })),
        },
      },
      select: { id: true, requestNumber: true },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: request.id,
      action: "PROCUREMENT_REQUEST_CREATED",
      // Names the record and the action and nothing priced: everybody who can
      // see the request at all reads this (PRD #19 §174).
      message: `raised request ${request.requestNumber}`,
      metadata: { projectId: related.projectId, lines: input.items.length } as Prisma.InputJsonValue,
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
  assertPermission(context, "procurement.request.update");

  const existing = await loadForWrite(context, requestId);

  if (!isRequestEditable(existing.status)) {
    throw new AccessError(
      "CONFLICT",
      "This request has been approved, so its lines are fixed. Raise a new one instead.",
      { code: "REQUEST_NOT_EDITABLE" },
    );
  }

  assertNotStale(input.versionUpdatedAt, existing.updatedAt);

  const related = await resolveRelated(context, input);

  // What the editor does not show is kept, not erased (AUD-09 §4, FV-05,
  // FV-10): a line that comes back with its id and no `specification` key keeps
  // the specification it was saved with; an explicit empty value clears it.
  const savedLines = new Map(
    (
      await prisma.purchaseRequestItem.findMany({
        where: { purchaseRequestId: requestId },
        select: { id: true, specification: true },
      })
    ).map((line) => [line.id, line]),
  );
  const specificationOf = (item: RequestItemInput) =>
    item.specification !== undefined ? item.specification : ((item.id && savedLines.get(item.id)?.specification) ?? null);

  await prisma.$transaction(async (tx) => {
    // Lines are replaced wholesale: reconciling an edited set against the
    // stored one is a diff nobody can read, and the request is still a draft.
    await tx.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: requestId } });

    await tx.purchaseRequest.update({
      where: { id: requestId },
      data: {
        title: input.title,
        description: input.description ?? null,
        projectId: related.projectId,
        departmentId: related.departmentId,
        ownerMemberId: related.ownerMemberId,
        requiredDate: input.requiredDate ?? null,
        priority: input.priority,
        currency: input.currency ?? null,
        estimatedTotal: estimatedTotal(
          input.items.map((item) => ({
            quantity: item.quantity,
            estimatedUnitPrice: item.estimatedUnitPrice ?? null,
          })),
        ),
        updatedByMemberId: context.membershipId,
        items: {
          create: input.items.map((item, index) => ({
            description: item.description,
            quantity: new Prisma.Decimal(item.quantity),
            unit: item.unit,
            estimatedUnitPrice:
              item.estimatedUnitPrice === undefined
                ? null
                : new Prisma.Decimal(item.estimatedUnitPrice),
            estimatedAmount: estimatedTotal([
              { quantity: item.quantity, estimatedUnitPrice: item.estimatedUnitPrice ?? null },
            ]),
            category: item.category ?? null,
            specification: specificationOf(item),
            sortOrder: index + 1,
          })),
        },
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_UPDATED",
      message: `updated request ${existing.requestNumber}`,
    });
  });

  return getRequest(context, requestId);
}

export async function submitRequest(context: UserContext, requestId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.submit");

  const existing = await loadForWrite(context, requestId);

  if (!isRequestSubmittable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a draft can be sent for approval.", {
      code: "INVALID_TRANSITION",
    });
  }

  const lines = await prisma.purchaseRequestItem.count({ where: { purchaseRequestId: requestId } });
  if (lines === 0) {
    throw new AccessError("VALIDATION_ERROR", "Add at least one line before submitting.", {
      code: "REQUEST_EMPTY",
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "submit",
      id: requestId,
      context,
      from: existing.status,
      data: { submittedAt: new Date() },
    });
    await approvals.openApproval(tx, context, "PURCHASE_REQUEST", requestId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_SUBMITTED",
      message: `sent request ${existing.requestNumber} for approval`,
    });
  });
}

export async function approveRequest(
  context: UserContext,
  requestId: string,
  note: string | null,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  approvals.assertCanApprove(context, "PURCHASE_REQUEST");

  const existing = await loadForWrite(context, requestId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "PURCHASE_REQUEST", requestId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "approve",
      id: requestId,
      context,
      from: existing.status,
      data: {
        approvedAt: new Date(),
        approvedByMemberId: context.membershipId,
        rejectedAt: null,
        rejectedByMemberId: null,
        rejectionReason: null,
      },
    });
    await approvals.decideApproval(tx, context, approval.id, "APPROVED", note);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_APPROVED",
      message: `approved request ${existing.requestNumber}`,
    });
  });
}

export async function rejectRequest(
  context: UserContext,
  requestId: string,
  reason: string,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  // The dialog asks for a reason; so does the service behind it (AUD-10 §4, A13).
  requireDecisionNote(reason);
  approvals.assertCanReject(context, "PURCHASE_REQUEST");

  const existing = await loadForWrite(context, requestId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "PURCHASE_REQUEST", requestId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "reject",
      id: requestId,
      context,
      from: existing.status,
      data: {
        rejectedAt: new Date(),
        rejectedByMemberId: context.membershipId,
        rejectionReason: reason,
      },
    });
    await approvals.decideApproval(tx, context, approval.id, "REJECTED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_REJECTED",
      message: `rejected request ${existing.requestNumber}`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/**
 * Returns a request for revision (PRD #41 §48): back to draft with the
 * approver's reason, to be corrected and submitted again as a new cycle.
 */
export async function returnRequest(
  context: UserContext,
  requestId: string,
  reason: string,
  guard: ApprovalGuard | undefined,
): Promise<void> {
  assertModule(context, MODULE);
  // The dialog asks for a reason; so does the service behind it (AUD-10 §4, A13).
  requireDecisionNote(reason);
  approvals.assertCanReject(context, "PURCHASE_REQUEST");

  const existing = await loadForWrite(context, requestId);

  await prisma.$transaction(async (tx) => {
    const approval = await approvals.requirePendingApproval(tx, context, "PURCHASE_REQUEST", requestId, guard);
    approvals.assertNotSelfApproval(context, approval.submittedByMemberId);

    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "return",
      id: requestId,
      context,
      from: existing.status,
    });
    await approvals.decideApproval(tx, context, approval.id, "RETURNED", reason);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_RETURNED",
      message: `returned request ${existing.requestNumber} for revision`,
      metadata: { reason } as Prisma.InputJsonValue,
    });
  });
}

/** Approved, and now being priced (PRD #19 §61). */
export async function startSourcing(context: UserContext, requestId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.rfq.create");

  const existing = await loadForWrite(context, requestId);

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "start_sourcing",
      id: requestId,
      context,
      from: existing.status,
    });
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_SOURCING",
      message: `started sourcing request ${existing.requestNumber}`,
    });
  });
}

export async function cancelRequest(
  context: UserContext,
  requestId: string,
  note: string | null,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.cancel");

  const existing = await loadForWrite(context, requestId);

  if (!isRequestCancellable(existing.status)) {
    throw new AccessError("CONFLICT", "This request can no longer be cancelled.", {
      code: "INVALID_TRANSITION",
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "cancel",
      id: requestId,
      context,
      from: existing.status,
      data: { cancelledAt: new Date() },
    });
    await approvals.cancelPendingApprovals(tx, context, "PURCHASE_REQUEST", requestId);

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_CANCELLED",
      message: `cancelled request ${existing.requestNumber}`,
      metadata: note ? ({ note } as Prisma.InputJsonValue) : undefined,
    });
  });
}

export async function archiveRequest(context: UserContext, requestId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.archive");

  const existing = await loadForWrite(context, requestId);
  if (existing.archivedAt) return;

  if (!isRequestArchivable(existing.status)) {
    throw new AccessError("CONFLICT", "Only a finished request can be archived.", {
      code: "INVALID_TRANSITION",
    });
  }

  await prisma.$transaction(async (tx) => {
    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "archive",
      id: requestId,
      context,
      from: existing.status,
      data: {
        preArchiveStatus: existing.status,
        archivedAt: new Date(),
        archivedByMemberId: context.membershipId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_ARCHIVED",
      message: `archived request ${existing.requestNumber}`,
    });
  });
}

export async function restoreRequest(context: UserContext, requestId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "procurement.request.restore");

  const existing = await loadForWrite(context, requestId);
  if (!existing.archivedAt) return;

  await prisma.$transaction(async (tx) => {
    // Returns the status it held before, not a guess: leaving the archive is
    // not a lifecycle decision.
    await applyTransition(tx, {
      machine: purchaseRequestMachine,
      action: "restore",
      id: requestId,
      context,
      from: existing.status,
      to: existing.preArchiveStatus ?? "DRAFT",
      data: {
        preArchiveStatus: null,
        archivedAt: null,
        archivedByMemberId: null,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: requestId,
      action: "PROCUREMENT_REQUEST_RESTORED",
      message: `restored request ${existing.requestNumber}`,
    });
  });
}

type OrderingStatus = Extract<PurchaseRequestStatus, "PARTIALLY_ORDERED" | "ORDERED" | "COMPLETED">;

/** The machine's action for each state a request's orders can leave it in. */
const ORDERING_ACTION: Record<OrderingStatus, PurchaseRequestAction> = {
  PARTIALLY_ORDERED: "partially_order",
  ORDERED: "order",
  COMPLETED: "complete",
};

/**
 * Re-derives how much of a request has been ordered (PRD #19 §62, §63).
 *
 * Called by the order service after an order is issued, cancelled, closed or
 * received against, so the request's status is a consequence of what exists
 * rather than something somebody remembered to click. The machine decides
 * whether the derived status is a move at all — the ordering states only go
 * forward, and only once sourcing has started.
 */
export async function refreshSourcingState(
  tx: Prisma.TransactionClient,
  context: UserContext,
  requestId: string,
): Promise<void> {
  const request = await tx.purchaseRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, requestNumber: true, archivedAt: true },
  });

  if (!request || request.archivedAt) return;
  if (!acceptsSourcing(request.status) && request.status !== "ORDERED") return;

  const [lines, orders] = await Promise.all([
    tx.purchaseRequestItem.count({ where: { purchaseRequestId: requestId } }),
    tx.purchaseOrder.findMany({
      where: { purchaseRequestId: requestId, status: { notIn: ["CANCELLED", "REJECTED"] } },
      select: { id: true, status: true, items: { select: { sourceRequestItemId: true } } },
    }),
  ]);

  if (orders.length === 0) return;

  const covered = new Set(
    orders.flatMap((order) =>
      order.items.map((item) => item.sourceRequestItemId).filter((id): id is string => id !== null),
    ),
  );

  // Every order closed and every line covered means the ask is met.
  const allClosed = orders.every((order) => order.status === "CLOSED" || order.status === "RECEIVED");
  const next: OrderingStatus =
    covered.size >= lines && lines > 0
      ? allClosed
        ? "COMPLETED"
        : "ORDERED"
      : "PARTIALLY_ORDERED";

  if (next === request.status) return;
  if (!canTransitionRequestStatus(request.status, next)) return;

  await applyTransition(tx, {
    machine: purchaseRequestMachine,
    action: ORDERING_ACTION[next],
    id: requestId,
    context,
    from: request.status,
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type WriteRow = {
  id: string;
  requestNumber: string;
  status: PurchaseRequestStatus;
  preArchiveStatus: PurchaseRequestStatus | null;
  archivedAt: Date | null;
  updatedAt: Date;
};

async function loadForWrite(context: UserContext, requestId: string): Promise<WriteRow> {
  return assertFound(
    await prisma.purchaseRequest.findFirst({
      where: { AND: [buildRequestScopeWhere(context), { id: requestId }] },
      select: {
        id: true,
        requestNumber: true,
        status: true,
        preArchiveStatus: true,
        archivedAt: true,
        updatedAt: true,
      },
    }),
  );
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

async function resolveRelated(context: UserContext, input: RequestInput) {
  let projectId: string | null = null;
  if (input.projectId) {
    // Inside the caller's project scope: a request must not become a way to
    // attach spend to a project they cannot open (PRD #19 §53).
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

  let departmentId: string | null = null;
  if (input.departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: input.departmentId, companyId: context.companyId },
      select: { id: true },
    });
    if (!department) {
      throw new AccessError("VALIDATION_ERROR", "That department does not exist.", {
        code: "INVALID_DEPARTMENT",
      });
    }
    departmentId = department.id;
  }

  let ownerMemberId: string | null = null;
  if (input.ownerMemberId) {
    const member = await prisma.companyMember.findFirst({
      where: {
        id: input.ownerMemberId,
        companyId: context.companyId,
        status: "ACTIVE",
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!member) {
      throw new AccessError(
        "VALIDATION_ERROR",
        "Choose an active member of this company as the buyer.",
        { code: "INVALID_OWNER" },
      );
    }
    ownerMemberId = member.id;
  }

  return { projectId, departmentId, ownerMemberId };
}

function toItemDTO(row: DetailRow["items"][number]): RequestItemDTO {
  return {
    id: row.id,
    description: row.description,
    quantity: quantityString(row.quantity),
    unit: row.unit,
    estimatedUnitPrice:
      row.estimatedUnitPrice === null ? null : quantityString(row.estimatedUnitPrice),
    estimatedAmount: toAmountString(row.estimatedAmount),
    category: row.category,
    specification: row.specification,
    sortOrder: row.sortOrder,
  };
}

export function toSummaryDTO(row: ListRow, today: Date): RequestSummaryDTO {
  const settled =
    row.status === "ORDERED" ||
    row.status === "COMPLETED" ||
    row.status === "CANCELLED" ||
    row.status === "REJECTED" ||
    row.status === "ARCHIVED";

  const daysToRequired = row.requiredDate ? daysBetween(today, row.requiredDate) : null;

  return {
    id: row.id,
    requestNumber: row.requestNumber,
    title: row.title,
    status: row.status,
    priority: row.priority,
    project: row.project,
    department: row.department,
    requestedBy: toMemberRef(row.requestedBy)!,
    owner: toMemberRef(row.owner),
    requiredDate: dateString(row.requiredDate),
    currency: row.currency,
    estimatedTotal: toAmountString(row.estimatedTotal),
    itemCount: row._count.items,
    attention: {
      overdue: daysToRequired !== null && daysToRequired < 0 && !settled,
      daysToRequired,
      awaitingDecision: row.status === "PENDING_APPROVAL",
      unsourced: row.status === "APPROVED",
    },
    updatedAt: row.updatedAt.toISOString(),
    ...(row.company ? { company: row.company } : {}),
  };
}

function capabilitiesFor(
  context: UserContext,
  row: DetailRow,
  pending?: { submittedBy: { memberId: string } | null },
): RequestCapabilities {
  const archived = row.archivedAt !== null;
  const live = !archived;

  /*
   * Nobody decides on what they submitted (PRD #19 §21). The service refuses it
   * either way; this is so the button is not drawn in the first place, because
   * offering an action that is certain to fail is worse than not offering it.
   */
  const selfSubmitted = pending?.submittedBy?.memberId === context.membershipId;

  const allow = (permission: Parameters<typeof can>[1], condition: boolean) =>
    live && condition && can(context, permission);

  return {
    canEdit: allow("procurement.request.update", isRequestEditable(row.status)),
    canSubmit: allow("procurement.request.submit", isRequestSubmittable(row.status)),
    canApprove:
      live &&
      row.status === "PENDING_APPROVAL" &&
      !selfSubmitted &&
      approvals.canApproveType(context, "PURCHASE_REQUEST"),
    canReject:
      live &&
      row.status === "PENDING_APPROVAL" &&
      !selfSubmitted &&
      approvals.canRejectType(context, "PURCHASE_REQUEST"),
    canCancel: allow("procurement.request.cancel", isRequestCancellable(row.status)),
    canArchive: allow("procurement.request.archive", isRequestArchivable(row.status)),
    canRestore: archived && can(context, "procurement.request.restore"),
    canCreateRfq: allow("procurement.rfq.create", acceptsSourcing(row.status)),
    canCreateOrder: allow("procurement.order.create", acceptsSourcing(row.status)),
    canViewDocuments: can(context, "procurement.document.view") && can(context, "document.view"),
    canViewActivity: can(context, "procurement.activity.view"),
  };
}
