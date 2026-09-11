import type { Prisma } from "@prisma/client";

import { getModuleScope } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Finance scope (PRD #15 §208–§216).
 *
 * Two questions, answered once:
 *
 *   1. Which projects can this reader reach? — answered by the Projects
 *      resolver, never by a second copy of the membership SQL (PRD #15 §209).
 *   2. May they see finance records that have no project? — only with
 *      company-level finance scope. A project-scoped reader who could also see
 *      the company's unlinked expenses has company finance access by another
 *      name (PRD #15 §211).
 */

export type FinanceScopeKind = "COMPANY" | "PROJECT";

/**
 * Company scope covers everything in the company; anything narrower is
 * project-shaped. DEPARTMENT is treated as project scope here on purpose:
 * there is no departmental ownership of a finance record to narrow by, so the
 * safe reading is the narrower one.
 */
export function financeScopeKind(context: UserContext): FinanceScopeKind {
  const scope = getModuleScope(context, "finance");
  return scope === "COMPANY" || scope === "SYSTEM" ? "COMPANY" : "PROJECT";
}

export function hasCompanyFinanceScope(context: UserContext): boolean {
  return financeScopeKind(context) === "COMPANY";
}

/**
 * The scope clause for a finance record that carries an optional `projectId`.
 *
 * At company scope the company itself is the boundary. Below it, the record
 * must belong to a project this reader can open — and a record with no project
 * is out of reach entirely, because there is nothing to authorise it against.
 */
export function buildProjectLinkedScopeWhere<
  T extends { companyId?: unknown; project?: unknown; projectId?: unknown },
>(context: UserContext): T {
  const base = { companyId: context.companyId } as T;
  if (hasCompanyFinanceScope(context)) return base;

  return {
    ...base,
    projectId: { not: null },
    project: buildProjectScopeWhere(context),
  } as T;
}

export function buildInvoiceScopeWhere(context: UserContext): Prisma.InvoiceWhereInput {
  return buildProjectLinkedScopeWhere<Prisma.InvoiceWhereInput>(context);
}

export function buildExpenseScopeWhere(context: UserContext): Prisma.ExpenseWhereInput {
  return buildProjectLinkedScopeWhere<Prisma.ExpenseWhereInput>(context);
}

export function buildCommitmentScopeWhere(context: UserContext): Prisma.CommitmentWhereInput {
  return buildProjectLinkedScopeWhere<Prisma.CommitmentWhereInput>(context);
}

/**
 * Budgets always belong to a project (PRD #15 §214), so the project gate
 * applies at every scope below COMPANY without the "unlinked" case.
 */
export function buildBudgetScopeWhere(context: UserContext): Prisma.ProjectBudgetWhereInput {
  const base: Prisma.ProjectBudgetWhereInput = { companyId: context.companyId };
  if (hasCompanyFinanceScope(context)) return base;
  return { ...base, project: buildProjectScopeWhere(context) };
}

/**
 * A payment has no scope of its own: it inherits the invoice or expense it
 * settles (PRD #15 §216).
 *
 * `finance.payment.view` alone is deliberately not enough — the parent has to
 * be reachable too, or the payment list becomes a way to read amounts off
 * records the reader may not open.
 */
export function buildPaymentScopeWhere(context: UserContext): Prisma.PaymentWhereInput {
  const base: Prisma.PaymentWhereInput = { companyId: context.companyId };
  if (hasCompanyFinanceScope(context)) return base;

  return {
    AND: [
      base,
      {
        OR: [
          { invoice: { is: buildInvoiceScopeWhere(context) } },
          { expense: { is: buildExpenseScopeWhere(context) } },
        ],
      },
    ],
  };
}

/** Projects a finance form may offer, so it cannot propose an unreachable one. */
export function buildFinanceProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  return {
    AND: [
      buildProjectScopeWhere(context),
      { archivedAt: null, status: { not: "ARCHIVED" } },
    ],
  };
}
