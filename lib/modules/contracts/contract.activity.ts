import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { pageWindow, skipFor, withTieBreaker } from "@/lib/modules/shared/list-query";
import type { ContractActivityDTO } from "./contract.types";

/** A list read: its count and its page from one read-only snapshot (AUD-08 §4, DT-06). */
const LIST_READ = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, attempts: 1 } as const;

/**
 * Legal activity (PRD #18 §209, §210).
 *
 * Read for one record at a time, after the caller has already been shown to
 * reach that record. The trail is never listed module-wide: a company-wide
 * legal history would hand somebody the termination reasons and approval notes
 * from every agreement they cannot open (PRD #18 §210).
 *
 * Activity *messages* are written to be safe to read — they name the record and
 * the action, never the value, the legal note or the termination reason. The
 * confidential facts live in `metadata`, which this reader does not return
 * (PRD #18 §210, §467).
 */
export async function listRecordActivity(
  context: UserContext,
  entityType: string,
  entityId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "contracts");
  assertPermission(context, "legal.activity.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "contracts",
    entityType,
    entityId,
  };

  // Count and page from one snapshot; a page past the end reads the last one (AUD-08 §4, DT-05, DT-06).
  const { rows, window } = await runInTransaction(
    "contracts.activity.list",
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

  const data: ContractActivityDTO[] = rows.map((row) => ({
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

export function canViewContractActivity(context: UserContext): boolean {
  return can(context, "legal.activity.view");
}
