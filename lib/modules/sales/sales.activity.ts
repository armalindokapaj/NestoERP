import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { boundedLimit, boundedPage } from "./sales.query";
import type { SalesActivityDTO } from "./sales.types";

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

  const data: SalesActivityDTO[] = rows.map((row) => ({
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

export function canViewSalesActivity(context: UserContext): boolean {
  return can(context, "sales.activity.view");
}
