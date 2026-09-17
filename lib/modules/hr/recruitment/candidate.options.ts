import { isMembershipRoleKey, roleLabel } from "@/config/roles";
import { assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { RECRUITABLE_ROLE_KEYS } from "./candidate.schema";
import { recruitsAcrossGroup } from "./candidate.service";

/**
 * What a recruitment form may choose from (E-06 §23, §28): the companies the
 * reader recruits into, their active department branches, the people who can
 * be a hiring manager there, and the roles people are hired into. The service
 * checks every choice again; this only keeps the form honest.
 */
export type RecruitmentOptionsDTO = {
  companies: Array<{ id: string; label: string }>;
  departments: Array<{ id: string; label: string; companyId: string }>;
  managers: Array<{ id: string; label: string; companyId: string }>;
  roles: Array<{ id: string; label: string }>;
};

export async function recruitmentFormOptions(context: UserContext): Promise<RecruitmentOptionsDTO> {
  assertPermission(context, "candidate.manage");
  const companies = await prisma.company.findMany({
    where: recruitsAcrossGroup(context)
      ? { parentGroupId: context.parentGroupId, status: "ACTIVE" }
      : { id: context.companyId, parentGroupId: context.parentGroupId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const companyIds = companies.map((company) => company.id);
  const companyName = new Map(companies.map((company) => [company.id, company.name]));

  const [departments, members] = await Promise.all([
    prisma.department.findMany({
      where: { companyId: { in: companyIds }, status: "ACTIVE", groupDepartmentId: { not: null } },
      select: { id: true, name: true, companyId: true },
      orderBy: [{ companyId: "asc" }, { name: "asc" }],
    }),
    prisma.companyMember.findMany({
      where: { companyId: { in: companyIds }, status: "ACTIVE", user: { status: "ACTIVE" } },
      select: { companyId: true, user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ companyId: "asc" }, { user: { lastName: "asc" } }],
    }),
  ]);

  const several = companies.length > 1;
  const within = (companyId: string, label: string) => (several ? `${companyName.get(companyId)} · ${label}` : label);
  return {
    companies: companies.map((company) => ({ id: company.id, label: company.name })),
    departments: departments.map((row) => ({ id: row.id, label: within(row.companyId, row.name), companyId: row.companyId })),
    managers: members.map((row) => ({ id: row.user.id, label: within(row.companyId, `${row.user.firstName} ${row.user.lastName}`), companyId: row.companyId })),
    roles: RECRUITABLE_ROLE_KEYS.filter(isMembershipRoleKey).map((key) => ({ id: key, label: roleLabel(key) })),
  };
}
