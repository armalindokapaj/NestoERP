/**
 * The demo parent group, its companies and people (E-06 §42-§55, §103).
 *
 * One group, five companies with every module on, the thirteen group
 * departments with a branch in every company, the platform's own
 * administrator, the group's users (a membership in each company), each
 * company's own people, and the positions that make somebody a department
 * head or a company's department manager.
 */
import type { PrismaClient } from "@prisma/client";

import { groupDepartmentId, type GroupDepartmentKey } from "../../../config/group-departments";
import { seedCompanyModules, seedDepartmentBranches, roleIds, upsertAccount, upsertCompany, upsertMembership, upsertParentGroup } from "../organization-helpers";
import { COMPANY_A, DEMO_COMPANIES, DEMO_COMPANY_CODES, DEMO_GROUP } from "./projects";
import {
  COMPANY_USERS,
  GROUP_USERS,
  PLATFORM_USERS,
  POSITIONS,
  demoHomeCompany,
  isMemberOf,
  memberId,
  personaIn,
  type SeedMembers,
} from "./users";

export async function seedDemoOrganization(prisma: PrismaClient, passwordHash: string, activatedAt: Date) {
  await upsertParentGroup(prisma, { ...DEMO_GROUP, status: "ACTIVE", activatedAt });

  const roleId = await roleIds(prisma);
  const branches = new Map<string, Map<GroupDepartmentKey, string>>();

  for (const code of DEMO_COMPANY_CODES) {
    const company = DEMO_COMPANIES[code];
    await upsertCompany(prisma, {
      id: company.id,
      parentGroupId: DEMO_GROUP.id,
      slug: company.slug,
      name: company.name,
      legalName: company.legalName,
      registrationNumber: company.registrationNumber,
      taxNumber: company.taxNumber,
      industry: company.industry,
      country: DEMO_GROUP.country,
      address: company.address,
      email: company.email,
      phone: company.phone,
      website: company.website,
      status: "ACTIVE",
    });
    // Every construction module on in every company, so a group function can
    // be shown working across all five (E-06 §46).
    await seedCompanyModules(prisma, company.id);
    branches.set(company.id, await seedDepartmentBranches(prisma, company.id, DEMO_GROUP.id));
  }

  /* People ------------------------------------------------------------------ */

  for (const user of PLATFORM_USERS) {
    await upsertAccount(prisma, user, { passwordHash, parentGroupId: null });
    await prisma.platformAccess.upsert({
      where: { userId: user.id },
      update: { roleKey: user.role, status: "ACTIVE" },
      create: { userId: user.id, roleKey: user.role, status: "ACTIVE" },
    });
  }

  for (const user of [...GROUP_USERS, ...COMPANY_USERS]) {
    await upsertAccount(prisma, user, { passwordHash, parentGroupId: DEMO_GROUP.id });
  }

  // The group's own members: its Owner, its IT and the heads of its departments.
  for (const user of GROUP_USERS) {
    await prisma.parentGroupMember.upsert({
      where: { parentGroupId_userId: { parentGroupId: DEMO_GROUP.id, userId: user.id } },
      update: { status: "ACTIVE" },
      create: { parentGroupId: DEMO_GROUP.id, userId: user.id, status: "ACTIVE", joinedAt: activatedAt },
    });
  }

  // Memberships company by company, Aurelia first: a person's oldest membership
  // is where a fresh sign-in starts.
  for (const code of DEMO_COMPANY_CODES) {
    const companyId = DEMO_COMPANIES[code].id;
    const departments = branches.get(companyId)!;
    for (const user of [...GROUP_USERS, ...COMPANY_USERS]) {
      if (!isMemberOf(user.id, companyId)) continue;
      await upsertMembership(prisma, {
        id: memberId(user.id, companyId),
        companyId,
        userId: user.id,
        role: user.role,
        roleId,
        departmentId: user.department ? (departments.get(user.department) ?? null) : null,
        jobTitle: user.jobTitle,
      });
    }
    await prisma.companyMember.updateMany({ where: { companyId, joinedAt: null }, data: { joinedAt: activatedAt } });
  }

  /* Positions --------------------------------------------------------------- */

  for (const position of POSITIONS) {
    const scope = position.companyId ? position.companyId.replace(/^company_demo_/, "") : "group";
    const id = `assignment_${position.userId.replace(/^user_/, "")}_${position.department}_${scope}`;
    const companyDepartmentId = position.companyId ? branches.get(position.companyId)!.get(position.department)! : null;
    const data = {
      parentGroupId: DEMO_GROUP.id,
      userId: position.userId,
      groupDepartmentId: groupDepartmentId(DEMO_GROUP.id, position.department),
      companyId: position.companyId,
      companyDepartmentId,
      functionalRoleKey: position.role,
      positionLevel: position.level,
      accessLevel: position.level === "GROUP_HEAD" ? ("MANAGE" as const) : ("APPROVE" as const),
      status: "ACTIVE" as const,
      startsAt: activatedAt,
    };
    await prisma.departmentAssignment.upsert({ where: { id }, update: data, create: { id, ...data } });

    // A company's branch names its manager, as the Team module always has.
    if (companyDepartmentId && position.companyId) {
      await prisma.department.update({
        where: { id: companyDepartmentId },
        data: { managerMemberId: memberId(position.userId, position.companyId) },
      });
    }
  }

  return { branches, members: demoMembers() };
}

/** Membership lookups over the deterministic ids above; no database round trip. */
export function demoMembers(): SeedMembers {
  return {
    get(userId) {
      const home = demoHomeCompany(userId);
      return home ? memberId(userId, home) : undefined;
    },
    in(companyId, persona) {
      return memberId(personaIn(companyId, persona), companyId);
    },
    userIn(companyId, persona) {
      return personaIn(companyId, persona);
    },
  };
}

export { COMPANY_A };
