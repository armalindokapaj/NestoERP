import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateCredentials } from "@/lib/auth/credentials";
import { resolveContextForSession } from "@/lib/context/build-context";
import { resolveGroupContextForSession } from "@/lib/context/group-context";
import { resolvePlatformContextForSession, type PlatformContext } from "@/lib/context/platform-context";
import { clearOutbox } from "@/lib/mail";
import { groupActor, platformActor } from "@/lib/modules/platform/group-actor";
import { addGroupUser, addGroupUserAs, removeGroupUserAs } from "@/lib/modules/platform/platform-group-users.service";
import { createGroupCompanyAs, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { groupCompanies, groupOverview } from "@/lib/modules/group/group-workspace.query";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * A person who belongs to a parent group and to no company (Admin PRD #9):
 * they sign in, get a session that names no company, land in the group's own
 * area, administer the group through capabilities of their seat, and lose all
 * of it the moment the seat or the group goes — never through a company.
 */

const GROUP = "t09g-platform-group";
const COMPANIES = ["t09g-first-company"];
const OTHER = "t09g-other-group";
const EMAILS = ["t09g-ceo@nesto.test", "t09g-it@nesto.test", "t09g-ceo2@nesto.test", "t09g-stranger@nesto.test"];

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

describe("group-only access (PRD #9)", () => {
  let groupId: string;
  let otherGroupId: string;
  let ceoId: string;
  let ceoUsername: string;
  let ceoSession: string;

  const signIn = async (username: string) => {
    const result = await authenticateCredentials({ username, password: "nesto1234" }, new Headers());
    if (!result) throw new Error("sign-in refused");
    return result.sessionId;
  };

  it("lets a group with no company have a Group CEO, and lets them sign in", async () => {
    groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "Harbour Holdings", slug: GROUP }))).id;
    otherGroupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "Other Holdings", slug: OTHER }))).id;
    const created = await addGroupUser(admin, { mode: "new", groupId, roleKey: "OWNER", firstName: "Hana", lastName: "Harbour", email: EMAILS[0] });
    ceoId = created.userId;
    ceoUsername = created.username;
    expect(await prisma.company.count({ where: { parentGroupId: groupId } })).toBe(0);
    expect(await prisma.companyMember.count({ where: { userId: ceoId } })).toBe(0);

    ceoSession = await signIn(ceoUsername);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: ceoSession } });
    // No company anywhere in the session.
    expect(session).toMatchObject({ membershipId: null, currentCompanyId: null });
  });

  it("resolves the group, not a company: the group context, GROUP_SESSION for company pages, NOT_PLATFORM for the platform", async () => {
    const result = await resolveGroupContextForSession(ceoSession);
    expect(result).toMatchObject({ ok: true, context: { groupId, roleKey: "OWNER", userId: ceoId } });
    if (!result.ok) throw new Error("unreachable");
    expect(result.context.capabilities).toContain("group.companies.create");
    expect(await resolveContextForSession(ceoSession)).toEqual({ ok: false, reason: "GROUP_SESSION" });
    expect(await resolvePlatformContextForSession(ceoSession)).toEqual({ ok: false, reason: "NOT_PLATFORM" });
    expect(await signInAgainIsStable()).toBe(true);
  });

  async function signInAgainIsStable() {
    // Logout and login again: the group is restored (§51).
    await prisma.session.delete({ where: { id: ceoSession } });
    ceoSession = await signIn(ceoUsername);
    const again = await resolveGroupContextForSession(ceoSession);
    return again.ok && again.context.groupId === groupId;
  }

  it("reads an empty group as a valid state, and creates the first company through the seat", async () => {
    const context = (await resolveGroupContextForSession(ceoSession));
    if (!context.ok) throw new Error("no context");
    expect(await groupCompanies(context.context)).toEqual([]);
    expect(await groupOverview(context.context)).toMatchObject({ companies: 0, seats: 1, ceo: "Hana Harbour" });

    const created = await createGroupCompanyAs(groupActor(context.context), groupId, createGroupCompanySchema.parse({ name: "Harbour First", slug: COMPANIES[0] }));
    expect(await prisma.company.findUniqueOrThrow({ where: { id: created.companyId } })).toMatchObject({ parentGroupId: groupId });
    expect(await groupCompanies(context.context)).toHaveLength(1);
    // The session keeps naming no company: creating one does not move the CEO out of the group.
    expect(await resolveGroupContextForSession(ceoSession)).toMatchObject({ ok: true });
  });

  it("refuses another group's id for every command, and Group IT may not appoint a CEO or found a company", async () => {
    const context = await resolveGroupContextForSession(ceoSession);
    if (!context.ok) throw new Error("no context");
    const actor = groupActor(context.context);
    await expect(createGroupCompanyAs(actor, otherGroupId, createGroupCompanySchema.parse({ name: "Not Yours" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addGroupUserAs(actor, { mode: "new", groupId: otherGroupId, roleKey: "GROUP_IT", firstName: "No", lastName: "Way", email: EMAILS[3] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.company.count({ where: { parentGroupId: otherGroupId } })).toBe(0);

    const it = await addGroupUserAs(actor, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Ilir", lastName: "Harbour", email: EMAILS[1] });
    const itSession = await signIn(it.username);
    const itContext = await resolveGroupContextForSession(itSession);
    // Group IT also holds the company it was given through the group, so it works there: the group area is for seats without one.
    expect(["NOT_GROUP"].includes((itContext as { reason?: string }).reason ?? "") || itContext.ok).toBe(true);

    const noCeo = groupActor({ ...context.context, roleKey: "GROUP_IT", capabilities: ["group.view", "group.users.manage"] });
    await expect(addGroupUserAs(noCeo, { mode: "new", groupId, roleKey: "OWNER", firstName: "Nora", lastName: "Harbour", email: EMAILS[2] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createGroupCompanyAs(noCeo, groupId, createGroupCompanySchema.parse({ name: "Nope" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("takes access away at once: a replaced CEO has no group on the next request, the account stays", async () => {
    const replacement = await addGroupUser(admin, { mode: "new", groupId, roleKey: "OWNER", replaceCurrent: true, firstName: "Nora", lastName: "Harbour", email: EMAILS[2] });
    expect(replacement.userId).not.toBe(ceoId);
    expect(await resolveGroupContextForSession(ceoSession)).toEqual({ ok: false, reason: "NO_ACCESS" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ceoId } })).status).toBe("ACTIVE");

    // A suspended group cannot be used, and no company is searched for instead.
    await prisma.parentGroup.update({ where: { id: groupId }, data: { status: "SUSPENDED" } });
    const newCeoSession = await signIn(replacement.username).catch(() => null);
    if (newCeoSession) expect(await resolveGroupContextForSession(newCeoSession)).toEqual({ ok: false, reason: "NO_ACCESS" });
    await prisma.parentGroup.update({ where: { id: groupId }, data: { status: "IMPLEMENTING" } });
  });

  it("keeps the seat's own removal from locking the group: the last CEO stays", async () => {
    const holders = await prisma.parentGroupMember.findMany({ where: { parentGroupId: groupId, status: "ACTIVE", role: { key: "OWNER" } }, select: { userId: true } });
    expect(holders).toHaveLength(1);
    await expect(removeGroupUserAs(platformActor(admin), { groupId, userId: holders[0].userId })).rejects.toMatchObject({ details: { code: "LAST_GROUP_ADMIN" } });
  });
});
