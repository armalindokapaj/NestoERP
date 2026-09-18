import { afterAll, describe, expect, it } from "vitest";

import { findOrganizationFindings } from "@/lib/modules/organization/organization-integrity";
import { COMPANY, prisma } from "../../helpers";

/**
 * The organization gate behind `pnpm verify:organization` (E-06 §11-§18, §73).
 *
 * The seeded groups agree with themselves; a position held with another
 * department's role, a grant pointing outside its group and a branch manager
 * nobody appointed are each named.
 */

const created = { assignments: [] as string[], grants: [] as string[] };

afterAll(async () => {
  await prisma.departmentAssignment.deleteMany({ where: { id: { in: created.assignments } } });
  await prisma.accessGrant.deleteMany({ where: { id: { in: created.grants } } });
  await prisma.department.updateMany({ where: { companyId: COMPANY.c, key: "legal" }, data: { managerMemberId: null } });
});

const codes = async () => (await findOrganizationFindings(prisma)).filter((finding) => finding.group === "nesto-demo-group").map((finding) => `${finding.level}:${finding.code}`);

describe("verify:organization", () => {
  it("finds nothing wrong in the seeded groups", async () => {
    expect((await findOrganizationFindings(prisma)).filter((finding) => finding.level === "error")).toEqual([]);
  });

  it("names a position held with another department's role, a grant outside the group and an unappointed branch manager", async () => {
    const group = await prisma.parentGroup.findUniqueOrThrow({ where: { slug: "nesto-demo-group" }, select: { id: true } });
    const salesA = await prisma.user.findUniqueOrThrow({ where: { username: "sales-a" }, select: { id: true } });
    const owner = await prisma.user.findUniqueOrThrow({ where: { username: "owner" }, select: { id: true } });
    const finance = await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: group.id, key: "finance" }, select: { id: true } });

    created.assignments.push(
      (
        await prisma.departmentAssignment.create({
          data: { parentGroupId: group.id, userId: salesA.id, groupDepartmentId: finance.id, functionalRoleKey: "SALES", positionLevel: "GROUP_HEAD", accessLevel: "MANAGE", status: "ACTIVE" },
          select: { id: true },
        })
      ).id,
    );
    created.grants.push(
      (
        await prisma.accessGrant.create({
          data: { userId: salesA.id, parentGroupId: group.id, functionKey: "finance", scopeType: "COMPANY", scopeId: COMPANY.tenant, accessLevel: "VIEW", grantedByUserId: owner.id },
          select: { id: true },
        })
      ).id,
    );
    await prisma.department.updateMany({ where: { companyId: COMPANY.c, key: "legal" }, data: { managerMemberId: "member_legal__c" } });

    const found = await codes();
    expect(found).toContain("error:POSITION_ROLE");
    expect(found).toContain("error:GRANT_SCOPE");
    expect(found).toContain("warning:BRANCH_MANAGER_UNAPPOINTED");
  });
});
