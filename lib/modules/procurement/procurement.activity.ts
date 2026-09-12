import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import type { ProcurementActivityDTO } from "./procurement.types";

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

  const data: ProcurementActivityDTO[] = rows.map((row) => ({
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

export function canViewProcurementActivity(context: UserContext): boolean {
  return can(context, "procurement.activity.view");
}
