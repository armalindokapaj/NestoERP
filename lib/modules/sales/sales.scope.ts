import type { Prisma } from "@prisma/client";

import { getModuleScope } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Sales scope (PRD #17 §15, §40, §74, §191–§195).
 *
 * A sales record is owned by a person, so scope is answered by ownership rather
 * than by project membership:
 *
 *   SELF / ASSIGNED  the records they own
 *   DEPARTMENT       their department's records, plus their own
 *   COMPANY          everything in the company
 *   PROJECT          the deals that became their projects, and nothing else
 *
 * PROJECT is the interesting one (PRD #17 §195, §354). A project manager
 * receives a won opportunity because they are delivering it. Handing them the
 * open pipeline as well would make the company's commercial position a side
 * effect of being assigned a job, so the clause reaches won work linked to a
 * project they can open — never the deals still being fought for.
 */

export type SalesScopeKind = "SELF" | "DEPARTMENT" | "PROJECT" | "COMPANY";

export function salesScopeKind(context: UserContext): SalesScopeKind {
  const scope = getModuleScope(context, "sales");
  if (scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM") return "COMPANY";
  if (scope === "DEPARTMENT") return "DEPARTMENT";
  if (scope === "PROJECT") return "PROJECT";
  return "SELF";
}

export function hasCompanySalesScope(context: UserContext): boolean {
  return salesScopeKind(context) === "COMPANY";
}

/**
 * Leads (PRD #17 §40).
 *
 * There is no project-shaped lead: a lead exists before there is anything to
 * deliver. PROJECT scope therefore narrows to the reader's own, which is the
 * safe reading rather than an empty one.
 */
export function buildLeadScopeWhere(context: UserContext): Prisma.LeadWhereInput {
  const kind = salesScopeKind(context);
  const base: Prisma.LeadWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [
        { ownerMemberId: context.membershipId },
        { owner: { departmentId: context.department.id } },
      ],
    };
  }

  return { ...base, ownerMemberId: context.membershipId };
}

export function buildOpportunityScopeWhere(
  context: UserContext,
): Prisma.OpportunityWhereInput {
  const kind = salesScopeKind(context);
  const base: Prisma.OpportunityWhereInput = { companyId: context.companyId };

  if (kind === "COMPANY") return base;

  if (kind === "DEPARTMENT" && context.department) {
    return {
      ...base,
      OR: [
        { ownerMemberId: context.membershipId },
        { owner: { departmentId: context.department.id } },
      ],
    };
  }

  if (kind === "PROJECT") {
    return {
      ...base,
      OR: [
        { ownerMemberId: context.membershipId },
        // The handoff, and only the handoff: a converted project they can open
        // (PRD #17 §195, §267).
        { convertedProjectId: { not: null }, convertedProject: buildProjectScopeWhere(context) },
      ],
    };
  }

  return { ...base, ownerMemberId: context.membershipId };
}

/**
 * The Group workspace reads sales as the union of every authorised company's
 * own scope (Workspace Context §57, §58, §62).
 *
 * Each branch is that company's real scope clause for the reader's membership
 * there, so it starts with `companyId` and carries that company's SELF /
 * DEPARTMENT / PROJECT / COMPANY rule — a rep who owns two deals in Company B
 * and holds only their own scope there gets those two, never B's pipeline. The
 * union is applied in the database, before search, filters, sort and
 * pagination. No company means no rows, never "all rows": an empty `OR` would
 * read as false today and as a mistake tomorrow.
 */
function unionOf<T>(contexts: UserContext[], build: (context: UserContext) => T): { id: { in: never[] } } | T | { OR: T[] } {
  if (contexts.length === 0) return { id: { in: [] } };
  if (contexts.length === 1) return build(contexts[0]);
  return { OR: contexts.map((context) => build(context)) };
}

export function buildLeadUnionWhere(contexts: UserContext[]): Prisma.LeadWhereInput {
  return unionOf(contexts, buildLeadScopeWhere);
}

export function buildOpportunityUnionWhere(contexts: UserContext[]): Prisma.OpportunityWhereInput {
  return unionOf(contexts, buildOpportunityScopeWhere);
}

export function buildProposalUnionWhere(contexts: UserContext[]): Prisma.ProposalWhereInput {
  return unionOf(contexts, buildProposalScopeWhere);
}

/**
 * Proposals inherit the opportunity they quote (PRD #17 §216, §415).
 *
 * `sales.proposal.view` alone is deliberately not enough — the opportunity has
 * to be reachable too, or the proposal list becomes a way to read prices off
 * deals the reader may not open.
 */
export function buildProposalScopeWhere(context: UserContext): Prisma.ProposalWhereInput {
  const base: Prisma.ProposalWhereInput = { companyId: context.companyId };
  if (hasCompanySalesScope(context)) return base;

  return { AND: [base, { opportunity: { is: buildOpportunityScopeWhere(context) } }] };
}

/**
 * Clients a sales form may name (PRD #17 §53, §218).
 *
 * Resolved through the Clients scope, never company-wide: the picker must not
 * become a directory of customers the reader cannot otherwise see.
 */
export function buildSalesClientWhere(context: UserContext): Prisma.ClientWhereInput {
  return {
    AND: [buildClientScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
  };
}

/** Projects a won opportunity may be linked to (PRD #17 §89). */
export function buildSalesProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  return {
    AND: [buildProjectScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
  };
}

/**
 * Members a sales record may be owned by (PRD #17 §220).
 *
 * Company-wide and active, because ownership is a company fact rather than a
 * scoped one — but never another company's people.
 */
export function buildSalesOwnerWhere(context: UserContext): Prisma.CompanyMemberWhereInput {
  return { companyId: context.companyId, status: "ACTIVE", archivedAt: null };
}
