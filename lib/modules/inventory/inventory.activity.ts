import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import type { InventoryActivityDTO } from "./inventory.types";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Inventory activity (PRD #20 §199, §200).
 *
 * Read for one record at a time, after the caller has been shown to reach it.
 * The stock ledger is the real audit trail here — every movement says who
 * posted it and why — so this feed carries the document-level events around it
 * rather than duplicating the ledger.
 */
export async function listRecordActivity(
  context: UserContext,
  entityType: string,
  entityId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "inventory");
  assertPermission(context, "inventory.activity.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "inventory",
    entityType,
    entityId,
  };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "inventory.activity.list",
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

  const data: InventoryActivityDTO[] = rows.map((row) => ({
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

export function canViewInventoryActivity(context: UserContext): boolean {
  return can(context, "inventory.activity.view");
}
