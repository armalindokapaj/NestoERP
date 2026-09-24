/**
 * The test fixture group (E-06 §45, §150).
 *
 * Three companies under a parent group flagged as a fixture:
 *
 *   Fixture Tenant     the other tenant — seven modules off, its own owner and
 *                      viewer, its own records — so isolation and "module
 *                      unavailable" are proven against a company nobody in
 *                      the demo group can reach, even with group scope
 *   Fixture Works      accounts in the states sign-in must refuse, and the
 *                      invitations and projects the demo no longer carries
 *   Suspended company  nobody in it may sign in
 *
 * And a second fixture group holding one company, Solo Studio: a standalone
 * tenant with no Group level (OW §8, §45).
 */
import type { PrismaClient } from "@prisma/client";

import type { RoleKey } from "../../../config/roles";
import { seedCompanyModules, seedDepartmentBranches, roleIds, upsertAccount, upsertCompany, upsertMembership, upsertParentGroup } from "../organization-helpers";
import {
  COMPANY_SUSPENDED,
  FIXTURE_GROUP,
  FIXTURE_OWNER,
  FIXTURE_TENANT,
  FIXTURE_TENANT_DISABLED_MODULES,
  FIXTURE_WORKS,
  NEGATIVE_USERS,
  SOLO_COMPANY,
  SOLO_GROUP,
  SOLO_OWNER,
  SUSPENDED_COMPANY_USER,
  TENANT_USERS,
} from "./constants";

const FIXTURE_MEMBER_IDS: Record<string, string> = {
  user_owner_b: "member_owner_b",
  user_viewer_b: "member_viewer_b",
  user_fixture_owner: "member_fixture_owner",
  user_inactive: "member_inactive",
  user_suspended: "member_suspended",
  user_membership_inactive: "member_membership_inactive",
  user_membership_suspended: "member_membership_suspended",
  user_suspended_company: "member_suspended_company",
  user_solo_owner: "member_solo_owner",
};

/** A fixture account's one membership, by its deterministic id. */
export function fixtureMemberOf(userId: string): string | undefined {
  return FIXTURE_MEMBER_IDS[userId];
}

export async function seedFixtureOrganization(prisma: PrismaClient, passwordHash: string, activatedAt: Date) {
  await upsertParentGroup(prisma, { ...FIXTURE_GROUP, country: "Germany", status: "ACTIVE", isTestFixture: true, activatedAt });

  await upsertCompany(prisma, {
    id: FIXTURE_TENANT,
    parentGroupId: FIXTURE_GROUP.id,
    slug: "fixture-tenant",
    name: "Fixture Tenant GmbH",
    legalName: "Fixture Tenant GmbH",
    industry: "Professional Services",
    country: "Germany",
    address: "Maximilianstraße 12, 80539 München",
    email: "hello@fixture-tenant.test",
    phone: "+49 89 000 0000",
    website: "https://fixture-tenant.test",
    status: "ACTIVE",
  });
  await upsertCompany(prisma, {
    id: FIXTURE_WORKS,
    parentGroupId: FIXTURE_GROUP.id,
    slug: "fixture-works",
    name: "Fixture Works",
    industry: "Construction",
    country: "Albania",
    status: "ACTIVE",
  });
  await upsertCompany(prisma, {
    id: COMPANY_SUSPENDED,
    parentGroupId: FIXTURE_GROUP.id,
    slug: "nesto-suspended-company",
    name: "NESTO Suspended Company",
    industry: "Construction",
    country: "Albania",
    status: "SUSPENDED",
  });

  await seedCompanyModules(prisma, FIXTURE_TENANT, FIXTURE_TENANT_DISABLED_MODULES);
  await seedCompanyModules(prisma, FIXTURE_WORKS);
  await seedCompanyModules(prisma, COMPANY_SUSPENDED);

  const tenantDepartments = await seedDepartmentBranches(prisma, FIXTURE_TENANT, FIXTURE_GROUP.id);
  const worksDepartments = await seedDepartmentBranches(prisma, FIXTURE_WORKS, FIXTURE_GROUP.id);

  const roleId = await roleIds(prisma);

  for (const user of TENANT_USERS) {
    await upsertAccount(prisma, user, { passwordHash, parentGroupId: FIXTURE_GROUP.id });
    await upsertMembership(prisma, {
      id: FIXTURE_MEMBER_IDS[user.id]!,
      companyId: FIXTURE_TENANT,
      userId: user.id,
      role: user.role as RoleKey,
      roleId,
      departmentId: tenantDepartments.get(user.department) ?? null,
      jobTitle: user.jobTitle,
    });
  }

  await upsertAccount(prisma, FIXTURE_OWNER, { passwordHash, parentGroupId: FIXTURE_GROUP.id });
  await upsertMembership(prisma, {
    id: FIXTURE_MEMBER_IDS[FIXTURE_OWNER.id]!,
    companyId: FIXTURE_WORKS,
    userId: FIXTURE_OWNER.id,
    role: FIXTURE_OWNER.role,
    roleId,
    departmentId: worksDepartments.get(FIXTURE_OWNER.department) ?? null,
    jobTitle: FIXTURE_OWNER.jobTitle,
  });

  // Authentication negative states (PRD #9 §31).
  for (const negative of NEGATIVE_USERS) {
    await upsertAccount(prisma, { ...negative, phone: "+355 69 900 0900", jobTitle: "Test Fixture" }, { passwordHash, status: negative.userStatus, parentGroupId: FIXTURE_GROUP.id });
    await upsertMembership(prisma, {
      id: FIXTURE_MEMBER_IDS[negative.id]!,
      companyId: FIXTURE_WORKS,
      userId: negative.id,
      role: "VIEWER",
      roleId,
      departmentId: worksDepartments.get("projects") ?? null,
      jobTitle: "Test Fixture",
      status: negative.membershipStatus,
    });
  }

  // A member of the suspended company: sign-in must refuse them regardless of
  // their own status (PRD #9 §32).
  await upsertAccount(prisma, { ...SUSPENDED_COMPANY_USER, phone: "+355 4 200 0900", jobTitle: "Owner" }, { passwordHash, parentGroupId: FIXTURE_GROUP.id });
  await upsertMembership(prisma, {
    id: FIXTURE_MEMBER_IDS[SUSPENDED_COMPANY_USER.id]!,
    companyId: COMPANY_SUSPENDED,
    userId: SUSPENDED_COMPANY_USER.id,
    role: "OWNER",
    roleId,
    departmentId: null,
    jobTitle: "Owner",
  });

  await seedSoloTenant(prisma, passwordHash, activatedAt, roleId);

  for (const companyId of [FIXTURE_TENANT, FIXTURE_WORKS, COMPANY_SUSPENDED, SOLO_COMPANY]) {
    await prisma.companyMember.updateMany({ where: { companyId, joinedAt: null, status: "ACTIVE" }, data: { joinedAt: activatedAt } });
  }

  return {
    tenantDepartments,
    worksDepartments,
    memberOf: fixtureMemberOf,
  };
}

/** The standalone tenant: one group, one company, its Owner (OW §8, §45, §86). */
async function seedSoloTenant(prisma: PrismaClient, passwordHash: string, activatedAt: Date, roleId: Map<string, string>) {
  await upsertParentGroup(prisma, { ...SOLO_GROUP, country: "Albania", status: "ACTIVE", isTestFixture: true, activatedAt });
  await upsertCompany(prisma, {
    id: SOLO_COMPANY,
    parentGroupId: SOLO_GROUP.id,
    slug: "solo-studio",
    name: "Solo Studio",
    legalName: "Solo Studio sh.p.k.",
    industry: "Architecture",
    country: "Albania",
    status: "ACTIVE",
  });
  await seedCompanyModules(prisma, SOLO_COMPANY);
  const departments = await seedDepartmentBranches(prisma, SOLO_COMPANY, SOLO_GROUP.id);
  await upsertAccount(prisma, SOLO_OWNER, { passwordHash, parentGroupId: SOLO_GROUP.id });
  await upsertMembership(prisma, {
    id: FIXTURE_MEMBER_IDS[SOLO_OWNER.id]!,
    companyId: SOLO_COMPANY,
    userId: SOLO_OWNER.id,
    role: SOLO_OWNER.role,
    roleId,
    departmentId: departments.get(SOLO_OWNER.department) ?? null,
    jobTitle: SOLO_OWNER.jobTitle,
  });
}
