import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { skipFor } from "@/lib/modules/shared/list-query";
import { memberAddressed, type MemberAddressed } from "../hr.person";
import { buildEmployeeScopeWhere, buildHrMemberScopeWhere } from "../hr.scope";
import type { EmployeeListQuery, EmployeeSortKey } from "../hr.schema";

/** Employee queries (PRD #16 §39–§44, §208, §211). */

const ORDER: Record<EmployeeSortKey, Prisma.EmployeeProfileOrderByWithRelationInput[]> = {
  "name-asc": [{ companyMember: { user: { firstName: "asc" } } }],
  "name-desc": [{ companyMember: { user: { firstName: "desc" } } }],
  "start-desc": [{ startDate: { sort: "desc", nulls: "last" } }],
  "start-asc": [{ startDate: { sort: "asc", nulls: "last" } }],
  "status-asc": [{ employmentStatus: "asc" }, { companyMember: { user: { firstName: "asc" } } }],
  "department-asc": [
    { department: { name: "asc" } },
    { companyMember: { user: { firstName: "asc" } } },
  ],
};

export const SUMMARY_SELECT = {
  id: true,
  companyMemberId: true,
  employeeNumber: true,
  employmentStatus: true,
  employmentType: true,
  startDate: true,
  endDate: true,
  updatedAt: true,
  // Where the employment says they sit (E-03 §6); the membership's are the fallback for a record older than its history.
  jobTitle: true,
  department: { select: { id: true, name: true } },
  companyMember: {
    select: {
      id: true,
      jobTitle: true,
      user: { select: { firstName: true, lastName: true, email: true, avatarUrl: true } },
      department: { select: { id: true, name: true } },
    },
  },
  managerMember: {
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.EmployeeProfileSelect;

export type EmployeeRow = MemberAddressed<
  Prisma.EmployeeProfileGetPayload<{ select: typeof SUMMARY_SELECT }>
>;

export const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  probationEndDate: true,
  workLocationType: true,
  workLocation: true,
  weeklyHours: true,
  onboardingStatus: true,
  offboardingStatus: true,
  createdAt: true,
  companyMember: {
    select: {
      id: true,
      jobTitle: true,
      status: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          avatarUrl: true,
        },
      },
      department: { select: { id: true, name: true } },
      role: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.EmployeeProfileSelect;

export type EmployeeDetailRow = MemberAddressed<
  Prisma.EmployeeProfileGetPayload<{ select: typeof DETAIL_SELECT }>
>;

export function buildEmployeeListWhere(
  context: UserContext,
  query: EmployeeListQuery,
): Prisma.EmployeeProfileWhereInput {
  const filters: Prisma.EmployeeProfileWhereInput[] = [buildEmployeeScopeWhere(context)];

  if (query.search) {
    const term = query.search.trim();
    // Searching a name is fine: the scope clause above already decided which
    // employment records are reachable (PRD #16 §206).
    filters.push({
      OR: [
        { employeeNumber: { contains: term, mode: "insensitive" } },
        { workLocation: { contains: term, mode: "insensitive" } },
        { jobTitle: { contains: term, mode: "insensitive" } },
        { companyMember: { jobTitle: { contains: term, mode: "insensitive" } } },
        { companyMember: { user: { firstName: { contains: term, mode: "insensitive" } } } },
        { companyMember: { user: { lastName: { contains: term, mode: "insensitive" } } } },
        { companyMember: { user: { email: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.status?.length) filters.push({ employmentStatus: { in: query.status } });
  if (query.employmentType?.length) filters.push({ employmentType: { in: query.employmentType } });
  if (query.departmentId) {
    filters.push({ departmentId: query.departmentId });
  }
  if (query.managerMemberId) filters.push({ managerMemberId: query.managerMemberId });

  return { AND: filters };
}

export async function listEmployees(context: UserContext, query: EmployeeListQuery) {
  const where = buildEmployeeListWhere(context, query);

  const [rows, total] = await Promise.all([
    prisma.employeeProfile.findMany({
      where,
      orderBy: ORDER[query.sort],
      skip: skipFor(query.page, query.limit),
      take: query.limit,
      select: SUMMARY_SELECT,
    }),
    prisma.employeeProfile.count({ where }),
  ]);

  return { rows: rows.map(memberAddressed), total };
}

/** By membership id, which is how every HR route addresses a person. */
export async function findEmployeeByMember(
  context: UserContext,
  memberId: string,
): Promise<EmployeeDetailRow | null> {
  const row = await prisma.employeeProfile.findFirst({
    where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: memberId }] },
    select: DETAIL_SELECT,
  });
  return row && memberAddressed(row);
}

export async function findEmployeeById(
  context: UserContext,
  profileId: string,
): Promise<EmployeeDetailRow | null> {
  const row = await prisma.employeeProfile.findFirst({
    where: { AND: [buildEmployeeScopeWhere(context), { id: profileId }] },
    select: DETAIL_SELECT,
  });
  return row && memberAddressed(row);
}

/** Filter options drawn from the employees this reader can already see. */
export async function employeeFilterOptions(context: UserContext) {
  const scope = buildEmployeeScopeWhere(context);

  const [departments, managers] = await Promise.all([
    prisma.department.findMany({
      where: {
        companyId: context.companyId,
        employeeProfiles: { some: scope },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.companyMember.findMany({
      where: {
        companyId: context.companyId,
        managedEmployeeProfiles: { some: scope },
      },
      select: { id: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { user: { firstName: "asc" } },
    }),
  ]);

  return {
    departments,
    managers: managers.map((manager) => ({
      id: manager.id,
      name: `${manager.user.firstName} ${manager.user.lastName}`,
    })),
  };
}

/**
 * Members who could be given an employment record (PRD #16 §225).
 *
 * Active memberships without a profile yet, so the create form cannot offer
 * somebody who already has one — the unique constraint would refuse it.
 */
export function membersWithoutProfile(context: UserContext) {
  return prisma.companyMember.findMany({
    where: {
      AND: [
        buildHrMemberScopeWhere(context),
        { status: { in: ["ACTIVE", "INVITED"] }, employeeProfile: { is: null } },
      ],
    },
    select: {
      id: true,
      jobTitle: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { user: { firstName: "asc" } },
  });
}

/** Active members who could manage somebody (PRD #16 §250). */
export function managerOptions(context: UserContext) {
  return prisma.companyMember.findMany({
    where: { companyId: context.companyId, status: "ACTIVE" },
    select: {
      id: true,
      user: { select: { firstName: true, lastName: true } },
      role: { select: { name: true } },
    },
    orderBy: { user: { firstName: "asc" } },
  });
}
