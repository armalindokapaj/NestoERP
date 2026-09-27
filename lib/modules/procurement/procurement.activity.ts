import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import type { ProcurementActivityDTO } from "./procurement.types";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Procurement activity (PRD #19 §173, §174).
 *
 * Read for one record at a time, after the caller has already been shown to
 * reach that record. The trail is never listed module-wide: a company-wide
 * buying history would hand somebody the prices and rejection notes from every
 * order they cannot open.
 *
 * Activity *messages* are written to be safe to read — they name the record and
 * the action, never a supplier's price. The figures live in `metadata`, which
 * this reader does not return (PRD #19 §174).
 */
export async function listRecordActivity(
  context: UserContext,
  entityType: string,
  entityId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "procurement");
  assertPermission(context, "procurement.activity.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "procurement",
    entityType,
    entityId,
  };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "procurement.activity.list",
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
          actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
        },
      });
      return { rows, window };
    },
    LIST_READ,
  );

  const data: ProcurementActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: window };
}

export function canViewProcurementActivity(context: UserContext): boolean {
  return can(context, "procurement.activity.view");
}
