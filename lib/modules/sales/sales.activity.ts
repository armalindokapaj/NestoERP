import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import { boundedLimit, boundedPage } from "./sales.query";
import type { SalesActivityDTO } from "./sales.types";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Sales activity (PRD #17 §147, §148, §410).
 *
 * Read for one record at a time, after the caller has already been shown to
 * reach that record. The trail is never listed module-wide: a company-wide
 * commercial history would hand somebody the values and lost reasons from every
 * deal they cannot open (PRD #17 §148, §416).
 */
export async function listRecordActivity(
  context: UserContext,
  entityType: string,
  entityId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "sales");
  assertPermission(context, "sales.activity.view");

  const page = boundedPage(options.page);
  const limit = boundedLimit(options.limit);

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "sales",
    entityType,
    entityId,
  };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "sales.activity.list",
    async (tx) => {
      const window = pageWindow(await tx.activity.count({ where }), page, limit);
      const rows = await tx.activity.findMany({
        where,
        orderBy: withTieBreaker({ createdAt: "desc" }),
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

  const data: SalesActivityDTO[] = rows.map((row) => ({
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

export function canViewSalesActivity(context: UserContext): boolean {
  return can(context, "sales.activity.view");
}
