import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { platformActor } from "@/lib/modules/platform/group-actor";
import { updateGroupUserAccess } from "@/lib/modules/platform/group-company-access.service";
import { getGroupUserDetail, groupUserActivity, previewGroupUserRemoval, reactivateGroupAccess, removeDirectCompanyAccess, suspendGroupAccess } from "@/lib/modules/platform/group-user-detail.service";
import { addGroupUser } from "@/lib/modules/platform/platform-group-users.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * One person's detail inside one group (PRD #11): sources told apart on the
 * server, suspension and direct-access removal, preview, isolation and the
 * read-only viewer.
 */

const GROUP = "t11a-group";
const OTHER = "t11a-other";
const SLUGS = ["t11a-a", "t11a-b", "t11a-c", "t11a-d", "t11a-e", "t11a-f", "t11a-x"];
const EMAILS = ["t11a-ceo@nesto.test", "t11a-it@nesto.test", "t11a-foreign@nesto.test"];

let admin: PlatformContext;

async function purgeCompany(slug: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true, parentGroupId: true } });
  if (!company) return;
  const companyId = company.id;
  await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
  await prisma.auditEvent.deleteMany({ where: { companyId } });
  await prisma.activity.deleteMany({ where: { companyId } });
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

async function purgeGroup(slug: string): Promise<void> {
  const group = await prisma.parentGroup.findUnique({ where: { slug }, select: { id: true } });
  if (!group) return;
  await prisma.departmentAssignment.deleteMany({ where: { parentGroupId: group.id } });
  await prisma.parentGroupMember.deleteMany({ where: { parentGroupId: group.id } });
}

async function removeAll(): Promise<void> {
  const users = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((row) => row.id);
  const rootIds = new Set<string>();
  for (const slug of SLUGS) {
    const company = await prisma.company.findUnique({ where: { slug }, select: { parentGroupId: true } });
    if (company) rootIds.add(company.parentGroupId);
    await purgeCompany(slug);
  }
  await purgeGroup(GROUP);
  await purgeGroup(OTHER);
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  const groups = await prisma.parentGroup.findMany({ where: { OR: [{ slug: { in: [GROUP, OTHER] } }, { id: { in: [...rootIds] } }] }, select: { id: true } });
  for (const { id } of groups) {
    await prisma.auditEvent.deleteMany({ where: { parentGroupId: id } });
    await prisma.personProfile.deleteMany({ where: { parentGroupId: id } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: id } });
    await prisma.parentGroup.delete({ where: { id } });
  }
}

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("group user detail (PRD #11)", () => {
  const actor = () => platformActor(admin);
  let groupId: string;
  let otherId: string;
  let ceo: string;
  let it_: string;
  let foreign: string;
  const company: Record<string, string> = {};
  const detail = (userId: string, gid = groupId, who = actor()) => getGroupUserDetail(who, { groupId: gid, userId });
  const row = async (userId: string, key: string) => (await detail(userId)).companyAccess.companies.find((entry) => entry.companyId === company[key]);
  const make = (key: string, name: string) => createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name, slug: `t11a-${key}` })).then((made) => { company[key] = made.companyId; });

  it("shows the Group CEO as group-wide, with the group role and the seat status", async () => {
    groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T11 Holdings", slug: GROUP }))).id;
    ceo = (await addGroupUser(admin, { mode: "new", groupId, roleKey: "OWNER", firstName: "Cea", lastName: "Owner", email: EMAILS[0] })).userId;
    it_ = (await addGroupUser(admin, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Ita", lastName: "Admin", email: EMAILS[1] })).userId;
    const result = await detail(ceo);
    expect(result).toMatchObject({ roleKey: "OWNER", groupWide: true, seatStatus: "ACTIVE", accountStatus: "ACTIVE", can: { manage: true } });
    expect(result.companyAccess.mode).toBe("NONE");
  });

  it("tells Via Group, Direct and Direct + Group apart, one row per company", async () => {
    await make("a", "T11 A"); await make("b", "T11 B"); await make("c", "T11 C");
    await updateGroupUserAccess(actor(), { groupId, userId: it_, companyAccess: { mode: "SELECTED", companyIds: [company.a, company.b] } });
    const viewer = await prisma.role.findFirstOrThrow({ where: { key: { notIn: ["OWNER", "GROUP_IT"] } }, select: { id: true, name: true } });
    // The policy's own row in A becomes the person's direct grant too; C is direct only.
    await prisma.companyMember.updateMany({ where: { userId: it_, companyId: company.a }, data: { groupDerived: false, roleId: viewer.id } });
    await prisma.companyMember.create({ data: { companyId: company.c, userId: it_, roleId: viewer.id, status: "ACTIVE", groupDerived: false, joinedAt: new Date() } });
    const result = await detail(it_);
    expect(result.companyAccess.mode).toBe("SELECTED");
    expect(result.companyAccess.companies.map((entry) => [entry.companyId, entry.source]).sort()).toEqual([[company.a, "BOTH"], [company.b, "GROUP_DERIVED"], [company.c, "DIRECT_COMPANY"]].sort());
    expect((await row(it_, "b"))).toMatchObject({ directRole: null });
    expect((await row(it_, "c"))).toMatchObject({ groupRole: null, directRole: viewer.name });
  });

  it("removing direct access from BOTH leaves Via Group; from Direct leaves nothing", async () => {
    expect(await removeDirectCompanyAccess(actor(), { groupId, userId: it_, companyId: company.a })).toEqual({ stillViaGroup: true });
    expect(await row(it_, "a")).toMatchObject({ source: "GROUP_DERIVED", directRole: null });
    expect(await removeDirectCompanyAccess(actor(), { groupId, userId: it_, companyId: company.c })).toEqual({ stillViaGroup: false });
    expect(await row(it_, "c")).toBeUndefined();
    // Nothing direct is left to remove.
    await expect(removeDirectCompanyAccess(actor(), { groupId, userId: it_, companyId: company.a })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("previews a removal with what is lost and what stays, and blocks the only CEO", async () => {
    const viewer = await prisma.role.findFirstOrThrow({ where: { key: { notIn: ["OWNER", "GROUP_IT"] } }, select: { id: true } });
    // The earlier direct row was ended, not erased: the person is brought back to it.
    await prisma.companyMember.updateMany({ where: { companyId: company.c, userId: it_ }, data: { status: "ACTIVE", groupDerived: false, deactivatedAt: null, roleId: viewer.id } });
    const preview = await previewGroupUserRemoval(actor(), { groupId, userId: it_ });
    expect(preview.lostCompanies.sort()).toEqual(["T11 A", "T11 B"]);
    expect(preview.directCompanies.map((entry) => entry.name)).toEqual(["T11 C"]);
    expect(preview.blocked).toBeNull();
    expect((await previewGroupUserRemoval(actor(), { groupId, userId: ceo })).blocked).toBe("LAST_GROUP_ADMIN");
    expect(await previewGroupUserRemoval({ ...actor(), userId: it_ }, { groupId, userId: it_ })).toMatchObject({ blocked: "SELF" });
  });

  it("suspends: derived access stops, direct access and the account stay; reactivating restores the policy", async () => {
    await suspendGroupAccess(actor(), { groupId, userId: it_ });
    const suspended = await detail(it_);
    expect(suspended.seatStatus).toBe("SUSPENDED");
    expect(suspended.companyAccess.companies.map((entry) => [entry.companyId, entry.source])).toEqual([[company.c, "DIRECT_COMPANY"]]);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: it_ }, select: { status: true } })).toEqual({ status: "ACTIVE" });

    await reactivateGroupAccess(actor(), { groupId, userId: it_ });
    const back = await detail(it_);
    expect(back.seatStatus).toBe("ACTIVE");
    expect(back.companyAccess.companies.map((entry) => entry.source).sort()).toEqual(["DIRECT_COMPANY", "GROUP_DERIVED", "GROUP_DERIVED"]);
  });

  it("refuses to suspend the only CEO and to suspend oneself", async () => {
    await expect(suspendGroupAccess(actor(), { groupId, userId: ceo })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(suspendGroupAccess({ ...actor(), userId: it_ }, { groupId, userId: it_ })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await detail(ceo)).seatStatus).toBe("ACTIVE");
  });

  it("shows a suspended account as such", async () => {
    await prisma.user.update({ where: { id: it_ }, data: { status: "SUSPENDED" } });
    expect(await detail(it_)).toMatchObject({ accountStatus: "SUSPENDED", seatStatus: "ACTIVE" });
    await prisma.user.update({ where: { id: it_ }, data: { status: "ACTIVE" } });
  });

  it("answers only for people with a seat in this group", async () => {
    otherId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T11 Other", slug: OTHER }))).id;
    await createGroupCompany(admin, otherId, createGroupCompanySchema.parse({ name: "T11 X", slug: "t11a-x" }));
    foreign = (await addGroupUser(admin, { mode: "new", groupId: otherId, roleKey: "GROUP_IT", firstName: "Fay", lastName: "Foreign", email: EMAILS[2] })).userId;
    await expect(detail(foreign)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(detail(it_, otherId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(suspendGroupAccess(actor(), { groupId, userId: foreign })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("serves a read-only viewer the facts and refuses every change", async () => {
    const viewer = { ...actor(), can: (capability: string) => capability === "users.view" } as ReturnType<typeof platformActor>;
    expect((await detail(it_, groupId, viewer)).can).toEqual({ manage: false, manageCeo: false });
    await expect(suspendGroupAccess(viewer, { groupId, userId: it_ })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeDirectCompanyAccess(viewer, { groupId, userId: it_, companyId: company.c })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const blind = { ...actor(), can: () => false } as ReturnType<typeof platformActor>;
    await expect(detail(it_, groupId, blind)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists the access changes as activity, newest first, with the actor", async () => {
    const page = await groupUserActivity(actor(), { groupId, userId: it_ });
    const keys = page.rows.map((entry) => entry.actionKey);
    expect(keys).toEqual(expect.arrayContaining(["GROUP_ACCESS_SUSPENDED", "GROUP_ACCESS_REACTIVATED", "GROUP_DIRECT_COMPANY_ACCESS_REMOVED", "GROUP_COMPANY_ACCESS_CHANGED"]));
    expect(keys.indexOf("GROUP_ACCESS_REACTIVATED")).toBeLessThan(keys.indexOf("GROUP_ACCESS_SUSPENDED"));
    expect(page.rows[0].actorName).toBeTruthy();
    // Nothing about another person or another group.
    expect((await groupUserActivity(actor(), { groupId, userId: ceo })).rows.every((entry) => entry.actionKey !== "GROUP_ACCESS_SUSPENDED")).toBe(true);
  });
});
