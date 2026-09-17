import type { Prisma } from "@prisma/client";

import { can, getModuleScope } from "@/lib/access/can";
import { buildClientScopeWhere, buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Contract scope (PRD #18 §17, §19, §246–§252).
 *
 * The access formula is three terms, not one (PRD #18 §19):
 *
 *   contract permission + contract scope + parent context access
 *
 * Client access alone never reaches a contract. That is the whole point of the
 * separation: a salesperson who can open a customer record has not thereby been
 * told what the company agreed to pay its subcontractor on that customer's job
 * (PRD #18 §251).
 *
 *   SELF / ASSIGNED  the contracts they own
 *   DEPARTMENT       their department's contracts, plus their own
 *   PROJECT          the contracts on projects they can open
 *   COMPANY          every contract in the company
 */

export type ContractScopeKind = "SELF" | "DEPARTMENT" | "PROJECT" | "COMPANY";

export function contractScopeKind(context: UserContext): ContractScopeKind {
  const scope = getModuleScope(context, "contracts");
  if (scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM") return "COMPANY";
  if (scope === "DEPARTMENT") return "DEPARTMENT";
  if (scope === "PROJECT") return "PROJECT";
  return "SELF";
}

export function hasCompanyContractScope(context: UserContext): boolean {
  return contractScopeKind(context) === "COMPANY";
}

export function buildContractScopeWhere(context: UserContext): Prisma.ContractWhereInput {
  const kind = contractScopeKind(context);
  const base: Prisma.ContractWhereInput = { companyId: context.companyId };

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
    /*
     * The agreements behind the jobs they run (PRD #18 §28, §248, §440).
     *
     * A company contract with no project attached is deliberately unreachable:
     * an NDA or a group framework agreement is not something a project manager
     * inherits by being given a project.
     */
    return {
      ...base,
      OR: [
        { ownerMemberId: context.membershipId },
        { projectId: { not: null }, project: buildProjectScopeWhere(context) },
      ],
    };
  }

  return { ...base, ownerMemberId: context.membershipId };
}

/**
 * Scope for the records that hang off a contract.
 *
 * Every one of them inherits the contract rather than carrying a scope clause
 * of its own, so there is exactly one answer to "may this person see this
 * agreement?" (PRD #18 §164).
 */
export function buildPartyScopeWhere(context: UserContext): Prisma.ContractPartyWhereInput {
  return { contract: { is: buildContractScopeWhere(context) } };
}

export function buildObligationScopeWhere(
  context: UserContext,
): Prisma.ContractObligationWhereInput {
  return { contract: { is: buildContractScopeWhere(context) } };
}

export function buildAmendmentScopeWhere(
  context: UserContext,
): Prisma.ContractAmendmentWhereInput {
  return { contract: { is: buildContractScopeWhere(context) } };
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Clients a contract form may name (PRD #18 §53, §297).
 *
 * Resolved through the caller's own Clients access, never company-wide: a
 * filter dropdown must not become a directory of customers they cannot open.
 */
export function buildContractClientWhere(context: UserContext): Prisma.ClientWhereInput {
  if (!can(context, "client.view")) return { id: { in: [] } };
  return {
    AND: [buildClientScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
  };
}

/** Projects a contract may be attached to (PRD #18 §54, §283). */
export function buildContractProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  return {
    AND: [buildProjectScopeWhere(context), { archivedAt: null, status: { not: "ARCHIVED" } }],
  };
}

/**
 * Members a contract may be owned by (PRD #18 §52).
 *
 * Company-wide and active: ownership is a company fact rather than a scoped
 * one — but never another company's people.
 */
export function buildContractOwnerWhere(context: UserContext): Prisma.CompanyMemberWhereInput {
  return { companyId: context.companyId, status: "ACTIVE", archivedAt: null };
}
