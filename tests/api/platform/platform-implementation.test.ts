import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { resolvePlatformContextForSession } from "@/lib/context/platform-context";
import { clearOutbox } from "@/lib/mail";
import {
  assignInitialProjectMember,
  createGroupCompany,
  createParentGroup,
  getGroupImplementation,
  provisionInitialUser,
} from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema, createParentGroupSchema, initialUserSchema } from "@/lib/modules/platform/platform.schema";
import { listParentGroups } from "@/lib/modules/platform/platform.service";
import { cleanupSessions, loginAs, loginAsPlatformAdmin, prisma, projectTypeId } from "../../helpers";

/**
 * Implementing a parent group from the platform (E-06 §20, §21, §30, §34, §35, §71, §137, §138).
 *
 * The Platform Admin creates a group, adds its companies with their department
 * branches, records the approved initial roster — the Owner and Group IT in
 * every company, a manager where the roster puts one — and a first project
 * assignment, and activates the group once the checklist is met. From then on
 * the initial roster is closed. No business session reaches any of it.
 */

const GROUP = "t06p-platform-group";
const COMPANIES = ["t06p-harbour-build", "t06p-harbour-design"];
const EMAILS = ["t06p-owner@nesto.test", "t06p-it@nesto.test", "t06p-architect@nesto.test", "t06p-late@nesto.test"];

let admin: PlatformContext;

async function removeGroup(): Promise<void> {
  const group = await prisma.parentGroup.findUnique({ where: { slug: GROUP }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  const userIds = users.map((row) => row.id);
  for (const slug of COMPANIES) {
    const company = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
    if (!company) continue;
    const companyId = company.id;
    await prisma.projectMember.deleteMany({ where: { companyId } });
    await prisma.project.deleteMany({ where: { companyId } });
    await prisma.mailDelivery.deleteMany({ where: { companyId } });
    await prisma.auditEvent.deleteMany({ where: { companyId } });
    await prisma.activity.deleteMany({ where: { companyId } });
    await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
    await prisma.companyInvite.deleteMany({ where: { companyId } });
    await prisma.department.updateMany({ where: { companyId }, data: { managerMemberId: null } });
    await prisma.companyMember.deleteMany({ where: { companyId } });
    await prisma.companyNumberingScheme.deleteMany({ where: { companyId } });
    await prisma.companyStorageQuota.deleteMany({ where: { companyId } });
    await prisma.financeSettings.deleteMany({ where: { companyId } });
    await prisma.companyIntegrationSettings.deleteMany({ where: { companyId } });
    await prisma.companySettings.deleteMany({ where: { companyId } });
    await prisma.companyModule.deleteMany({ where: { companyId } });
    await prisma.departmentAssignment.deleteMany({ where: { companyId } });
    await prisma.department.deleteMany({ where: { companyId } });
    await prisma.projectType.deleteMany({ where: { companyId } });
    await prisma.projectUnitType.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
  if (group) {
    const parentGroupId = group.id;
    await prisma.departmentAssignment.deleteMany({ where: { parentGroupId } });
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId } });
    await prisma.auditEvent.deleteMany({ where: { parentGroupId } });
  }
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (group) {
    await prisma.personProfile.deleteMany({ where: { parentGroupId: group.id } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: group.id } });
    await prisma.parentGroup.delete({ where: { id: group.id } });
  }
}

beforeAll(async () => {
  await removeGroup();
  clearOutbox();
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  await removeGroup();
  await cleanupSessions();
});

describe("platform isolation (§116, §137)", () => {
  it("is refused to every business session, the Owner and Group IT included", async () => {
    for (const role of ["OWNER", "GROUP_IT"] as const) {
      const context = await loginAs(role);
      expect(await resolvePlatformContextForSession(context.sessionId)).toEqual({ ok: false, reason: "NOT_PLATFORM" });
    }
  });

  it("lists the demo group and never a test fixture group", async () => {
    const groups = await listParentGroups(admin);
    expect(groups.map((group) => group.slug)).toContain("nesto-demo-group");
    expect(await prisma.parentGroup.count({ where: { isTestFixture: true, slug: { in: groups.map((group) => group.slug) } } })).toBe(0);
  });
});

describe("implementing a group (§20, §21, §30, §35, §71, §138)", () => {
  let groupId: string;
  let companyId: string;
  let architectId: string;

  it("creates the group active, with its departments, audited at group level", async () => {
    const created = await createParentGroup(admin, createParentGroupSchema.parse({ name: "Harbour Holdings", slug: GROUP, country: "Albania", currency: "EUR", timezone: "Europe/Tirane" }));
    groupId = created.id;
    const group = await prisma.parentGroup.findUniqueOrThrow({ where: { id: groupId }, include: { _count: { select: { departments: true } } } });
    expect(group).toMatchObject({ status: "ACTIVE", isTestFixture: false });
    expect(group._count.departments).toBe(13);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { parentGroupId: groupId, actionKey: "PLATFORM_PARENT_GROUP_CREATED" } });
    expect(audit).toMatchObject({ companyId: null, actorUserId: admin.userId, actorRoleSnapshot: "PLATFORM_ADMIN" });
  });

  it("adds a company with its settings, modules and a branch of every department", async () => {
    const result = await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "Harbour Build", slug: COMPANIES[0], industry: "Construction", email: "office@harbour-build.test" }));
    companyId = result.companyId;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { _count: { select: { departments: true, modules: true } } } });
    expect(company).toMatchObject({ parentGroupId: groupId, industry: "Construction", email: "office@harbour-build.test" });
    expect(company._count.departments).toBe(13);
    expect(await prisma.companySettings.count({ where: { companyId } })).toBe(1);
  });

  it("records the approved initial roster: the Owner and Group IT in every company, a manager in theirs", async () => {
    const owner = await provisionInitialUser(admin, groupId, initialUserSchema.parse({ firstName: "Hana", lastName: "Harbour", workEmail: EMAILS[0], roleKey: "OWNER" }));
    await provisionInitialUser(admin, groupId, initialUserSchema.parse({ firstName: "Ilir", lastName: "Harbour", workEmail: EMAILS[1], roleKey: "GROUP_IT", position: "GROUP_HEAD" }));
    const architect = await provisionInitialUser(admin, groupId, initialUserSchema.parse({ firstName: "Arta", lastName: "Harbour", workEmail: EMAILS[2], roleKey: "ARCHITECT", companyIds: [companyId], position: "COMPANY_MANAGER", jobTitle: "Lead Architect" }));
    architectId = architect.userId;

    expect(owner.temporaryPassword).toBe("nesto1234");
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { id: owner.userId }, include: { personProfile: true } });
    expect(ownerUser).toMatchObject({ mustChangePassword: true, personProfile: { parentGroupId: groupId, lifecycleStatus: "EMPLOYEE" } });
    expect(await prisma.parentGroupMember.count({ where: { parentGroupId: groupId, userId: owner.userId } })).toBe(1);
    const branch = await prisma.department.findFirstOrThrow({ where: { companyId, key: "architecture" }, include: { managerMember: { select: { userId: true } } } });
    expect(branch.managerMember?.userId).toBe(architectId);

    // A second company: the Owner and Group IT join it on their own (§39, §40).
    const second = await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "Harbour Design", slug: COMPANIES[1] }));
    const roles = await prisma.companyMember.findMany({ where: { companyId: second.companyId }, select: { role: { select: { key: true } } } });
    expect(roles.map((row) => row.role.key).sort()).toEqual(["GROUP_IT", "OWNER"]);
  });

  it("assigns a first project from the roster, with no validation or handover step", async () => {
    const pm = await prisma.companyMember.findFirstOrThrow({ where: { companyId, user: { email: EMAILS[0] } }, select: { id: true } });
    const project = await prisma.project.create({ data: { companyId, code: "HB-001", name: "Harbour Quay", status: "ACTIVE", projectManagerMemberId: pm.id, projectTypeId: await projectTypeId(companyId), createdBy: "test" } });
    await assignInitialProjectMember(admin, groupId, { projectId: project.id, userId: architectId, projectRole: "Architect" });
    expect(await prisma.projectMember.count({ where: { projectId: project.id, status: "ACTIVE" } })).toBe(1);

    // No validation or handover: the group is ACTIVE from creation and nothing on the checklist blocks it.
    const after = await getGroupImplementation(admin, groupId);
    expect(after.checklist.filter((item) => item.blocking)).toEqual([]);
    expect(after.group.status).toBe("ACTIVE");
    expect(after.actions).not.toHaveProperty("canActivate");

    // The Platform Admin never became a member of what they built (§20, §116).
    expect(await prisma.companyMember.count({ where: { userId: admin.userId } })).toBe(0);
  });
});
