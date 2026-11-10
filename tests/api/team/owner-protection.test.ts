import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveGroupContextForSession } from "@/lib/context/group-context";
import type { UserContext } from "@/lib/context/types";
import { groupActor, platformActor, type GroupActor } from "@/lib/modules/platform/group-actor";
import { updateGroupUserAccess } from "@/lib/modules/platform/group-company-access.service";
import { removeDirectCompanyAccess, reactivateGroupAccess, suspendGroupAccess } from "@/lib/modules/platform/group-user-detail.service";
import { addCompanyUser, bulkCompanyUsers, reactivateCompanyUserAccess, removeCompanyUserAccess, suspendCompanyUserAccess, updateCompanyUserAccess } from "@/lib/modules/platform/company-users.service";
import { addGroupUserAs, removeGroupUserAs } from "@/lib/modules/platform/platform-group-users.service";
import { placeMembership } from "@/lib/modules/organization/departments/placement.door";
import { setCeoAccess } from "@/lib/modules/team/ceo-access.service";
import { updateMemberSchema } from "@/lib/modules/team/team.schema";
import { deactivateMember, getMember, resetMemberPassword, suspendMember, unsuspendMember, updateMember } from "@/lib/modules/team/team.service";
import { cleanupSessions, COMPANY, loginAs, loginAsEmail, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * The group owner is protected (the user, 2026-11-10: "Group owner is
 * protected."): nobody else in the tenant suspends, deactivates, removes,
 * demotes or resets the password of an Owner of the group — in a company
 * where they are the Owner, or one where they hold another role. Another Owner
 * may, and the platform operator console keeps its powers.
 */

const GROUP = "group_demo_nesto";
const OWNER = "user_owner";
/** Group HR's Aurelia membership, made the group's second Owner here: Group HR then holds HR in Terra as a group owner. */
const HR_AURELIA = "member_hr";
const HR_TERRA = "member_hr__c";
const HR_USER = "user_hr";
const PROTECTED = { code: "FORBIDDEN", message: "Only a group owner can change a group owner's access.", details: { code: "OWNER_PROTECTED" } };

let roles: Record<string, string>;
let itSeatId: string;
let ownerSeatId: string;
let groupItSession: string;
const startedAt = new Date(Date.now() - 1000);

async function makeHrAnOwner(owner: boolean) {
  await prisma.companyMember.update({ where: { id: HR_AURELIA }, data: { roleId: owner ? roles.OWNER : roles.HR, accessVersion: { increment: 1 } } });
}

/** Group IT as a group seat would carry it (Admin PRD #8): the seeded seat, given the role for this file. */
async function groupIt(): Promise<GroupActor> {
  const result = await resolveGroupContextForSession(groupItSession);
  if (!result.ok) throw new Error(`Group IT's group context did not resolve: ${result.reason}`);
  expect(result.context).toMatchObject({ roleKey: "GROUP_IT", groupId: GROUP });
  return groupActor(result.context);
}

beforeAll(async () => {
  roles = Object.fromEntries((await prisma.role.findMany({ where: { key: { in: ["OWNER", "HR", "GROUP_IT", "ENGINEER", "VIEWER"] } }, select: { id: true, key: true } })).map((row) => [row.key, row.id]));
  itSeatId = (await prisma.parentGroupMember.findUniqueOrThrow({ where: { parentGroupId_userId: { parentGroupId: GROUP, userId: "user_it" } }, select: { id: true } })).id;
  ownerSeatId = (await prisma.parentGroupMember.findUniqueOrThrow({ where: { parentGroupId_userId: { parentGroupId: GROUP, userId: OWNER } }, select: { id: true } })).id;
  await prisma.parentGroupMember.update({ where: { id: itSeatId }, data: { roleId: roles.GROUP_IT } });
  groupItSession = (await prisma.session.create({ data: { sessionToken: `test_owprot_${Date.now()}`, userId: "user_it", expiresAt: new Date(Date.now() + 3_600_000) }, select: { id: true } })).id;
});

afterAll(async () => {
  await makeHrAnOwner(false);
  await prisma.companyMember.update({ where: { id: HR_TERRA }, data: { roleId: roles.HR, groupDerived: false, status: "ACTIVE", ceoAccess: false, ceoAccessGrantedAt: null, ceoAccessGrantedByMemberId: null } });
  await prisma.companyMember.updateMany({ where: { userId: OWNER, companyId: COMPANY.a }, data: { status: "ACTIVE", deactivatedAt: null, deactivatedByMemberId: null } });
  await prisma.companyMember.update({ where: { id: "member_viewer" }, data: { status: "ACTIVE" } });
  await prisma.parentGroupMember.update({ where: { id: itSeatId }, data: { roleId: null } });
  await prisma.parentGroupMember.update({ where: { id: ownerSeatId }, data: { roleId: null, status: "ACTIVE" } });
  await prisma.session.deleteMany({ where: { id: groupItSession } });
  await prisma.auditEvent.deleteMany({ where: { occurredAt: { gte: startedAt }, actionKey: { in: ["COMPANY_USER_ACCESS_SUSPENDED", "COMPANY_USER_ACCESS_REACTIVATED", "TEAM_MEMBER_SUSPENDED", "TEAM_MEMBER_ACTIVATED"] } } });
  await prisma.activity.deleteMany({ where: { createdAt: { gte: startedAt }, entityId: { in: [HR_TERRA] } } });
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("Team: a group owner's membership in any company of the group", () => {
  let ceoC: UserContext;

  beforeAll(async () => {
    ceoC = await loginAsEmail("ceo-c@nesto.test");
    expect(ceoC).toMatchObject({ role: "CEO", companyId: COMPANY.c });
  });

  it("is not the CEO's to suspend, deactivate, demote, reset or strip of CEO access when its holder owns the group", async () => {
    await makeHrAnOwner(true);
    try {
      // Group HR is an Owner of the group (Aurelia) and holds HR in Terra.
      await expect(suspendMember(ceoC, HR_TERRA)).rejects.toMatchObject(PROTECTED);
      await expect(deactivateMember(ceoC, HR_TERRA)).rejects.toMatchObject(PROTECTED);
      await expect(updateMember(ceoC, HR_TERRA, updateMemberSchema.parse({ roleId: roles.VIEWER }), { placement: placeMembership })).rejects.toMatchObject(PROTECTED);
      await expect(resetMemberPassword(ceoC, HR_TERRA)).rejects.toMatchObject(PROTECTED);
      await prisma.companyMember.update({ where: { id: HR_TERRA }, data: { ceoAccess: true, ceoAccessGrantedAt: new Date() } });
      await expect(setCeoAccess(ceoC, HR_TERRA, false)).rejects.toMatchObject(PROTECTED);
      await prisma.companyMember.update({ where: { id: HR_TERRA }, data: { ceoAccess: false, ceoAccessGrantedAt: null } });

      // The Team page offers none of it.
      const detail = await getMember(ceoC, HR_TERRA);
      expect(detail.capabilities).toMatchObject({ canAssignRole: false, canDeactivate: false, canSuspend: false });
      const row = await prisma.companyMember.findUniqueOrThrow({ where: { id: HR_TERRA }, select: { status: true, roleId: true } });
      expect(row).toEqual({ status: "ACTIVE", roleId: roles.HR });
    } finally {
      await makeHrAnOwner(false);
    }
    // Once they no longer own the group, the CEO manages that membership as before.
    await expect(suspendMember(ceoC, HR_TERRA)).resolves.toBeUndefined();
    await expect(unsuspendMember(ceoC, HR_TERRA)).resolves.toBeUndefined();
  });

  it("is not the CEO's to reset the password of where they are the Owner; suspending one stays the Owner grant's", async () => {
    const ceo = await loginAs("CEO");
    const ownerMember = await prisma.companyMember.findFirstOrThrow({ where: { userId: OWNER, companyId: COMPANY.a }, select: { id: true } });
    await expect(resetMemberPassword(ceo, ownerMember.id)).rejects.toMatchObject(PROTECTED);
    await expect(suspendMember(ceo, ownerMember.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: OWNER }, select: { mustChangePassword: true } })).mustChangePassword).toBe(false);
  });
});

describe("the group's own administration: Group IT on a group owner", () => {
  it("cannot demote, suspend, reactivate or remove the Owner's company access from Company Users", async () => {
    const it = await groupIt();
    await expect(updateCompanyUserAccess(it, { companyId: COMPANY.a, userId: OWNER, roleKey: "ENGINEER" })).rejects.toMatchObject(PROTECTED);
    await expect(suspendCompanyUserAccess(it, { companyId: COMPANY.a, userId: OWNER })).rejects.toMatchObject(PROTECTED);
    await expect(reactivateCompanyUserAccess(it, { companyId: COMPANY.a, userId: OWNER })).rejects.toMatchObject(PROTECTED);
    await expect(removeCompanyUserAccess(it, { companyId: COMPANY.a, userId: OWNER })).rejects.toMatchObject(PROTECTED);
    const bulk = await bulkCompanyUsers(it, { companyId: COMPANY.a, userIds: [OWNER], operation: { type: "suspend" } });
    expect(bulk).toEqual({ done: [], skipped: [{ userId: OWNER, reason: PROTECTED.message }] });
    const member = await prisma.companyMember.findFirstOrThrow({ where: { userId: OWNER, companyId: COMPANY.a }, select: { status: true, role: { select: { key: true } } } });
    expect(member).toEqual({ status: "ACTIVE", role: { key: "OWNER" } });
  });

  it("cannot re-role a group owner's group-given membership by adding them directly", async () => {
    const it = await groupIt();
    // Group HR as an Owner whose Terra row came from the group's seat.
    await prisma.companyMember.update({ where: { id: HR_TERRA }, data: { roleId: roles.OWNER, groupDerived: true } });
    try {
      await expect(addCompanyUser(it, { mode: "existing", companyId: COMPANY.c, userId: HR_USER, roleKey: "ENGINEER" })).rejects.toMatchObject(PROTECTED);
      expect(await prisma.companyMember.findUniqueOrThrow({ where: { id: HR_TERRA }, select: { roleId: true, groupDerived: true } })).toEqual({ roleId: roles.OWNER, groupDerived: true });
    } finally {
      await prisma.companyMember.update({ where: { id: HR_TERRA }, data: { roleId: roles.HR, groupDerived: false } });
    }
  });

  it("cannot remove the Owner's direct access, suspend or remove their seat, or re-seat them, from the group's Users tab", async () => {
    const it = await groupIt();
    await expect(removeDirectCompanyAccess(it, { groupId: GROUP, userId: OWNER, companyId: COMPANY.a })).rejects.toMatchObject(PROTECTED);
    await expect(suspendGroupAccess(it, { groupId: GROUP, userId: OWNER })).rejects.toMatchObject(PROTECTED);
    await expect(reactivateGroupAccess(it, { groupId: GROUP, userId: OWNER })).rejects.toMatchObject(PROTECTED);
    await expect(removeGroupUserAs(it, { groupId: GROUP, userId: OWNER, alsoRemoveCompanyAccess: true })).rejects.toMatchObject(PROTECTED);
    await expect(addGroupUserAs(it, { mode: "existing", groupId: GROUP, userId: OWNER, roleKey: "GROUP_IT" })).rejects.toMatchObject(PROTECTED);
    // An Owner who also holds a Group IT seat: that seat's company access is not IT's to change either.
    await prisma.parentGroupMember.update({ where: { id: ownerSeatId }, data: { roleId: roles.GROUP_IT } });
    try {
      await expect(updateGroupUserAccess(it, { groupId: GROUP, userId: OWNER, companyAccess: { mode: "ALL", companyIds: [] } })).rejects.toMatchObject(PROTECTED);
    } finally {
      await prisma.parentGroupMember.update({ where: { id: ownerSeatId }, data: { roleId: null } });
    }
    const seat = await prisma.parentGroupMember.findUniqueOrThrow({ where: { id: ownerSeatId }, select: { status: true, roleId: true, companyAccessMode: true } });
    expect(seat).toEqual({ status: "ACTIVE", roleId: null, companyAccessMode: "NONE" });
    expect(await prisma.companyMember.count({ where: { userId: OWNER, status: "ACTIVE", role: { key: "OWNER" }, company: { parentGroupId: GROUP } } })).toBe(5);
  });

  it("still manages everybody else's company access", async () => {
    const it = await groupIt();
    await expect(suspendCompanyUserAccess(it, { companyId: COMPANY.a, userId: "user_viewer" })).resolves.toEqual({ status: "SUSPENDED" });
    await expect(reactivateCompanyUserAccess(it, { companyId: COMPANY.a, userId: "user_viewer" })).resolves.toEqual({ status: "ACTIVE" });
  });

  it("leaves the platform operator console its powers over the Owner", async () => {
    const admin = platformActor(await loginAsPlatformAdmin());
    expect(admin.platform).toBe(true);
    await expect(suspendCompanyUserAccess(admin, { companyId: COMPANY.a, userId: OWNER })).resolves.toEqual({ status: "SUSPENDED" });
    await expect(reactivateCompanyUserAccess(admin, { companyId: COMPANY.a, userId: OWNER })).resolves.toEqual({ status: "ACTIVE" });
  });
});
