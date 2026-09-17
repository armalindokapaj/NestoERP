import type { CompanyStatus, ParentGroupStatus, Prisma } from "@prisma/client";

import { GROUP_DEPARTMENTS } from "@/config/group-departments";
import { can, getModuleScope } from "@/lib/access/can";
import { assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

/**
 * The organization overview (E-06 §8-§13, §67, §68).
 *
 * A group-wide reader sees every company of their own group and who heads each
 * group department; everybody else sees the company they are working in. The
 * group always comes from the session's own company, never from a request, so
 * nothing here can name another group (E-06 §117).
 */

export type PersonRefDTO = { userId: string; name: string };

export type OrganizationOverviewDTO = {
  parentGroup: { id: string; name: string; status: ParentGroupStatus };
  reach: "GROUP" | "COMPANY";
  companies: Array<{ id: string; name: string; status: CompanyStatus; isCurrent: boolean }>;
  departments: Array<{
    id: string;
    key: string;
    name: string;
    heads: PersonRefDTO[];
    branch: { id: string; name: string; managers: PersonRefDTO[] } | null;
  }> | null;
};

const MODULE = "organization" as const;

function personRef(user: { id: string; firstName: string; lastName: string }): PersonRefDTO {
  return { userId: user.id, name: `${user.firstName} ${user.lastName}` };
}

export async function getOrganizationOverview(context: UserContext): Promise<OrganizationOverviewDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "organization.view");

  const scope = getModuleScope(context, MODULE);
  const groupWide = scope === "GROUP" || scope === "SYSTEM";
  const reach: OrganizationOverviewDTO["reach"] = groupWide ? "GROUP" : "COMPANY";

  const companies = await prisma.company.findMany({
    where: groupWide
      ? { parentGroupId: context.parentGroupId }
      : { id: context.companyId, parentGroupId: context.parentGroupId },
    select: { id: true, name: true, status: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });

  const departments = can(context, "organization.department.view")
    ? await departmentOverview(context)
    : null;

  return {
    parentGroup: { id: context.parentGroup.id, name: context.parentGroup.name, status: context.parentGroup.status },
    reach,
    companies: companies.map((company) => ({ ...company, isCurrent: company.id === context.companyId })),
    departments,
  };
}

async function departmentOverview(context: UserContext): Promise<NonNullable<OrganizationOverviewDTO["departments"]>> {
  const now = new Date();
  const live: Prisma.DepartmentAssignmentWhereInput = {
    status: "ACTIVE",
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
  const userSelect = { select: { id: true, firstName: true, lastName: true } } as const;

  const groupDepartments = await prisma.groupDepartment.findMany({
    where: { parentGroupId: context.parentGroupId, status: "ACTIVE" },
    select: {
      id: true,
      key: true,
      name: true,
      assignments: {
        where: { ...live, positionLevel: "GROUP_HEAD", companyId: null },
        select: { user: userSelect },
        orderBy: { createdAt: "asc" },
      },
      branches: {
        where: { companyId: context.companyId, archivedAt: null, status: { not: "ARCHIVED" } },
        select: { id: true, name: true },
        take: 1,
      },
    },
  });

  const managers = await prisma.departmentAssignment.findMany({
    where: {
      ...live,
      parentGroupId: context.parentGroupId,
      companyId: context.companyId,
      positionLevel: "COMPANY_MANAGER",
    },
    select: { groupDepartmentId: true, user: userSelect },
    orderBy: { createdAt: "asc" },
  });

  // The functions in the order the group's chart lists them, then any the group added.
  const rank = (key: string) => {
    const index = GROUP_DEPARTMENTS.findIndex((department) => department.key === key);
    return index === -1 ? GROUP_DEPARTMENTS.length : index;
  };
  const ordered = groupDepartments
    .slice()
    .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));

  return ordered.map((department) => {
    const branch = department.branches[0] ?? null;
    return {
      id: department.id,
      key: department.key,
      name: department.name,
      heads: department.assignments.map((assignment) => personRef(assignment.user)),
      branch: branch
        ? {
            id: branch.id,
            name: branch.name,
            managers: managers
              .filter((manager) => manager.groupDepartmentId === department.id)
              .map((manager) => personRef(manager.user)),
          }
        : null,
    };
  });
}
