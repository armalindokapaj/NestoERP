import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { paginationMeta, skipFor } from "@/lib/modules/shared/list-query";
import { buildEmployeeScopeWhere } from "./hr.scope";
import type { HrActivityDTO } from "./hr.types";

/** The entity type compensation writes its activity under. */
const COMPENSATION_ENTITY = "Compensation";

/**
 * HR activity (PRD #16 §136–§138).
 *
 * Read one employee at a time, after the caller has already been shown to reach
 * that employee. There is no module-wide HR feed: a company-wide list of "whose
 * pay changed" is exactly the leak the compensation permission exists to
 * prevent (PRD #16 §137).
 *
 * HR activity is also distinct from Team activity: a role change is Team's
 * event, an employment status change is HR's, and neither appears in the
 * other's trail (PRD #16 §138).
 */
export async function listEmployeeActivity(
  context: UserContext,
  employmentId: string,
  options: { page?: number; limit?: number } = {},
) {
  assertModule(context, "hr");
  assertPermission(context, "hr.activity.view");

  // The permission says the reader may read HR history; the scope says whose.
  // Without this an employee with SELF scope could name any employment id and
  // read that person's employment and pay events (PRD #16 §137, §202).
  const employment = assertFound(
    await prisma.employeeProfile.findFirst({
      where: { AND: [buildEmployeeScopeWhere(context), { id: employmentId }] },
      select: { id: true, companyMemberId: true },
    }),
  );

  const page = options.page ?? 1;
  const limit = options.limit ?? 25;

  const where: Prisma.ActivityWhereInput = {
    companyId: context.companyId,
    module: "hr",
    // The employment's own events, and the leave, attendance and pay events that
    // name it — or, from before employments were the address, its login (E-04 §7).
    OR: [
      { entityType: "EmployeeProfile", entityId: employment.id },
      { metadata: { path: ["employmentId"], equals: employment.id } },
      ...(employment.companyMemberId ? [{ metadata: { path: ["memberId"], equals: employment.companyMemberId } }] : []),
    ],
    // Pay events carry no figure, but "whose pay changed, and when" is still
    // compensation information. `hr.activity.view` does not imply
    // `hr.compensation.view` — an Admin or CEO can hold the first without the
    // second — so those events are left out of the trail unless the reader may
    // see compensation itself (PRD #16 §137, PRD #47 §98).
    ...(can(context, "hr.compensation.view")
      ? {}
      : { NOT: [{ entityType: COMPENSATION_ENTITY }, { action: { startsWith: "HR_COMPENSATION" } }] }),
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
        actorMemberId: true,
        actorMember: { select: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.activity.count({ where }),
  ]);

  const data: HrActivityDTO[] = rows.map((row) => ({
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

export function canViewHrActivity(context: UserContext): boolean {
  return can(context, "hr.activity.view");
}
