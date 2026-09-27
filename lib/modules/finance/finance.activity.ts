import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor } from "@/lib/modules/shared/list-query";
import {
  buildBudgetScopeWhere,
  buildCommitmentScopeWhere,
  buildExpenseScopeWhere,
  buildInvoiceScopeWhere,
} from "./finance.scope";
import type { FinanceActivityDTO } from "./finance.types";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Whether the caller may open the record whose history they asked for.
 *
 * `finance.activity.view` says a person may read finance histories; it does
 * not say which. The trail of an invoice carries its amounts and its client,
 * so it is shown only to somebody who could open that invoice — the record's
 * own view permission and the same scope clause its detail read uses
 * (PRD #47 §44, §65). A record they cannot reach answers "not found".
 */
async function assertRecordReachable(
  context: UserContext,
  entityType: string,
  entityId: string,
): Promise<void> {
  let found: { id: string } | null;
  switch (entityType) {
    case "Invoice":
      assertPermission(context, "finance.invoice.view");
      found = await prisma.invoice.findFirst({
        where: { AND: [buildInvoiceScopeWhere(context), { id: entityId }] },
        select: { id: true },
      });
      break;
    case "Expense":
      assertPermission(context, "finance.expense.view");
      found = await prisma.expense.findFirst({
        where: { AND: [buildExpenseScopeWhere(context), { id: entityId }] },
        select: { id: true },
      });
      break;
    case "ProjectBudget":
      assertPermission(context, "finance.budget.view");
      found = await prisma.projectBudget.findFirst({
        where: { AND: [buildBudgetScopeWhere(context), { id: entityId }] },
        select: { id: true },
      });
      break;
    case "Commitment":
      assertPermission(context, "finance.commitment.view");
      found = await prisma.commitment.findFirst({
        where: { AND: [buildCommitmentScopeWhere(context), { id: entityId }] },
        select: { id: true },
      });
      break;
    default:
      found = null;
  }
  assertFound(found);
}

/**
 * Finance activity (PRD #15 §193, §194).
 *
 * Read for one record at a time, and only for a record the caller can open —
 * checked here, not left to the page that called (PRD #47 §65). The trail is
 * never listed module-wide: a company-wide finance history would hand somebody
 * the amounts from every record they cannot open (PRD #15 §194).
 */
export async function listRecordActivity(
  context: UserContext,
  entityType: string,
  entityId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "finance");
  assertPermission(context, "finance.activity.view");
  await assertRecordReachable(context, entityType, entityId);

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "finance",
    entityType,
    entityId,
  };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "finance.activity.list",
    async (tx) => {
      const window = pageWindow(await tx.activity.count({ where }), page, limit);
      const rows = await tx.activity.findMany({
        where,
        // Newest first; the id breaks a same-instant tie so pages never overlap (AUD-08 §4, DT-04).
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: skipFor(window.page, window.limit),
        take: window.limit,
        select: {
          id: true,
          action: true,
          message: true,
          createdAt: true,
          actorMemberId: true,
          actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const data: FinanceActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    actorMemberId: row.actorMemberId,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: window };
}

export function canViewFinanceActivity(context: UserContext): boolean {
  return can(context, "finance.activity.view");
}
