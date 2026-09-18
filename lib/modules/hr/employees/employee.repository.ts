import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { skipFor } from "@/lib/modules/shared/list-query";
import { accountStatusWhere } from "../hr.person";
import { buildEmployeeScopeWhere, buildHrMemberScopeWhere } from "../hr.scope";
import type { EmployeeListQuery, EmployeeSortKey } from "../hr.schema";

/** Employee queries (PRD #16 §39–§44, §208, §211; E-04 §18-§20, §238-§244). */

const NAME: Prisma.EmployeeProfileOrderByWithRelationInput[] = [
  { personProfile: { firstName: "asc" } },
  { personProfile: { lastName: "asc" } },
];

const ORDER: Record<EmployeeSortKey, Prisma.EmployeeProfileOrderByWithRelationInput[]> = {
  "name-asc": NAME,
  "name-desc": [{ personProfile: { firstName: "desc" } }, { personProfile: { lastName: "desc" } }],
  "start-desc": [{ startDate: { sort: "desc", nulls: "last" } }, ...NAME],
  "start-asc": [{ startDate: { sort: "asc", nulls: "last" } }, ...NAME],
  "status-asc": [{ employmentStatus: "asc" }, ...NAME],
  "department-asc": [{ department: { name: "asc" } }, ...NAME],
};

/**
 * An employee is named by their person and placed by their employment; the
 * login is read only for the account's own facts — its role, its status, the
 * email it signs in with (E-04 §7, §17).
 */
export const SUMMARY_SELECT = {
  id: true,
  companyMemberId: true,
  personProfileId: true,
  employeeNumber: true,
  employmentStatus: true,
  employmentType: true,
  workerCategory: true,
  startDate: true,
  endDate: true,
  updatedAt: true,
  // Where the employment says they sit (E-03 §6); the membership's are the fallback for a record older than its history.
  jobTitle: true,
  department: { select: { id: true, name: true } },
  trade: { select: { id: true, name: true } },
  personProfile: { select: { firstName: true, lastName: true, workEmail: true, workPhone: true } },
  companyMember: {
    select: {
      id: true,
      jobTitle: true,
      status: true,
      user: { select: { email: true, avatarUrl: true, status: true } },
      department: { select: { id: true, name: true } },
    },
  },
  managerMember: {
    select: { id: true, user: { select: { firstName: true, lastName: true } }, employeeProfile: { select: { id: true } } },
  },
} satisfies Prisma.EmployeeProfileSelect;

export type EmployeeRow = Prisma.EmployeeProfileGetPayload<{ select: typeof SUMMARY_SELECT }>;

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
      user: { select: { email: true, phone: true, avatarUrl: true, status: true } },
      department: { select: { id: true, name: true } },
      role: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.EmployeeProfileSelect;

export type EmployeeDetailRow = Prisma.EmployeeProfileGetPayload<{ select: typeof DETAIL_SELECT }>;

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
        { personProfile: { firstName: { contains: term, mode: "insensitive" } } },
        { personProfile: { lastName: { contains: term, mode: "insensitive" } } },
        { personProfile: { workEmail: { contains: term, mode: "insensitive" } } },
        { trade: { name: { contains: term, mode: "insensitive" } } },
        { companyMember: { jobTitle: { contains: term, mode: "insensitive" } } },
        { companyMember: { user: { email: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  if (query.status?.length) filters.push({ employmentStatus: { in: query.status } });
  if (query.employmentType?.length) filters.push({ employmentType: { in: query.employmentType } });
  if (query.departmentId) filters.push({ departmentId: query.departmentId });
  if (query.managerMemberId) filters.push({ managerMemberId: query.managerMemberId });
  if (query.accountStatus?.length) filters.push({ OR: query.accountStatus.map(accountStatusWhere) });
  if (query.workerCategory?.length) filters.push({ workerCategory: { in: query.workerCategory } });
  if (query.tradeId) filters.push({ tradeId: query.tradeId });

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

  return { rows, total };
}

/** By employment id, which is how every HR route addresses an employee (E-04 §7, §14). */
export async function findEmployee(
  context: UserContext,
  employmentId: string,
): Promise<EmployeeDetailRow | null> {
  return prisma.employeeProfile.findFirst({
    where: { AND: [buildEmployeeScopeWhere(context), { id: employmentId }] },
    select: DETAIL_SELECT,
  });
}

/**
 * The employment a login holds in this company, within the reader's scope —
 * for links still written with a membership id, and for somebody's own record.
 */
export async function findEmploymentIdForMember(
  context: UserContext,
  memberId: string,
): Promise<string | null> {
  const row = await prisma.employeeProfile.findFirst({
    where: { AND: [buildEmployeeScopeWhere(context), { companyMemberId: memberId }] },
    select: { id: true },
  });
  return row?.id ?? null;
}

/** Filter options drawn from the employees this reader can already see. */
export async function employeeFilterOptions(context: UserContext) {
  const scope = buildEmployeeScopeWhere(context);

  const [departments, managers, trades] = await Promise.all([
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
    // Trades somebody in view holds, retired ones included (E-04 §11).
    prisma.workforceTrade.findMany({
      where: { companyId: context.companyId, employees: { some: scope } },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return {
    departments,
    trades,
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

/** This company's open departments, for an employee without a membership to sit in (E-04 §27). */
export function departmentOptions(context: UserContext) {
  return prisma.department.findMany({
    where: { companyId: context.companyId, status: "ACTIVE", OR: [{ groupDepartmentId: null }, { groupDepartment: { status: "ACTIVE" } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** This company's trades in use, and any already on the record being edited (E-04 §11). */
export function tradeOptions(context: UserContext, keepId?: string | null) {
  return prisma.workforceTrade.findMany({
    where: { companyId: context.companyId, OR: [{ isActive: true }, ...(keepId ? [{ id: keepId }] : [])] },
    select: { id: true, name: true, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * People of the group with no employment in this company — a former employee
 * of another company, a hired candidate — so a new employment names the person
 * already on record instead of making a second one (E-04 §5, §89).
 */
export async function personOptions(context: UserContext) {
  const people = await prisma.personProfile.findMany({
    where: { parentGroupId: context.parentGroupId, employments: { none: { companyId: context.companyId } } },
    select: { id: true, firstName: true, lastName: true, employments: { select: { company: { select: { name: true } } }, take: 3 } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: 500,
  });
  return people.map((person) => ({
    id: person.id,
    name: `${person.firstName} ${person.lastName}`,
    companies: [...new Set(person.employments.map((employment) => employment.company.name))],
  }));
}
