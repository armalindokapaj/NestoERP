import { cache } from "react";

import type { RoleKey } from "@/config/roles";
import { prisma } from "@/lib/database/prisma";

/** Company profile for the Company module (spec §45). */
export const getCompany = cache(async (companyId: string) => {
  return prisma.company.findUnique({ where: { id: companyId } });
});

export type TeamMember = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  role: RoleKey;
  department: string | null;
  jobTitle: string | null;
  status: "ACTIVE" | "INACTIVE";
  userStatus: "ACTIVE" | "INVITED" | "SUSPENDED";
};

function toTeamMember(record: {
  id: string;
  role: string;
  department: string | null;
  jobTitle: string | null;
  status: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    avatar: string | null;
    status: string;
  };
}): TeamMember {
  return {
    id: record.id,
    userId: record.user.id,
    firstName: record.user.firstName,
    lastName: record.user.lastName,
    email: record.user.email,
    phone: record.user.phone,
    avatar: record.user.avatar,
    role: record.role as RoleKey,
    department: record.department,
    jobTitle: record.jobTitle,
    status: record.status as TeamMember["status"],
    userStatus: record.user.status as TeamMember["userStatus"],
  };
}

/** Everyone in the company workspace (spec §44). */
export const getTeamMembers = cache(async (companyId: string): Promise<TeamMember[]> => {
  const records = await prisma.companyMember.findMany({
    where: { companyId },
    include: { user: true },
    orderBy: [{ department: "asc" }, { user: { firstName: "asc" } }],
  });

  return records.map(toTeamMember);
});

export const getTeamMember = cache(
  async (companyId: string, userId: string): Promise<TeamMember | null> => {
    const record = await prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      include: { user: true },
    });

    return record ? toTeamMember(record) : null;
  },
);

/** Company module activation (spec §48). */
export const getCompanyModules = cache(async (companyId: string) => {
  const records = await prisma.companyModule.findMany({
    where: { companyId },
    include: { module: true },
    orderBy: { module: { name: "asc" } },
  });

  return records.map((record) => ({
    key: record.module.key,
    name: record.module.name,
    status: record.module.status,
    enabled: record.enabled,
  }));
});
