import { cache } from "react";

import { prisma } from "@/lib/database/prisma";

/**
 * Shared reads for Team and Company (PRD #8 §120).
 *
 * Every query is bounded by the company from the resolved context — never by an
 * id supplied by the browser (PRD #8 §128).
 */

export const getCompany = cache(async (companyId: string) => {
  return prisma.company.findUnique({ where: { id: companyId } });
});

export type TeamMember = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  roleKey: string;
  roleName: string;
  department: string | null;
  jobTitle: string | null;
  status: "ACTIVE" | "INVITED" | "INACTIVE" | "SUSPENDED";
  userStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED";
};

const MEMBER_SELECT = {
  id: true,
  jobTitle: true,
  status: true,
  role: { select: { key: true, name: true } },
  department: { select: { name: true } },
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      avatarUrl: true,
      status: true,
    },
  },
} as const;

type MemberRow = {
  id: string;
  jobTitle: string | null;
  status: string;
  role: { key: string; name: string };
  department: { name: string } | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    status: string;
  };
};

function toTeamMember(record: MemberRow): TeamMember {
  return {
    id: record.id,
    userId: record.user.id,
    firstName: record.user.firstName,
    lastName: record.user.lastName,
    fullName: `${record.user.firstName} ${record.user.lastName}`,
    email: record.user.email,
    phone: record.user.phone,
    avatarUrl: record.user.avatarUrl,
    roleKey: record.role.key,
    roleName: record.role.name,
    department: record.department?.name ?? null,
    jobTitle: record.jobTitle,
    status: record.status as TeamMember["status"],
    userStatus: record.user.status as TeamMember["userStatus"],
  };
}

export const getTeamMembers = cache(async (companyId: string): Promise<TeamMember[]> => {
  const records = await prisma.companyMember.findMany({
    where: { companyId },
    select: MEMBER_SELECT,
    orderBy: [{ department: { name: "asc" } }, { user: { firstName: "asc" } }],
  });

  return records.map(toTeamMember);
});

export const getTeamMember = cache(
  async (companyId: string, userId: string): Promise<TeamMember | null> => {
    const record = await prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: MEMBER_SELECT,
    });

    return record ? toTeamMember(record) : null;
  },
);

/** Company-level module activation, for the Company and Settings pages. */
export const getCompanyModules = cache(async (companyId: string) => {
  const records = await prisma.companyModule.findMany({
    where: { companyId },
    include: { module: true },
    orderBy: { module: { name: "asc" } },
  });

  return records.map((record) => ({
    key: record.module.key,
    name: record.module.name,
    description: record.module.description,
    route: record.module.route,
    enabled: record.enabled,
  }));
});

export const getDepartments = cache(async (companyId: string) => {
  return prisma.department.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      key: true,
      status: true,
      _count: { select: { members: true } },
    },
  });
});
