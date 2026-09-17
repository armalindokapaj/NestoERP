import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { appoint, endAppointment } from "@/lib/modules/organization/appointment.service";
import { cleanupSessions, COMPANY, loginAs, loginAsEmail, prisma } from "../../helpers";

/**
 * Appointing heads and managers (E-06 §13, §37, §38, §40, §78, §90, §121).
 *
 * The Owner appoints the head of a group department; the head of a function
 * appoints that function's company managers, in any company of the group and
 * in no other function; a local manager and Group IT appoint nobody. A position
 * widens the role the person works as, takes effect on their next request, and
 * ends as history.
 */

const startedAt = new Date();
let owner: UserContext;
let groupFinanceHead: UserContext;
let financeB: string;
let financeC: string;
let groupDepartment: (key: string) => Promise<string>;

beforeAll(async () => {
  owner = await loginAs("OWNER");
  groupFinanceHead = await loginAs("FINANCE");
  financeB = (await prisma.user.findUniqueOrThrow({ where: { username: "finance-b" }, select: { id: true } })).id;
  financeC = (await prisma.user.findUniqueOrThrow({ where: { username: "finance-c" }, select: { id: true } })).id;
  groupDepartment = async (key) => (await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: owner.parentGroupId, key }, select: { id: true } })).id;
});

afterAll(async () => {
  const created = await prisma.departmentAssignment.findMany({ where: { createdAt: { gte: startedAt } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: created.map((row) => row.id) } } });
  await prisma.departmentAssignment.deleteMany({ where: { id: { in: created.map((row) => row.id) } } });
  await prisma.department.updateMany({ where: { companyId: COMPANY.b, key: "finance" }, data: { managerMemberId: null } });
  await cleanupSessions();
});

describe("the Owner appoints group department heads (§38)", () => {
  it("makes somebody working as Finance the head of Finance, from their next request, and ends it as history", async () => {
    const finance = await groupDepartment("finance");
    const { assignmentId } = await appoint(owner, { userId: financeC, groupDepartmentId: finance, branchCompanyId: null });
    expect((await loginAsEmail("finance-c@nesto.test")).position).toBe("GROUP_HEAD");

    await endAppointment(owner, assignmentId);
    const ended = await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(ended).toMatchObject({ status: "INACTIVE", endedByUserId: owner.userId });
    expect((await loginAsEmail("finance-c@nesto.test")).position).toBe("MEMBER");
    expect(await prisma.auditEvent.count({ where: { entityId: assignmentId, actionKey: { in: ["ORGANIZATION_GROUP_DEPARTMENT_HEAD_ASSIGNED", "ORGANIZATION_DEPARTMENT_ASSIGNMENT_ENDED"] } } })).toBe(2);
  });

  it("refuses a head who does not work as that function (§6.5, §121)", async () => {
    const qaqcB = (await prisma.user.findUniqueOrThrow({ where: { username: "qaqc-b" }, select: { id: true } })).id;
    await expect(appoint(owner, { userId: qaqcB, groupDepartmentId: await groupDepartment("finance"), branchCompanyId: null })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("is not a head's, a manager's or Group IT's to make (§37, §40)", async () => {
    const finance = await groupDepartment("finance");
    await expect(appoint(groupFinanceHead, { userId: financeC, groupDepartmentId: finance, branchCompanyId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(appoint(await loginAs("GROUP_IT"), { userId: financeC, groupDepartmentId: finance, branchCompanyId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("company department managers (§37, §78)", () => {
  it("are appointed by the head of the function in any company, named on the branch, audited there", async () => {
    const finance = await groupDepartment("finance");
    const { assignmentId } = await appoint(groupFinanceHead, { userId: financeB, groupDepartmentId: finance, branchCompanyId: COMPANY.b });

    const assignment = await prisma.departmentAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(assignment).toMatchObject({ positionLevel: "COMPANY_MANAGER", companyId: COMPANY.b, functionalRoleKey: "FINANCE", status: "ACTIVE" });
    expect((await prisma.department.findFirstOrThrow({ where: { companyId: COMPANY.b, key: "finance" } })).managerMemberId).toBe("member_finance_b");
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { entityId: assignmentId } })).companyId).toBe(COMPANY.b);
    expect((await loginAsEmail("finance-b@nesto.test")).position).toBe("COMPANY_MANAGER");

    await expect(appoint(groupFinanceHead, { userId: financeB, groupDepartmentId: finance, branchCompanyId: COMPANY.b })).rejects.toMatchObject({ code: "CONFLICT" });

    await endAppointment(groupFinanceHead, assignmentId);
    expect((await prisma.department.findFirstOrThrow({ where: { companyId: COMPANY.b, key: "finance" } })).managerMemberId).toBeNull();
  });

  it("are not a head's to make in another function, nor a local manager's or Group IT's in their own", async () => {
    const qaqcB = (await prisma.user.findUniqueOrThrow({ where: { username: "qaqc-b" }, select: { id: true } })).id;
    await expect(appoint(groupFinanceHead, { userId: qaqcB, groupDepartmentId: await groupDepartment("qaqc"), branchCompanyId: COMPANY.b })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const formaManager = await loginAsEmail("finance-manager-d@nesto.test");
    await expect(appoint(formaManager, { userId: groupFinanceHead.userId, groupDepartmentId: await groupDepartment("finance"), branchCompanyId: COMPANY.d })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(appoint(await loginAs("GROUP_IT"), { userId: financeB, groupDepartmentId: await groupDepartment("finance"), branchCompanyId: COMPANY.b })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
