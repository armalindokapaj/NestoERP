import { assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import type { DepartmentSummaryDTO } from "../team.types";

/**
 * A company's departments, as Team reads them (PRD #14 §112-§129; E-13 §39).
 *
 * Since E-13 a company's department is a branch of one of its group's
 * departments, made by activating that department in the company from
 * Organization — never created, edited or archived here, so there is one door
 * to it and one history (E-13 §39, §51; ADR 0003). The branch rows stay Team's;
 * the organization writes them through `branch.doors.ts`.
 */

const MODULE = "team" as const;

export async function listDepartments(
  context: UserContext,
  options: { includeInactive?: boolean } = {},
): Promise<DepartmentSummaryDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.view");

  const rows = await prisma.department.findMany({
    where: {
      companyId: context.companyId,
      ...(options.includeInactive ? {} : { status: "ACTIVE", archivedAt: null }),
    },
    select: {
      id: true,
      name: true,
      key: true,
      description: true,
      status: true,
      updatedAt: true,
      groupDepartmentId: true,
      groupDepartment: { select: { code: true } },
      managerMember: {
        select: {
          id: true,
          status: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
      // Counted in the query rather than per row (PRD #14 §235).
      _count: { select: { members: { where: { status: "ACTIVE" } } } },
    },
    orderBy: { name: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    key: row.key,
    code: row.groupDepartment?.code ?? null,
    groupDepartmentId: row.groupDepartmentId,
    description: row.description,
    manager: row.managerMember
      ? {
          memberId: row.managerMember.id,
          fullName: `${row.managerMember.user.firstName} ${row.managerMember.user.lastName}`,
          // Surfaced rather than hidden, so a departed manager is visible
          // (PRD #14 §248).
          active: row.managerMember.status === "ACTIVE",
        }
      : null,
    activeMembers: row._count.members,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getDepartment(context: UserContext, departmentId: string) {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.view");

  return assertFound(
    await prisma.department.findFirst({
      where: { id: departmentId, companyId: context.companyId },
      select: {
        id: true,
        name: true,
        key: true,
        description: true,
        status: true,
        groupDepartmentId: true,
        updatedAt: true,
        managerMemberId: true,
        managerMember: {
          select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
        },
        _count: { select: { members: { where: { status: "ACTIVE" } } } },
      },
    }),
  );
}
