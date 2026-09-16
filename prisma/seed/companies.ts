/**
 * Companies, departments, users and memberships (PRD #9 §11–§32).
 *
 * Two active companies are mandatory: one-company seed data cannot prove tenant
 * isolation (PRD #9 §12). Company B additionally has several modules switched
 * off, which is how the "module unavailable" path is tested (PRD #9 §13).
 */
import type { MembershipStatus, PrismaClient, UserStatus } from "@prisma/client";

import { MODULE_KEYS, type ModuleKey } from "../../config/modules";
import type { RoleKey } from "../../config/roles";
import { hashPassword } from "../../lib/auth/password";
import {
  COMPANY_A,
  COMPANY_A_USERS,
  COMPANY_B,
  COMPANY_B_USERS,
  COMPANY_SUSPENDED,
  DEMO_PASSWORD,
  DEPARTMENTS,
  MULTI_COMPANY_USER,
  NEGATIVE_USERS,
  SUSPENDED_COMPANY_USER,
  type DemoUserSpec,
} from "./constants";

/** Company B runs a reduced module set on purpose (PRD #9 §13). */
const COMPANY_B_DISABLED: ModuleKey[] = [
  "finance",
  "sales",
  "contracts",
  "procurement",
  "inventory",
  "qaqc",
  "hse",
];

export async function seedCompanies(prisma: PrismaClient) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const companyA = await prisma.company.upsert({
    where: { id: COMPANY_A },
    update: {},
    create: {
      id: COMPANY_A,
      slug: "nesto-demo-construction",
      name: "NESTO Demo Construction",
      legalName: "NESTO Demo Construction, Lda.",
      industry: "Construction & Engineering",
      country: "Albania",
      address: "Rruga e Kavajës 118, Tiranë 1001",
      email: "hello@nestodemo.test",
      phone: "+355 4 200 0000",
      website: "https://nestodemo.test",
      status: "ACTIVE",
    },
  });

  const companyB = await prisma.company.upsert({
    where: { id: COMPANY_B },
    update: {},
    create: {
      id: COMPANY_B,
      slug: "nesto-second-company",
      name: "NESTO Second Company",
      legalName: "NESTO Second Company GmbH",
      industry: "Professional Services",
      country: "Germany",
      address: "Maximilianstraße 12, 80539 München",
      email: "hello@nesto-second.test",
      phone: "+49 89 000 0000",
      website: "https://nesto-second.test",
      status: "ACTIVE",
    },
  });

  const companySuspended = await prisma.company.upsert({
    where: { id: COMPANY_SUSPENDED },
    update: { status: "SUSPENDED" },
    create: {
      id: COMPANY_SUSPENDED,
      slug: "nesto-suspended-company",
      name: "NESTO Suspended Company",
      industry: "Construction",
      country: "Albania",
      status: "SUSPENDED",
    },
  });

  await seedCompanyModules(prisma, companyA.id, []);
  await seedCompanyModules(prisma, companyB.id, COMPANY_B_DISABLED);
  await seedCompanyModules(prisma, companySuspended.id, []);

  const departmentsA = await seedDepartments(prisma, companyA.id);
  const departmentsB = await seedDepartments(prisma, companyB.id);

  const roleRows = await prisma.role.findMany();
  const roleId = new Map(roleRows.map((row) => [row.key, row.id]));

  const members = new Map<string, string>();

  async function createMember(
    spec: DemoUserSpec,
    companyId: string,
    departments: Map<string, string>,
    options: {
      userStatus?: UserStatus;
      membershipStatus?: MembershipStatus;
      memberId?: string;
    } = {},
  ) {
    await prisma.user.upsert({
      where: { id: spec.id },
      update: {
        firstName: spec.firstName,
        lastName: spec.lastName,
        username: spec.username,
        email: spec.email,
        phone: spec.phone,
        passwordHash,
        status: options.userStatus ?? "ACTIVE",
      },
      create: {
        id: spec.id,
        firstName: spec.firstName,
        lastName: spec.lastName,
        username: spec.username,
        email: spec.email,
        phone: spec.phone,
        passwordHash,
        status: options.userStatus ?? "ACTIVE",
      },
    });

    const memberId = options.memberId ?? `member_${spec.id.replace(/^user_/, "")}`;

    const member = await prisma.companyMember.upsert({
      where: { companyId_userId: { companyId, userId: spec.id } },
      update: {
        roleId: roleId.get(spec.role)!,
        departmentId: departments.get(spec.department) ?? null,
        jobTitle: spec.jobTitle,
        status: options.membershipStatus ?? "ACTIVE",
      },
      create: {
        id: memberId,
        companyId,
        userId: spec.id,
        roleId: roleId.get(spec.role)!,
        departmentId: departments.get(spec.department) ?? null,
        jobTitle: spec.jobTitle,
        status: options.membershipStatus ?? "ACTIVE",
      },
    });

    members.set(`${companyId}:${spec.role}`, member.id);
    members.set(spec.id, member.id);
    return member;
  }

  for (const spec of COMPANY_A_USERS) {
    await createMember(spec, companyA.id, departmentsA);
  }

  for (const spec of COMPANY_B_USERS) {
    await createMember(spec, companyB.id, departmentsB);
  }

  // Authentication negative states (PRD #9 §31).
  for (const negative of NEGATIVE_USERS) {
    await createMember(
      {
        id: negative.id,
        username: negative.username,
        email: negative.email,
        firstName: negative.firstName,
        lastName: negative.lastName,
        role: "VIEWER" as RoleKey,
        department: "projects",
        jobTitle: "Test Fixture",
        phone: "+351 910 000 900",
      },
      companyA.id,
      departmentsA,
      { userStatus: negative.userStatus, membershipStatus: negative.membershipStatus },
    );
  }

  // A member of the suspended company: authentication must refuse them
  // regardless of their own status (PRD #9 §32).
  await createMember(
    {
      id: SUSPENDED_COMPANY_USER.id,
      username: SUSPENDED_COMPANY_USER.username,
      email: SUSPENDED_COMPANY_USER.email,
      firstName: SUSPENDED_COMPANY_USER.firstName,
      lastName: SUSPENDED_COMPANY_USER.lastName,
      role: "OWNER" as RoleKey,
      department: "management",
      jobTitle: "Owner",
      phone: "+355 4 200 0900",
    },
    companySuspended.id,
    new Map(),
  );

  // Different role in each company — the record the multi-company architecture
  // rests on (PRD #9 §30).
  await createMember(
    {
      id: MULTI_COMPANY_USER.id,
      username: MULTI_COMPANY_USER.username,
      email: MULTI_COMPANY_USER.email,
      firstName: MULTI_COMPANY_USER.firstName,
      lastName: MULTI_COMPANY_USER.lastName,
      role: "ARCHITECT" as RoleKey,
      department: "architecture",
      jobTitle: "Architect",
      phone: MULTI_COMPANY_USER.phone,
    },
    companyA.id,
    departmentsA,
    { memberId: "member_multicompany_a" },
  );

  await createMember(
    {
      id: MULTI_COMPANY_USER.id,
      username: MULTI_COMPANY_USER.username,
      email: MULTI_COMPANY_USER.email,
      firstName: MULTI_COMPANY_USER.firstName,
      lastName: MULTI_COMPANY_USER.lastName,
      role: "PROJECT_MANAGER" as RoleKey,
      department: "projects",
      jobTitle: "Project Manager",
      phone: MULTI_COMPANY_USER.phone,
    },
    companyB.id,
    departmentsB,
    { memberId: "member_multicompany_b" },
  );

  return { companyA, companyB, companySuspended, members, departmentsA, departmentsB };
}

async function seedCompanyModules(
  prisma: PrismaClient,
  companyId: string,
  disabled: ModuleKey[],
) {
  const moduleRows = await prisma.module.findMany();
  const off = new Set(disabled);

  for (const row of moduleRows) {
    const enabled = !off.has(row.key as ModuleKey);
    await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId, moduleId: row.id } },
      update: { enabled },
      create: { companyId, moduleId: row.id, enabled },
    });
  }

  return MODULE_KEYS.length - disabled.length;
}

async function seedDepartments(prisma: PrismaClient, companyId: string) {
  const result = new Map<string, string>();

  for (const department of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: { companyId_key: { companyId, key: department.key } },
      update: { name: department.name },
      create: { companyId, key: department.key, name: department.name },
    });
    result.set(department.key, row.id);
  }

  return result;
}
