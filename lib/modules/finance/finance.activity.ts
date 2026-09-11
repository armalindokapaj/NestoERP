import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import type { FinanceActivityDTO } from "./finance.types";

/**
 * Finance activity (PRD #15 §193, §194).
 *
 * Read for one record at a time, after the caller has already been shown to
 * reach that record. The trail is never listed module-wide: a company-wide
 * finance history would hand somebody the amounts from every record they cannot
 * open (PRD #15 §194).
 */
export async function listRecordActivity(
  context: UserContext,
  entityType: string,
  entityId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "finance");
  assertPermission(context, "finance.activity.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "finance",
    entityType,
    entityId,
  };

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: skipFor(page, limit),
      take: limit,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  const data: FinanceActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: paginationMeta(total, page, limit) };
}

export function canViewFinanceActivity(context: UserContext): boolean {
  return can(context, "finance.activity.view");
}
