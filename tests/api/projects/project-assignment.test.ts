import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { provisionAccount } from "@/lib/modules/organization/provisioning/provisioning.service";
import * as projects from "@/lib/modules/projects/project.service";
import { RECRUITMENT_SEED, seedRecruitmentRecords } from "../../../prisma/seed/recruitment";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Department managers put their own people on projects (E-06 §31-§33, §58, §94, §120, §141, §142, §166).
 *
 * Meridian's architecture manager assigns an architect of their branch to
 * Meridian's tower, and reaches neither another company's project nor a person
 * outside their branch. The Head of Group Architecture covers architects in
 * every company, and gains no QA/QC or Finance people by it. Terra's finance
 * manager puts Adrian Kola on East Gate Logistics Hub once Group IT has created
 * his account. The team the project's own manager keeps is the same
 * ProjectMember, and every change is audited in the project's company.
 */

const TEMP = { user: "user_t06a_architect_b", member: "member_t06a_architect_b" };
const startedAt = new Date();

let meridianManager: UserContext;
let architectureHead: UserContext;
let groupFinance: UserContext;
let formaFinanceManager: UserContext;

async function teamOf(projectId: string, companyMemberId: string) {
  return prisma.projectMember.findUnique({ where: { projectId_companyMemberId: { projectId, companyMemberId } }, select: { id: true, status: true, companyId: true } });
}

async function removeAdrian(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: "adrian.kola" } }, select: { id: true } });
  const userIds = users.map((row) => row.id);
  await seedRecruitmentRecords(prisma);
  const members = await prisma.companyMember.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const memberIds = members.map((row) => row.id);
  await prisma.projectMember.deleteMany({ where: { companyMemberId: { in: memberIds } } });
  await prisma.departmentAssignment.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.companyMember.deleteMany({ where: { id: { in: memberIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeAll(async () => {
  const [role, branch] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { key: "ARCHITECT" }, select: { id: true } }),
    prisma.department.findFirstOrThrow({ where: { companyId: COMPANY.b, key: "architecture" }, select: { id: true } }),
  ]);
  await prisma.user.upsert({
    where: { id: TEMP.user },
    update: { status: "ACTIVE" },
    create: { id: TEMP.user, username: "t06a-architect-b", firstName: "Lira", lastName: "Temp", passwordHash: "not-a-hash", status: "ACTIVE" },
  });
  await prisma.companyMember.upsert({
    where: { id: TEMP.member },
    update: { status: "ACTIVE" },
    create: { id: TEMP.member, companyId: COMPANY.b, userId: TEMP.user, roleId: role.id, departmentId: branch.id, status: "ACTIVE" },
  });

  meridianManager = await loginAsEmail(DEMO_EMAIL.architectureManagerB);
  architectureHead = await loginAsEmail(DEMO_EMAIL.architectureHead);
  groupFinance = await loginAs("FINANCE");
  formaFinanceManager = await loginAsEmail("finance-manager-d@nesto.test");
});

afterAll(async () => {
  await prisma.projectMember.updateMany({ where: { companyMemberId: "member_architect_d", projectId: PROJECT.d }, data: { status: "ACTIVE", leftAt: null } });
  await prisma.projectMember.deleteMany({ where: { companyMemberId: TEMP.member } });
  await removeAdrian();
  await prisma.auditEvent.deleteMany({ where: { actionKey: { in: ["PROJECT_MEMBER_ASSIGNED", "PROJECT_MEMBER_REMOVED", "ORGANIZATION_USER_PROVISIONED", "ORGANIZATION_DEPARTMENT_ASSIGNMENT_CREATED"] }, createdAt: { gte: startedAt } } });
  await prisma.activity.deleteMany({ where: { action: { in: ["PROJECT_MEMBER_ADDED", "PROJECT_MEMBER_REMOVED", "PROVISIONING_REQUEST_PROVISION"] }, createdAt: { gte: startedAt } } });
  await prisma.session.deleteMany({ where: { userId: TEMP.user } });
  await prisma.companyMember.deleteMany({ where: { id: TEMP.member } });
  await prisma.user.deleteMany({ where: { id: TEMP.user } });
  await cleanupSessions();
});

describe("a company department manager (§141)", () => {
  it("assigns a member of their branch to their company's project, and takes them off again", async () => {
    await projects.addMember(meridianManager, PROJECT.b, { companyMemberId: TEMP.member, projectRole: "Architect" });
    expect(await teamOf(PROJECT.b, TEMP.member)).toMatchObject({ status: "ACTIVE", companyId: COMPANY.b });

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: PROJECT.b, actionKey: "PROJECT_MEMBER_ASSIGNED", createdAt: { gte: startedAt } } });
    expect(audit.companyId).toBe(COMPANY.b);
    expect(audit.afterJson).toMatchObject({ companyMemberId: TEMP.member, via: "DEPARTMENT" });

    const record = (await teamOf(PROJECT.b, TEMP.member))!;
    await projects.removeMember(meridianManager, PROJECT.b, record.id);
    expect((await teamOf(PROJECT.b, TEMP.member))?.status).toBe("INACTIVE");
  });

  it("reaches no project of a sibling company, and no one outside the branch", async () => {
    await expect(projects.addMember(meridianManager, PROJECT.a, { companyMemberId: "member_architect", projectRole: undefined })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(projects.addMember(meridianManager, PROJECT.b, { companyMemberId: "member_qaqc_b", projectRole: undefined })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|CONFLICT/) });
    expect((await teamOf(PROJECT.b, "member_qaqc_b"))?.status).toBe("ACTIVE");
  });

  it("assigns nobody without an active login (§33)", async () => {
    await prisma.user.update({ where: { id: TEMP.user }, data: { status: "SUSPENDED" } });
    try {
      await expect(projects.addMember(meridianManager, PROJECT.b, { companyMemberId: TEMP.member, projectRole: undefined })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    } finally {
      await prisma.user.update({ where: { id: TEMP.user }, data: { status: "ACTIVE" } });
    }
  });
});

describe("a group department head (§142)", () => {
  it("covers their function in every company of the group, acting in the project's company", async () => {
    const record = (await teamOf(PROJECT.d, "member_architect_d"))!;
    await projects.removeMember(architectureHead, PROJECT.d, record.id);
    expect((await teamOf(PROJECT.d, "member_architect_d"))?.status).toBe("INACTIVE");

    await projects.addMember(architectureHead, PROJECT.d, { companyMemberId: "member_architect_d", projectRole: "Architect" });
    expect(await teamOf(PROJECT.d, "member_architect_d")).toMatchObject({ status: "ACTIVE", companyId: COMPANY.d });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: PROJECT.d, actionKey: "PROJECT_MEMBER_ASSIGNED", createdAt: { gte: startedAt } } });
    expect(audit.companyId).toBe(COMPANY.d);
  });

  it("gains no other function's people by it", async () => {
    await expect(projects.addMember(architectureHead, PROJECT.d, { companyMemberId: "member_finance_manager_d", projectRole: undefined })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(projects.addMember(architectureHead, PROJECT.b, { companyMemberId: "member_qaqc_b", projectRole: undefined })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|CONFLICT/) });
    expect(await teamOf(PROJECT.d, "member_finance_manager_d")).toBeNull();
  });
});

describe("HR data → Group IT account → department manager work access (§58)", () => {
  it("puts the newly provisioned Adrian Kola on East Gate Logistics Hub", async () => {
    const account = await provisionAccount(await loginAs("GROUP_IT"), RECRUITMENT_SEED.selected.request, {});
    const adrian = await prisma.companyMember.findUniqueOrThrow({ where: { companyId_userId: { companyId: COMPANY.c, userId: account.userId } }, select: { id: true } });

    // Forma's finance manager does not manage Terra's people.
    await expect(projects.addMember(formaFinanceManager, PROJECT.c, { companyMemberId: adrian.id, projectRole: undefined })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(projects.addMember(formaFinanceManager, PROJECT.d, { companyMemberId: adrian.id, projectRole: undefined })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Terra's finance manager does.
    await projects.addMember(groupFinance, PROJECT.c, { companyMemberId: adrian.id, projectRole: "Project accountant" });
    expect(await teamOf(PROJECT.c, adrian.id)).toMatchObject({ status: "ACTIVE", companyId: COMPANY.c });
  });
});
