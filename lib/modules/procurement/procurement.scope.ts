import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Procurement scope (PRD #19 §16, §216–§222).
 *
 * Buying documents follow the job they are for. The ladder:
 *
 *   SELF / ASSIGNED  what they raised themselves
 *   DEPARTMENT       their department's requests, plus their own
 *   PROJECT          everything on projects they can open, plus their own
 *   COMPANY          the whole buying book
 *
 * A company-general request — office equipment, group insurance — has no
 * project to inherit from, so it is reachable only by its requester and by
 * company scope. That is deliberate: being given a site does not entitle
 * somebody to the head-office spend (PRD #19 §218).
 */

export type ProcurementScopeKind = "SELF" | "DEPARTMENT" | "PROJECT" | "COMPANY";

export function procurementScopeKind(context: UserContext): ProcurementScopeKind {
  const scope = getModuleScope(context, "procurement");
  if (scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM") return "COMPANY";
  if (scope === "DEPARTMENT") return "DEPARTMENT";
  if (scope === "PROJECT") return "PROJECT";
  return "SELF";
}

export function hasCompanyProcurementScope(context: UserContext): boolean {
  return procurementScopeKind(context) === "COMPANY";
}

export function buildRequestScopeWhere(context: UserContext): Prisma.PurchaseRequestWhereInput {
  const kind = procurementScopeKind(context);
  const base: Prisma.PurchaseRequestWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [
        { requestedByMemberId: context.membershipId },
        { ownerMemberId: context.membershipId },
        { departmentId: context.department.id },
      ],
    };
  }

  if (kind === "PROJECT") {
    return {
      ...base,
      OR: [
        { requestedByMemberId: context.membershipId },
        { ownerMemberId: context.membershipId },
        { projectId: { not: null }, project: buildProjectScopeWhere(context) },
      ],
    };
  }

  return {
    ...base,
    OR: [
      { requestedByMemberId: context.membershipId },
      { ownerMemberId: context.membershipId },
    ],
  };
}

export function buildOrderScopeWhere(context: UserContext): Prisma.PurchaseOrderWhereInput {
  const kind = procurementScopeKind(context);
  const base: Prisma.PurchaseOrderWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [
        { createdByMemberId: context.membershipId },
        { purchaseRequest: { is: { departmentId: context.department.id } } },
      ],
    };
  }

  if (kind === "PROJECT") {
    return {
      ...base,
      OR: [
        { createdByMemberId: context.membershipId },
        { projectId: { not: null }, project: buildProjectScopeWhere(context) },
      ],
    };
  }

  return { ...base, createdByMemberId: context.membershipId };
}

/**
 * An RFQ is as reachable as the buying it belongs to (PRD #19 §216).
 *
 * Through its request when it has one, and otherwise through its project. An
 * RFQ with neither is a company-general enquiry, reachable at company scope.
 */
export function buildRfqScopeWhere(context: UserContext): Prisma.RFQWhereInput {
  const kind = procurementScopeKind(context);
  const base: Prisma.RFQWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  return {
    ...base,
    OR: [
      { createdByMemberId: context.membershipId },
      { purchaseRequest: { is: buildRequestScopeWhere(context) } },
      ...(kind === "PROJECT"
        ? [{ projectId: { not: null }, project: buildProjectScopeWhere(context) }]
        : []),
    ],
  };
}

/** A quote inherits its RFQ entirely: one answer to "may they see this enquiry?". */
export function buildQuoteScopeWhere(context: UserContext): Prisma.SupplierQuoteWhereInput {
  return { rfq: { is: buildRfqScopeWhere(context) } };
}

/** A receipt inherits its order. */
export function buildReceiptScopeWhere(context: UserContext): Prisma.GoodsReceiptWhereInput {
  return { purchaseOrder: { is: buildOrderScopeWhere(context) } };
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Suppliers are a company-wide directory (PRD #19 §222).
 *
 * Unlike a client, a supplier carries no per-project confidentiality: knowing
 * the company buys from Atlas Materials is not knowing what it paid. What is
 * scoped is the buying documents, not the counterparty list.
 */
export function buildSupplierWhere(context: UserContext): Prisma.SupplierWhereInput {
  if (!can(context, "procurement.supplier.view")) return { id: { in: [] } };
  return { companyId: context.companyId };
}

/** Projects a procurement document may be attached to (PRD #19 §53, §283). */
export function buildProcurementProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  return {
    AND: [buildProjectScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
  };
}

/** Members a request may be raised by or owned by. */
export function buildProcurementMemberWhere(
  context: UserContext,
): Prisma.CompanyMemberWhereInput {
  return { companyId: context.companyId, status: "ACTIVE", archivedAt: null };
}
