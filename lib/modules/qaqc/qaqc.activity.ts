import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { SNAPSHOT } from "./qaqc.list";
import type { QaqcActivityDTO } from "./qaqc.types";

/**
 * QA/QC activity (PRD #21 §186, §187).
 *
 * Read for one record at a time, after the caller has been shown to reach it.
 * The messages name the record and the action and nothing else: a root cause, a
 * rejection reason and a closure note live on the record itself, where the
 * permissions that guard them apply (PRD #21 §187).
 */
export async function listRecordActivity(
  context: UserContext,
  entityType: string,
  entityId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "qaqc");
  assertPermission(context, "qaqc.activity.view");

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "qaqc",
    entityType,
    entityId,
  };

  // Newest first, the id breaking ties within one instant; the page and its
  // total from one snapshot (AUD-08 §4, DT-04, DT-06).
  const [rows, total] = await prisma.$transaction([
    prisma.activity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: skipFor(page, limit),
      take: limit,
      select: {
        id: true,
        action: true,
        message: true,
        createdAt: true,
        actorMemberId: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ], SNAPSHOT);

  const data: QaqcActivityDTO[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    message: row.message,
    actor: row.actorMember
      ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`
      : null,
    actorMemberId: row.actorMember ? row.actorMemberId : null,
    createdAt: row.createdAt.toISOString(),
  }));

  return { data, pagination: paginationMeta(total, page, limit) };
}

export function canViewQaqcActivity(context: UserContext): boolean {
  return can(context, "qaqc.activity.view");
}
