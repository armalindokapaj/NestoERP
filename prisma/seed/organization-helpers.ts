/**
 * The building blocks of a seeded organization, shared by the demo group and
 * the test fixture group (E-06 §8-§13, §22-§26).
 *
 * Every step is an upsert on a deterministic id, so running the seed again
 * converges instead of duplicating.
 */
import type { MembershipStatus, ParentGroupStatus, PrismaClient, UserStatus } from "@prisma/client";

import { GROUP_DEPARTMENTS, groupDepartmentId, groupDepartmentRows, type GroupDepartmentKey } from "../../config/group-departments";
import type { ModuleKey } from "../../config/modules";
import type { RoleKey } from "../../config/roles";
import { defaultUnitTypeRows } from "../../config/unit-types";

export async function upsertParentGroup(
  prisma: PrismaClient,
  group: { id: string; slug: string; name: string; legalName?: string | null; country?: string | null; timezone?: string | null; currency?: string | null; status: ParentGroupStatus; isTestFixture?: boolean; activatedAt?: Date | null },
) {
  const data = {
    slug: group.slug,
    name: group.name,
    legalName: group.legalName ?? null,
    country: group.country ?? null,
    timezone: group.timezone ?? null,
    currency: group.currency ?? null,
    status: group.status,
    isTestFixture: group.isTestFixture ?? false,
    activatedAt: group.activatedAt ?? null,
  };
  await prisma.parentGroup.upsert({ where: { id: group.id }, update: data, create: { id: group.id, ...data } });
  await prisma.groupDepartment.createMany({ data: groupDepartmentRows(group.id), skipDuplicates: true });
}

export async function upsertCompany(
  prisma: PrismaClient,
  company: { id: string; parentGroupId: string; slug: string; name: string; legalName?: string | null; registrationNumber?: string | null; taxNumber?: string | null; industry?: string | null; country?: string | null; address?: string | null; email?: string | null; phone?: string | null; website?: string | null; status: "ACTIVE" | "SUSPENDED" },
) {
  const { id, ...rest } = company;
  const data = {
    ...rest,
    legalName: rest.legalName ?? null,
    registrationNumber: rest.registrationNumber ?? null,
    taxNumber: rest.taxNumber ?? null,
    industry: rest.industry ?? null,
    country: rest.country ?? null,
    address: rest.address ?? null,
    email: rest.email ?? null,
    phone: rest.phone ?? null,
    website: rest.website ?? null,
  };
  const row = await prisma.company.upsert({ where: { id }, update: data, create: { id, ...data } });
  // Every company starts with the default unit types, as company bootstrap gives a real one;
  // without them none of its projects can have units (E-05B §20, §21). Never over a company's own list.
  if ((await prisma.projectUnitType.count({ where: { companyId: id } })) === 0) {
    await prisma.projectUnitType.createMany({ data: defaultUnitTypeRows(id), skipDuplicates: true });
  }
  return row;
}

export async function seedCompanyModules(prisma: PrismaClient, companyId: string, disabled: readonly ModuleKey[] = []) {
  const moduleRows = await prisma.module.findMany({ select: { id: true, key: true } });
  const off = new Set<string>(disabled);
  for (const row of moduleRows) {
    const enabled = !off.has(row.key);
    await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId, moduleId: row.id } },
      update: { enabled },
      create: { companyId, moduleId: row.id, enabled },
    });
  }
}

/** A company's branch of every group department, linked to it (E-06 §12, §47). */
export async function seedDepartmentBranches(prisma: PrismaClient, companyId: string, parentGroupId: string): Promise<Map<GroupDepartmentKey, string>> {
  const result = new Map<GroupDepartmentKey, string>();
  for (const department of GROUP_DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { companyId_key: { companyId, key: department.key } },
      update: { name: department.name, groupDepartmentId: groupDepartmentId(parentGroupId, department.key) },
      create: { companyId, key: department.key, name: department.name, groupDepartmentId: groupDepartmentId(parentGroupId, department.key) },
      select: { id: true },
    });
    result.set(department.key, row.id);
  }
  return result;
}

export type SeedAccount = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  jobTitle?: string | null;
};

/**
 * The account and the person behind it (E-06 §22, §26): one person per group,
 * created with the login rather than after it, and linked both ways. A
 * Platform Admin belongs to no group and has no person record.
 */
export async function upsertAccount(
  prisma: PrismaClient,
  account: SeedAccount,
  options: { passwordHash: string; status?: UserStatus; parentGroupId: string | null; lifecycle?: "EMPLOYEE" | "FORMER_EMPLOYEE" },
) {
  const personId = options.parentGroupId ? `person_${account.id.replace(/^user_/, "")}` : null;
  if (personId && options.parentGroupId) {
    const person = {
      parentGroupId: options.parentGroupId,
      firstName: account.firstName,
      lastName: account.lastName,
      jobTitle: account.jobTitle ?? null,
      workEmail: account.email,
      workPhone: account.phone ?? null,
      lifecycleStatus: options.lifecycle ?? ("EMPLOYEE" as const),
    };
    await prisma.personProfile.upsert({ where: { id: personId }, update: person, create: { id: personId, ...person } });
  }

  const user = {
    firstName: account.firstName,
    lastName: account.lastName,
    username: account.username,
    email: account.email,
    phone: account.phone ?? null,
    passwordHash: options.passwordHash,
    status: options.status ?? ("ACTIVE" as const),
    personProfileId: personId,
  };
  await prisma.user.upsert({ where: { id: account.id }, update: user, create: { id: account.id, ...user } });
  return personId;
}

export async function upsertMembership(
  prisma: PrismaClient,
  membership: {
    id: string;
    companyId: string;
    userId: string;
    role: RoleKey;
    roleId: Map<string, string>;
    departmentId: string | null;
    jobTitle: string | null;
    status?: MembershipStatus;
    createdAt?: Date;
  },
) {
  const roleId = membership.roleId.get(membership.role);
  if (!roleId) throw new Error(`Seed: role ${membership.role} is not configured. Run access sync first.`);
  const data = { roleId, departmentId: membership.departmentId, jobTitle: membership.jobTitle, status: membership.status ?? ("ACTIVE" as const) };
  return prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: membership.companyId, userId: membership.userId } },
    update: data,
    create: {
      id: membership.id,
      companyId: membership.companyId,
      userId: membership.userId,
      ...(membership.createdAt ? { createdAt: membership.createdAt } : {}),
      ...data,
    },
    select: { id: true },
  });
}

export async function roleIds(prisma: PrismaClient): Promise<Map<string, string>> {
  const rows = await prisma.role.findMany({ select: { id: true, key: true } });
  return new Map(rows.map((row) => [row.key, row.id]));
}

/**
 * Every membership placed in a branch of one of its group's departments holds
 * its member place on that branch's team (E-13, ADR 0003): the rule migration
 * `20260918160000_department_management_e13` applied to existing data, applied
 * to the seed's own. The same statement, the same deterministic ids — a rerun
 * adds nothing.
 */
export async function syncMemberPlaces(prisma: PrismaClient): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO "department_assignments" (
      "id", "parentGroupId", "userId", "groupDepartmentId", "companyId", "companyDepartmentId",
      "functionalRoleKey", "positionLevel", "accessLevel", "status", "startsAt", "createdAt", "updatedAt"
    )
    SELECT 'dam_e13_' || md5(m."id" || ':' || d."id"),
           c."parentGroupId", m."userId", d."groupDepartmentId", m."companyId", d."id",
           r."key", 'MEMBER', 'CONTRIBUTE', 'ACTIVE', COALESCE(m."joinedAt", m."createdAt"), now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
    FROM "company_members" m
    JOIN "departments" d ON d."id" = m."departmentId" AND d."companyId" = m."companyId"
    JOIN "companies" c ON c."id" = m."companyId"
    JOIN "group_departments" g ON g."id" = d."groupDepartmentId" AND g."parentGroupId" = c."parentGroupId"
    JOIN "roles" r ON r."id" = m."roleId"
    WHERE m."status" = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM "department_assignments" a
        WHERE a."userId" = m."userId" AND a."companyDepartmentId" = d."id"
          AND a."positionLevel" = 'MEMBER' AND a."status" = 'ACTIVE'
      )
    ON CONFLICT DO NOTHING`;
}
