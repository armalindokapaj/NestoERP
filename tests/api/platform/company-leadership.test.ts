import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import type { GroupActor } from "@/lib/modules/platform/group-actor";
import { platformActor } from "@/lib/modules/platform/group-actor";
import { assignCompanyCeo, getCompanyLeadership, previewCeoCandidate, removeCompanyCeo, replaceCompanyCeo, searchCeoCandidates } from "@/lib/modules/platform/company-leadership.service";
import { addGroupUser } from "@/lib/modules/platform/platform-group-users.service";
import { changeOrganizationMemberRole, removeOrganizationMember } from "@/lib/modules/platform/platform-organization-admin.service";
import { attachCompanyToGroup, createCompany, detachCompanyFromGroup } from "@/lib/modules/platform/platform-company.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createCompanySchema, createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * The Company CEO (Admin PRD #12): none until named, one at a time, replaced
 * and removed atomically, separate from the Group CEO, and never reaching into
 * the person's other relationships.
 */

const GROUP = "t12-group";
const OTHER_GROUP = "t12-other-group";
const COMPANIES = ["t12-build", "t12-design", "t12-foreign"];
const STANDALONE = "T12 Standalone Co";
const EMAILS = ["t12-maria@nesto.test", "t12-john@nesto.test", "t12-besar@nesto.test", "t12-ceo-new@nesto.test", "t12-susp@nesto.test", "t12-hana@nesto.test"];

let admin: PlatformContext;
let platform: GroupActor;

const groupActorFor = (groupId: string, caps: string[] = ["ceo.manage", "users.view"]): GroupActor => ({
  userId: admin.userId, fullName: "Group CEO", roleKey: "OWNER", can: (capability, id) => id === groupId && caps.includes(capability),
});

async function removeCompany(companyId: string) {
  await prisma.projectMember.deleteMany({ where: { companyId } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId }, { entityId: companyId }] } });
  await prisma.activity.deleteMany({ where: { companyId } });
  await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
  await prisma.department.updateMany({ where: { companyId }, data: { managerMemberId: null } });
  await prisma.company.update({ where: { id: companyId }, data: { ceoMemberId: null } });
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

async function removeAll() {
  const companies = await prisma.company.findMany({ where: { OR: [{ slug: { in: COMPANIES } }, { name: STANDALONE }] }, select: { id: true, parentGroupId: true } });
  for (const company of companies) await removeCompany(company.id);
  const roots = await prisma.parentGroup.findMany({ where: { OR: [{ slug: { in: [GROUP, OTHER_GROUP] } }, { id: { in: companies.map((row) => row.parentGroupId) } }] }, select: { id: true } });
  const userIds = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((row) => row.id);
  for (const { id: parentGroupId } of roots) {
    await prisma.departmentAssignment.deleteMany({ where: { parentGroupId } });
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId } });
    await prisma.auditEvent.deleteMany({ where: { parentGroupId } });
  }
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const { id: parentGroupId } of roots) {
    await prisma.personProfile.deleteMany({ where: { parentGroupId } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId } });
    await prisma.parentGroup.delete({ where: { id: parentGroupId } });
  }
}

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
  platform = platformActor(admin);
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("company CEO (PRD #12)", () => {
  let groupId: string;
  let otherGroupId: string;
  let build: string;
  let design: string;
  let foreign: string;
  let standalone: string;
  let maria: string;
  let john: string;
  let besar: string;

  const ceoOf = async (companyId: string) => (await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { ceoMember: { select: { userId: true, role: { select: { key: true } } } } } })).ceoMember;
  const membership = (companyId: string, userId: string) => prisma.companyMember.findFirst({ where: { companyId, userId }, select: { status: true, groupDerived: true, role: { select: { key: true } } } });
  const makeUser = async (parentGroupId: string, email: string, first: string, last: string) => {
    const person = await prisma.personProfile.create({ data: { parentGroupId, firstName: first, lastName: last, workEmail: email, lifecycleStatus: "EMPLOYEE", createdByUserId: admin.userId }, select: { id: true } });
    const { createProvisionedUser } = await import("@/lib/auth/identity");
    return prisma.$transaction((tx) => createProvisionedUser(tx, { personProfileId: person.id, firstName: first, lastName: last, email, phone: null, username: null, temporaryPassword: "nesto1234", expiresAt: null })).then((row) => row.id);
  };

  it("leaves a new company without a CEO, valid and readable (§5, §142, §147)", async () => {
    groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T12 Group", slug: GROUP }))).id;
    otherGroupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T12 Other", slug: OTHER_GROUP }))).id;
    // A Group CEO exists for the group, covering every company.
    await addGroupUser(admin, { mode: "new", groupId, roleKey: "OWNER", companyAccess: { mode: "ALL" }, firstName: "Gina", lastName: "Group", email: EMAILS[5] });
    build = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "T12 Build", slug: COMPANIES[0] }))).companyId;
    design = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "T12 Design", slug: COMPANIES[1] }))).companyId;
    foreign = (await createGroupCompany(admin, otherGroupId, createGroupCompanySchema.parse({ name: "T12 Foreign", slug: COMPANIES[2] }))).companyId;
    ({ companyId: standalone } = await createCompany(admin, createCompanySchema.parse({ name: STANDALONE })));
    const view = await getCompanyLeadership(platform, { companyId: build });
    expect(view.ceo).toBeNull();
    expect(view.canManage).toBe(true);
    // The Group CEO covers the company through the group, yet is not its CEO.
    expect(await ceoOf(build)).toBeNull();
    expect(await prisma.companyMember.count({ where: { companyId: build, role: { key: "OWNER" } } })).toBe(1);
  });

  it("creates a new user as CEO: account, company membership, pointer and audit (§12, §143)", async () => {
    const result = await assignCompanyCeo(platform, { companyId: standalone, mode: "new", firstName: "Maria", lastName: "Brown", email: EMAILS[0] });
    maria = result.userId;
    expect(result.temporaryPassword).toBe("nesto1234");
    expect((await ceoOf(standalone))?.userId).toBe(maria);
    expect((await membership(standalone, maria))).toMatchObject({ status: "ACTIVE", groupDerived: false, role: { key: "CEO" } });
    expect(await prisma.companyMember.count({ where: { companyId: standalone, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { companyId: standalone, actionKey: "PLATFORM_COMPANY_CEO_ASSIGNED" } })).toBe(1);
    expect((await getCompanyLeadership(platform, { companyId: standalone })).ceo).toMatchObject({ name: "Maria Brown", state: "ACTIVE" });
  });

  it("refuses a second CEO and is idempotent for the same person (§19, §91, §92, §93)", async () => {
    await expect(assignCompanyCeo(platform, { companyId: standalone, mode: "new", firstName: "Jo", lastName: "Else", email: "t12-else@nesto.test" })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "CEO_EXISTS" } });
    expect(await prisma.user.count({ where: { email: "t12-else@nesto.test" } })).toBe(0);
    const again = await assignCompanyCeo(platform, { companyId: standalone, mode: "existing", userId: maria });
    expect(again.changed).toBe(false);
    expect(await prisma.companyMember.count({ where: { companyId: standalone, userId: maria } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { companyId: standalone, actionKey: "PLATFORM_COMPANY_CEO_ASSIGNED" } })).toBe(1);
  });

  it("two simultaneous assignments leave exactly one CEO (§153)", async () => {
    john = await makeUser(groupId, EMAILS[1], "John", "Smith");
    besar = await makeUser(groupId, EMAILS[2], "Besar", "Zifla");
    const results = await Promise.allSettled([
      assignCompanyCeo(platform, { companyId: design, mode: "existing", userId: john }),
      assignCompanyCeo(platform, { companyId: design, mode: "existing", userId: besar }),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
    expect(await prisma.companyMember.count({ where: { companyId: design, role: { key: "CEO" }, status: "ACTIVE" } })).toBe(1);
    // Put the company back to no CEO for the later cases.
    const winner = (await ceoOf(design))!.userId;
    await removeCompanyCeo(platform, { companyId: design, expectedCurrentCeoUserId: winner, previous: { action: "REMOVE" } });
  });

  it("names an existing Group CEO company CEO as a separate relationship, and refuses the company the seat already covers (§3, §35, §146)", async () => {
    // John gets a Group CEO seat that covers no company.
    await addGroupUser(admin, { mode: "existing", groupId, userId: john, roleKey: "OWNER", replaceCurrent: true, companyAccess: { mode: "NONE", companyIds: [] } });
    await prisma.company.update({ where: { id: design }, data: { ceoMemberId: null } });
    await prisma.companyMember.deleteMany({ where: { companyId: design, userId: { in: [john, besar] } } });
    await assignCompanyCeo(platform, { companyId: design, mode: "existing", userId: john });
    expect((await ceoOf(design))?.userId).toBe(john);
    const seat = await prisma.parentGroupMember.findFirstOrThrow({ where: { parentGroupId: groupId, userId: john }, include: { role: true } });
    expect(seat.role?.key).toBe("OWNER");
    // The reverse: Gina's seat covers every company, so a direct CEO row cannot sit beside it.
    // Gina stepped down as Group CEO when John replaced her; as Group IT with access to every company she reaches build through her seat.
    const gina = (await prisma.user.findFirstOrThrow({ where: { email: EMAILS[5] } })).id;
    await addGroupUser(admin, { mode: "existing", groupId, userId: gina, roleKey: "GROUP_IT", companyAccess: { mode: "ALL", companyIds: [] } });
    expect((await previewCeoCandidate(platform, { companyId: build, userId: gina })).blocked).toBe("GROUP_COVERED");
  });

  it("selects an existing company user, keeping one membership and no duplicate user (§16, §144)", async () => {
    const before = await prisma.user.count();
    await prisma.companyMember.create({ data: { companyId: build, userId: besar, roleId: (await prisma.role.findUniqueOrThrow({ where: { key: "FINANCE" } })).id, status: "ACTIVE", joinedAt: new Date() } });
    const preview = await previewCeoCandidate(platform, { companyId: build, userId: besar });
    expect(preview.company).toMatchObject({ roleKey: "FINANCE", status: "ACTIVE" });
    await assignCompanyCeo(platform, { companyId: build, mode: "existing", userId: besar });
    expect(await prisma.user.count()).toBe(before);
    expect(await prisma.companyMember.count({ where: { companyId: build, userId: besar } })).toBe(1);
    expect((await ceoOf(build))?.userId).toBe(besar);
  });

  it("will not create a duplicate identity for an existing email (§17, §170)", async () => {
    const users = await prisma.user.count();
    await expect(assignCompanyCeo(platform, { companyId: foreign, mode: "new", firstName: "Maria", lastName: "Again", email: EMAILS[0].toUpperCase() })).rejects.toMatchObject({ details: { code: "ACCOUNT_EXISTS" } });
    expect(await prisma.user.count()).toBe(users);
  });

  it("keeps the CEO out of the generic role editor and removal (§81)", async () => {
    const row = await prisma.companyMember.findFirstOrThrow({ where: { companyId: build, userId: besar }, select: { id: true } });
    await expect(changeOrganizationMemberRole(admin, { companyId: build, membershipId: row.id, roleKey: "FINANCE" })).rejects.toMatchObject({ details: { code: "IS_COMPANY_CEO" } });
    await expect(removeOrganizationMember(admin, { companyId: build, membershipId: row.id })).rejects.toMatchObject({ details: { code: "IS_COMPANY_CEO" } });
    expect((await ceoOf(build))?.userId).toBe(besar);
  });

  it("replaces the CEO atomically, keeping the old CEO's account and chosen role (§41-§45, §151, §155)", async () => {
    const oldMember = await prisma.companyMember.findFirstOrThrow({ where: { companyId: build, userId: besar }, select: { id: true } });
    const project = await prisma.project.create({ data: { companyId: build, code: "T12-001", name: "T12 Quay", status: "ACTIVE", projectTypeId: (await prisma.projectType.findFirstOrThrow({ where: { companyId: build }, select: { id: true } })).id, createdBy: "test" } });
    await prisma.projectMember.create({ data: { companyId: build, projectId: project.id, companyMemberId: oldMember.id, status: "ACTIVE", joinedAt: new Date() } });
    await expect(replaceCompanyCeo(platform, { companyId: build, expectedCurrentCeoUserId: besar, mode: "existing", userId: maria, previous: { action: "KEEP_WITH_ROLE", roleKey: "OWNER" } })).rejects.toBeTruthy();
    expect((await ceoOf(build))?.userId).toBe(besar);
    // Maria belongs to another organization (the standalone root): refused, and nothing moved.
    await expect(replaceCompanyCeo(platform, { companyId: build, expectedCurrentCeoUserId: besar, mode: "existing", userId: maria, previous: { action: "KEEP_WITH_ROLE", roleKey: "FINANCE" } })).rejects.toBeTruthy();
    expect((await ceoOf(build))?.userId).toBe(besar);
    expect((await membership(build, besar))?.role.key).toBe("CEO");

    const gina = (await prisma.user.findFirstOrThrow({ where: { email: EMAILS[5] } })).id;
    await expect(replaceCompanyCeo(platform, { companyId: build, expectedCurrentCeoUserId: besar, mode: "existing", userId: gina, previous: { action: "KEEP_WITH_ROLE", roleKey: "FINANCE" } })).rejects.toMatchObject({ details: { code: "GROUP_COVERED" } });
    expect((await ceoOf(build))?.userId).toBe(besar);

    await replaceCompanyCeo(platform, { companyId: build, expectedCurrentCeoUserId: besar, mode: "new", firstName: "Nova", lastName: "Ceo", email: EMAILS[3], previous: { action: "KEEP_WITH_ROLE", roleKey: "FINANCE" } });
    const now = await ceoOf(build);
    expect(now?.userId).not.toBe(besar);
    expect((await membership(build, besar))).toMatchObject({ status: "ACTIVE", role: { key: "FINANCE" } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: besar } })).status).toBe("ACTIVE");
    expect(await prisma.projectMember.count({ where: { companyMemberId: oldMember.id, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.companyMember.count({ where: { companyId: build, role: { key: "CEO" }, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { companyId: build, actionKey: "PLATFORM_COMPANY_CEO_REPLACED" } })).toBe(1);
    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
  });

  it("refuses a stale replacement and a replacement by the CEO themselves (§132, §133)", async () => {
    await expect(replaceCompanyCeo(platform, { companyId: build, expectedCurrentCeoUserId: besar, mode: "existing", userId: besar, previous: { action: "REMOVE" } })).rejects.toMatchObject({ details: { code: "LEADERSHIP_CHANGED" } });
    const current = (await ceoOf(build))!.userId;
    await expect(replaceCompanyCeo(platform, { companyId: build, expectedCurrentCeoUserId: current, mode: "existing", userId: current, previous: { action: "REMOVE" } })).rejects.toMatchObject({ details: { code: "SAME_CEO" } });
  });

  it("requires an explicit choice for the old CEO's access (§43, §44)", async () => {
    const current = (await ceoOf(build))!.userId;
    await expect(replaceCompanyCeo(platform, { companyId: build, expectedCurrentCeoUserId: current, mode: "existing", userId: besar, previous: { action: "KEEP_WITH_ROLE" } as never })).rejects.toBeTruthy();
    expect((await ceoOf(build))?.userId).toBe(current);
  });

  it("removes the CEO only where administration survives (§48, §50, §51, §157, §158)", async () => {
    // The one administrator cannot be removed.
    await expect(removeCompanyCeo(platform, { companyId: standalone, expectedCurrentCeoUserId: maria, previous: { action: "REMOVE" } })).rejects.toMatchObject({ details: { code: "LAST_COMPANY_ADMIN" } });
    expect((await ceoOf(standalone))?.userId).toBe(maria);
    // With a second administrator, removal works and the account stays.
    const second = await makeUser((await prisma.company.findUniqueOrThrow({ where: { id: standalone } })).parentGroupId, "t12-admin2@nesto.test", "Ada", "Min");
    EMAILS.push("t12-admin2@nesto.test");
    await prisma.companyMember.create({ data: { companyId: standalone, userId: second, roleId: (await prisma.role.findUniqueOrThrow({ where: { key: "HR" } })).id, status: "ACTIVE", joinedAt: new Date() } });
    await removeCompanyCeo(platform, { companyId: standalone, expectedCurrentCeoUserId: maria, previous: { action: "REMOVE" } });
    expect(await ceoOf(standalone)).toBeNull();
    expect((await membership(standalone, maria))?.status).toBe("INACTIVE");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: maria } })).status).toBe("ACTIVE");
    expect(await prisma.auditEvent.count({ where: { companyId: standalone, actionKey: "PLATFORM_COMPANY_CEO_REMOVED" } })).toBe(1);
    // A company with no CEO can be given one again, reactivating only with consent (§105, §106).
    await expect(assignCompanyCeo(platform, { companyId: standalone, mode: "existing", userId: maria })).rejects.toMatchObject({ details: { code: "REACTIVATION_REQUIRED" } });
    await assignCompanyCeo(platform, { companyId: standalone, mode: "existing", userId: maria, confirmReactivate: true });
    expect((await ceoOf(standalone))?.userId).toBe(maria);
    expect(await prisma.companyMember.count({ where: { companyId: standalone, userId: maria } })).toBe(1);
  });

  it("will not assign a suspended account (§107, §159)", async () => {
    const suspended = await makeUser(groupId, EMAILS[4], "Sam", "Suspended");
    await prisma.user.update({ where: { id: suspended }, data: { status: "SUSPENDED" } });
    await expect(assignCompanyCeo(platform, { companyId: foreign, mode: "existing", userId: suspended })).rejects.toBeTruthy();
    expect((await previewCeoCandidate(groupActorFor(otherGroupId), { companyId: foreign, userId: suspended }).catch(() => null))).toBeNull();
  });

  it("scopes who may act and who may be found (§14, §135, §136, §140, §141, §169)", async () => {
    const buildGroupActor = groupActorFor(groupId);
    // A group's actor cannot touch another group's company, nor a standalone one.
    await expect(assignCompanyCeo(buildGroupActor, { companyId: foreign, mode: "new", firstName: "X", lastName: "Y", email: "t12-x@nesto.test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getCompanyLeadership(buildGroupActor, { companyId: standalone })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Group IT-style actors may read but not appoint.
    const reader = groupActorFor(groupId, ["users.view"]);
    expect((await getCompanyLeadership(reader, { companyId: design })).canManage).toBe(false);
    await expect(replaceCompanyCeo(reader, { companyId: design, expectedCurrentCeoUserId: john, mode: "existing", userId: besar, previous: { action: "REMOVE" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Search never leaves the organization.
    const found = await searchCeoCandidates(buildGroupActor, { companyId: design, q: "t12-" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((row) => row.userId === maria)).toBe(false);
    expect(found.every((row) => !("memberships" in row))).toBe(true);
  });

  it("lets a group's own CEO change a child company's CEO, even though the Group CEO is not its CEO (§36, §52)", async () => {
    const actor = groupActorFor(groupId);
    const current = (await ceoOf(design))!.userId;
    await replaceCompanyCeo(actor, { companyId: design, expectedCurrentCeoUserId: current, mode: "existing", userId: besar, previous: { action: "KEEP_WITH_ROLE", roleKey: "FINANCE" } });
    expect((await ceoOf(design))?.userId).toBe(besar);
  });

  it("keeps the CEO when a company joins a group or leaves it, and makes no group member of them (§24, §25, §149, §150)", async () => {
    const before = (await ceoOf(standalone))!.userId;
    await attachCompanyToGroup(admin, standalone, groupId, "Joining the group");
    expect((await ceoOf(standalone))?.userId).toBe(before);
    expect(await prisma.parentGroupMember.count({ where: { userId: before } })).toBe(0);
    await detachCompanyFromGroup(admin, standalone, "Leaving the group");
    expect((await ceoOf(standalone))?.userId).toBe(before);
    expect(await prisma.parentGroupMember.count({ where: { userId: before } })).toBe(0);
  });
});
