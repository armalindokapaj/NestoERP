import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { memberActor, platformActor } from "@/lib/modules/organization/departments/department.actor";
import { addDepartmentMember, appointCompanyManager, appointGroupHead } from "@/lib/modules/organization/departments/department.assignment.service";
import { activateInCompanies, createGroupDepartment } from "@/lib/modules/organization/departments/department.config.service";
import { getCompanyDepartments, listGroupDepartments } from "@/lib/modules/organization/departments/department.query";
import { createDepartmentSchema } from "@/lib/modules/organization/departments/department.schema";
import {
  activateParentGroup,
  createGroupCompany,
  createParentGroup,
  getGroupImplementation,
  markReadyForValidation,
  provisionInitialUser,
} from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema, createParentGroupSchema, initialUserSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAs, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * The Platform Admin setting up a group's departments (E-13 §48-§51, §94-§96,
 * §111, §121, §124, §127, §148, §149).
 *
 * The same services Organization calls, on the same records, with platform
 * permissions and the platform's own audit — and only while the group is being
 * implemented. A new company runs exactly the departments chosen for it.
 */

const GROUP = "t13p-platform-group";
const COMPANIES = ["t13p-north-build", "t13p-north-studio"];
const EMAILS = ["t13p-owner@nesto.test", "t13p-it@nesto.test", "t13p-finance@nesto.test", "t13p-clerk@nesto.test"];

let admin: PlatformContext;

async function removeGroup(): Promise<void> {
  const group = await prisma.parentGroup.findUnique({ where: { slug: GROUP }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  const userIds = users.map((row) => row.id);
  if (group) await prisma.departmentAssignment.deleteMany({ where: { parentGroupId: group.id } });
  for (const slug of COMPANIES) {
    const company = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
    if (!company) continue;
    const companyId = company.id;
    await prisma.notificationEventOutbox.deleteMany({ where: { companyId } });
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
    await prisma.department.deleteMany({ where: { companyId } });
    await prisma.projectType.deleteMany({ where: { companyId } });
    await prisma.projectUnitType.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  }
  if (group) {
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId: group.id } });
    await prisma.auditEvent.deleteMany({ where: { parentGroupId: group.id } });
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
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  await removeGroup();
  await cleanupSessions();
});

describe("setting up a group's departments from the platform", () => {
  let groupId: string;
  let build: string;
  let studio: string;
  const idOf = async (key: string) => (await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: groupId, key } })).id;
  const personOf = async (email: string) => (await prisma.user.findFirstOrThrow({ where: { email }, select: { personProfileId: true } })).personProfileId!;

  it("gives a new company exactly the departments chosen for it (§48, §49, §121, §149)", async () => {
    groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "North Holdings", slug: GROUP }))).id;
    const chosen = [await idOf("finance"), await idOf("hr"), await idOf("procurement")];
    build = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "North Build", slug: COMPANIES[0], departmentIds: chosen }))).companyId;
    const branches = await prisma.department.findMany({ where: { companyId: build }, select: { key: true, status: true } });
    expect(branches.map((row) => row.key).sort()).toEqual(["finance", "hr", "procurement"]);
    expect(branches.every((row) => row.status === "ACTIVE")).toBe(true);

    // Without a choice, every active department.
    studio = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "North Studio", slug: COMPANIES[1] }))).companyId;
    expect(await prisma.department.count({ where: { companyId: studio } })).toBe(13);

    // Only the group's own departments can be chosen.
    const foreign = await prisma.groupDepartment.findFirstOrThrow({ where: { parentGroupId: "group_demo_nesto" }, select: { id: true } });
    await expect(createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "North Other", slug: "t13p-north-other", departmentIds: [foreign.id] }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates, activates and staffs departments with the same services, audited as the platform (§50, §51, §111, §124)", async () => {
    await provisionInitialUser(admin, groupId, initialUserSchema.parse({ firstName: "Nora", lastName: "North", workEmail: EMAILS[0], roleKey: "OWNER" }));
    await provisionInitialUser(admin, groupId, initialUserSchema.parse({ firstName: "Ivo", lastName: "North", workEmail: EMAILS[1], roleKey: "GROUP_IT" }));
    await provisionInitialUser(admin, groupId, initialUserSchema.parse({ firstName: "Fatos", lastName: "North", workEmail: EMAILS[2], roleKey: "FINANCE", companyIds: [build] }));
    await provisionInitialUser(admin, groupId, initialUserSchema.parse({ firstName: "Klea", lastName: "North", workEmail: EMAILS[3], roleKey: "VIEWER", companyIds: [build] }));

    const actor = platformActor(admin, groupId);
    const { id: admin13 } = await createGroupDepartment(actor, createDepartmentSchema.parse({ name: "Administration", code: "ADMIN" }));
    const [branch] = await activateInCompanies(actor, admin13, [build]);
    await appointCompanyManager(actor, branch!.companyDepartmentId, { personId: await personOf(EMAILS[2]), replace: false });
    await addDepartmentMember(actor, branch!.companyDepartmentId, { personId: await personOf(EMAILS[3]) });
    await appointGroupHead(actor, await idOf("finance"), { personId: await personOf(EMAILS[2]), replace: false });

    const audit = await prisma.auditEvent.findMany({ where: { parentGroupId: groupId, entityType: "GroupDepartment" }, select: { actionKey: true, companyId: true, actorUserId: true, actorRoleSnapshot: true } });
    expect(audit.map((row) => row.actionKey)).toEqual(expect.arrayContaining(["ORGANIZATION_GROUP_DEPARTMENT_CREATED", "ORGANIZATION_COMPANY_DEPARTMENT_ACTIVATED", "ORGANIZATION_COMPANY_DEPARTMENT_MANAGER_ASSIGNED", "ORGANIZATION_DEPARTMENT_MEMBER_ASSIGNED", "ORGANIZATION_GROUP_DEPARTMENT_HEAD_ASSIGNED"]));
    expect(audit.every((row) => row.companyId === null && row.actorUserId === admin.userId && row.actorRoleSnapshot === "PLATFORM_ADMIN")).toBe(true);
    // The Platform Admin still belongs to nothing (E-06 §116).
    expect(await prisma.companyMember.count({ where: { userId: admin.userId } })).toBe(0);

    // The group's own Organization reads the very same records (§51, §148).
    const view = await getCompanyDepartments(platformActor(admin, groupId), build);
    const row = view.rows.find((candidate) => candidate.department.code === "ADMIN")!;
    expect(row.branch).toMatchObject({ status: "ACTIVE", memberCount: 2, manager: expect.objectContaining({ name: "Fatos North" }) });
    expect(view.rows.find((candidate) => candidate.department.code === "SALES")?.branch).toBeNull();
  });

  it("shows how far the departments are set up (§95, §96)", async () => {
    const implementation = await getGroupImplementation(admin, groupId);
    const heads = implementation.checklist.find((item) => item.key === "heads")!;
    const managers = implementation.checklist.find((item) => item.key === "managers")!;
    expect(heads).toMatchObject({ blocking: false, done: false });
    expect(managers).toMatchObject({ blocking: false, done: false });
    expect(implementation.departments.withHead).toBe(1);
    expect(implementation.companies.find((company) => company.id === build)).toMatchObject({ branches: 4, managers: 1 });
  });

  it("closes the platform's department tools when the group goes live; its Owner keeps them (§52, §94)", async () => {
    await markReadyForValidation(admin, groupId);
    await activateParentGroup(admin, groupId);
    await expect(createGroupDepartment(platformActor(admin, groupId), createDepartmentSchema.parse({ name: "Late", code: "LATE" }))).rejects.toMatchObject({ code: "CONFLICT", details: { code: "IMPLEMENTATION_CLOSED" } });

    const owner = await prisma.user.findFirstOrThrow({ where: { email: EMAILS[0] }, select: { id: true } });
    const membership = await prisma.companyMember.findFirstOrThrow({ where: { userId: owner.id, companyId: build }, select: { id: true } });
    const { buildMemberContext } = await import("@/lib/context/member-context");
    const ownerContext = (await buildMemberContext(build, membership.id))!;
    const { id } = await createGroupDepartment(memberActor(ownerContext), createDepartmentSchema.parse({ name: "Late", code: "LATE" }));
    expect((await listGroupDepartments(memberActor(ownerContext))).some((department) => department.id === id)).toBe(true);
    // Another group's Owner reaches none of it.
    const demoOwner = await loginAs("OWNER");
    await expect(activateInCompanies(memberActor(demoOwner), id, [build])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
