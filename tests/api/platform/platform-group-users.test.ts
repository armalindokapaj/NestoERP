import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateCredentials } from "@/lib/auth/credentials";
import type { PlatformContext } from "@/lib/context/platform-context";
import { clearOutbox } from "@/lib/mail";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { groupPeople } from "@/lib/modules/platform/platform-organization-detail.query";
import { deletePlatformUser } from "@/lib/modules/platform/platform-user-delete.service";
import { addGroupUser, removeGroupUser } from "@/lib/modules/platform/platform-group-users.service";
import { createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * A Parent Group's own people (Admin PRD #8): the Group CEO and Group IT,
 * added from the group itself in any status, one account per person, one CEO,
 * and removal that never deletes the account.
 */

const GROUP = "t08g-platform-group";
const COMPANIES = ["t08g-harbour-build", "t08g-harbour-design"];
const OTHER = "t08g-other-group";
const EMAILS = ["t08g-ceo@nesto.test", "t08g-ceo2@nesto.test", "t08g-it@nesto.test", "t08g-stranger@nesto.test"];

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

async function removeOther(): Promise<void> {
  const other = await prisma.parentGroup.findUnique({ where: { slug: OTHER }, select: { id: true } });
  await prisma.user.deleteMany({ where: { email: EMAILS[3] } });
  if (!other) return;
  await prisma.auditEvent.deleteMany({ where: { parentGroupId: other.id } });
  await prisma.personProfile.deleteMany({ where: { parentGroupId: other.id } });
  await prisma.groupDepartment.deleteMany({ where: { parentGroupId: other.id } });
  await prisma.parentGroup.delete({ where: { id: other.id } });
}

beforeAll(async () => {
  await removeOther();
  await removeGroup();
  clearOutbox();
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  await removeGroup();
  await removeOther();
  await cleanupSessions();
});

describe("group people (PRD #8)", () => {
  let groupId: string;
  let ceoId: string;
  let ceo2Id: string;
  let itId: string;

  const seats = (userId: string) => prisma.parentGroupMember.findMany({ where: { parentGroupId: groupId, userId } });
  const companyRoles = async (userId: string, status: "ACTIVE" | "INACTIVE") =>
    (await prisma.companyMember.findMany({ where: { userId, status, company: { parentGroupId: groupId } }, select: { role: { select: { key: true } } } })).map((row) => row.role.key);

  it("creates the Group CEO before any company exists: a user and a seat with the CEO role, no company, audited", async () => {
    groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "Harbour Holdings", slug: GROUP }))).id;
    const result = await addGroupUser(admin, { mode: "new", groupId, roleKey: "OWNER", companyAccess: { mode: "ALL" }, firstName: "Hana", lastName: "Harbour", email: EMAILS[0] });
    ceoId = result.userId;
    expect(result.temporaryPassword).toBe("nesto1234");
    expect(await seats(ceoId)).toHaveLength(1);
    expect((await prisma.parentGroupMember.findFirstOrThrow({ where: { userId: ceoId }, include: { role: true } })).role?.key).toBe("OWNER");
    expect(await prisma.company.count({ where: { parentGroupId: groupId } })).toBe(0);
    expect(await prisma.companyMember.count({ where: { userId: ceoId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, actionKey: "PLATFORM_GROUP_USER_ADDED" } })).toBe(1);
    // The account signs in with the default password and must change it.
    const signedIn = await authenticateCredentials({ username: result.username, password: "nesto1234" }, new Headers());
    expect(signedIn).toMatchObject({ mustChangePassword: true });
  });

  it("brings the CEO's role to a company created afterwards", async () => {
    for (const [index, slug] of COMPANIES.entries()) await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: `Harbour ${index}`, slug }));
    expect(await companyRoles(ceoId, "ACTIVE")).toEqual(["OWNER", "OWNER"]);
  });

  it("refuses a second CEO unless the current one is replaced, and changes nothing", async () => {
    const users = await prisma.user.count();
    await expect(addGroupUser(admin, { mode: "new", groupId, roleKey: "OWNER", firstName: "Nora", lastName: "Harbour", email: EMAILS[1] })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "CEO_EXISTS" } });
    expect(await prisma.user.count()).toBe(users);
    expect(await companyRoles(ceoId, "ACTIVE")).toEqual(["OWNER", "OWNER"]);
  });

  it("replaces the CEO atomically: the old one keeps the seat and the account, loses the authority", async () => {
    const result = await addGroupUser(admin, { mode: "new", groupId, roleKey: "OWNER", replaceCurrent: true, companyAccess: { mode: "ALL" }, firstName: "Nora", lastName: "Harbour", email: EMAILS[1] });
    ceo2Id = result.userId;
    expect(await companyRoles(ceo2Id, "ACTIVE")).toEqual(["OWNER", "OWNER"]);
    expect(await companyRoles(ceoId, "ACTIVE")).toEqual([]);
    expect((await seats(ceoId))[0].status).toBe("ACTIVE");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ceoId } })).status).toBe("ACTIVE");
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, actionKey: "PLATFORM_GROUP_CEO_REPLACED" } })).toBe(1);

    // The group's Users tab reads it the same way.
    const { people, ceo } = await groupPeople(admin, groupId);
    expect(ceo).toMatchObject({ userId: ceo2Id });
    expect(people.map((person) => [person.userId, person.roleKey, person.companies])).toEqual(expect.arrayContaining([[ceo2Id, "OWNER", 2], [ceoId, null, 0]]));
  });

  it("gives an existing account a seat without a second account, and never twice", async () => {
    const users = await prisma.user.count();
    await addGroupUser(admin, { mode: "existing", groupId, userId: ceoId, roleKey: "GROUP_IT", companyAccess: { mode: "ALL" } });
    await addGroupUser(admin, { mode: "existing", groupId, userId: ceoId, roleKey: "GROUP_IT", companyAccess: { mode: "ALL" } });
    itId = ceoId;
    expect(await prisma.user.count()).toBe(users);
    expect(await seats(ceoId)).toHaveLength(1);
    expect(await companyRoles(ceoId, "ACTIVE")).toEqual(["GROUP_IT", "GROUP_IT"]);
  });

  it("refuses an account of another organization", async () => {
    const other = await createParentGroup(admin, createParentGroupSchema.parse({ name: "Other Holdings", slug: OTHER }));
    const person = await prisma.personProfile.create({ data: { parentGroupId: other.id, firstName: "Sam", lastName: "Stranger", workEmail: EMAILS[3], lifecycleStatus: "EMPLOYEE" } });
    const stranger = await prisma.user.create({ data: { username: "t08g-stranger", email: EMAILS[3], firstName: "Sam", lastName: "Stranger", passwordHash: "x", personProfileId: person.id, status: "ACTIVE" } });
    await expect(addGroupUser(admin, { mode: "existing", groupId, userId: stranger.id, roleKey: "GROUP_IT" })).rejects.toMatchObject({ details: { code: "OTHER_ORGANIZATION" } });
    expect(await prisma.parentGroupMember.count({ where: { userId: stranger.id, parentGroupId: groupId } })).toBe(0);
  });

  it("refuses to remove the only CEO, then removes a seat, ends its policy memberships and keeps the account", async () => {
    await expect(removeGroupUser(admin, { groupId, userId: ceo2Id, alsoRemoveCompanyAccess: true })).rejects.toMatchObject({ details: { code: "LAST_GROUP_ADMIN" } });
    expect(await companyRoles(ceo2Id, "ACTIVE")).toEqual(["OWNER", "OWNER"]);

    await removeGroupUser(admin, { groupId, userId: itId });
    expect((await seats(itId))[0].status).toBe("INACTIVE");
    // The memberships the seat's own policy created end with it (PRD #10 §59).
    expect(await companyRoles(itId, "ACTIVE")).toEqual([]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: itId } })).status).toBe("ACTIVE");

    await addGroupUser(admin, { mode: "existing", groupId, userId: itId, roleKey: "GROUP_IT", companyAccess: { mode: "ALL" } });
    await removeGroupUser(admin, { groupId, userId: itId, alsoRemoveCompanyAccess: true });
    expect(await companyRoles(itId, "ACTIVE")).toEqual([]);
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, actionKey: "PLATFORM_GROUP_USER_REMOVED" } })).toBe(2);
  });

  it("deletes an account that was never used, and refuses your own, a platform account and one in use", async () => {
    const fresh = await addGroupUser(admin, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Ida", lastName: "Harbour", email: EMAILS[2] });
    await deletePlatformUser(admin, { userId: fresh.userId });
    expect(await prisma.user.count({ where: { id: fresh.userId } })).toBe(0);
    expect(await prisma.parentGroupMember.count({ where: { userId: fresh.userId } })).toBe(0);
    expect(await prisma.companyMember.count({ where: { userId: fresh.userId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { parentGroupId: null, actionKey: "PLATFORM_USER_DELETED", entityId: fresh.userId } })).toBe(1);

    await expect(deletePlatformUser(admin, { userId: admin.userId })).rejects.toMatchObject({ details: { code: "SELF_DELETE" } });
    // The first CEO signed in during this suite: suspend, never delete.
    await expect(deletePlatformUser(admin, { userId: ceoId })).rejects.toMatchObject({ details: { code: "ACCOUNT_IN_USE" } });
    expect(await prisma.user.count({ where: { id: ceoId } })).toBe(1);
  });
});
