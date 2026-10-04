import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { platformActor } from "@/lib/modules/platform/group-actor";
import { getGroupUserAccess, groupCompanyChoices, resolveGroupCompanyAccess, updateGroupUserAccess } from "@/lib/modules/platform/group-company-access.service";
import { addGroupUser, removeGroupUser } from "@/lib/modules/platform/platform-group-users.service";
import { detachCompanyFromGroup } from "@/lib/modules/platform/platform-company.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Company access of a group seat (PRD #10): NONE, ALL or SELECTED, kept as
 * persisted intent, separate from direct company membership and confined to
 * the seat's own group.
 */

const GROUP = "t10a-group";
const OTHER = "t10a-other";
const SLUGS = ["t10a-a", "t10a-b", "t10a-c", "t10a-d", "t10a-e", "t10a-f", "t10a-x"];
const EMAILS = ["t10a-none@nesto.test", "t10a-all@nesto.test", "t10a-sel@nesto.test", "t10a-empty@nesto.test"];

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

describe("company access of a group seat (PRD #10)", () => {
  const actor = () => platformActor(admin);
  let groupId: string;
  let otherId: string;
  const company: Record<string, string> = {};
  let none: string;
  let all: string;
  let sel: string;

  const members = async (userId: string, groupDerived?: boolean) =>
    (await prisma.companyMember.findMany({ where: { userId, status: "ACTIVE", company: { parentGroupId: groupId }, ...(groupDerived === undefined ? {} : { groupDerived }) }, select: { companyId: true } })).map((row) => row.companyId).sort();
  const ids = (...keys: string[]) => keys.map((key) => company[key]).sort();
  const state = (userId: string) => getGroupUserAccess(actor(), { groupId, userId });
  const make = (key: string, name: string) => createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name, slug: `t10a-${key}` })).then((row) => { company[key] = row.companyId; });

  it("adds a group user with no company access by default", async () => {
    groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T10 Holdings", slug: GROUP }))).id;
    none = (await addGroupUser(admin, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Nia", lastName: "None", email: EMAILS[0] })).userId;
    all = (await addGroupUser(admin, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Ali", lastName: "All", email: EMAILS[1] })).userId;
    sel = (await addGroupUser(admin, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Sel", lastName: "Ected", email: EMAILS[2] })).userId;
    for (const userId of [none, all, sel]) expect(await state(userId)).toMatchObject({ mode: "NONE", companyIds: [] });
    expect(await prisma.parentGroupMember.count({ where: { parentGroupId: groupId, status: "ACTIVE" } })).toBe(3);
    expect(await prisma.companyMember.count({ where: { userId: { in: [none, all, sel] } } })).toBe(0);
  });

  it("ALL covers the companies now, without a membership the policy did not create, and every company added later", async () => {
    await make("a", "T10 A"); await make("b", "T10 B"); await make("c", "T10 C");
    expect(await members(all)).toEqual([]);
    await updateGroupUserAccess(actor(), { groupId, userId: all, companyAccess: { mode: "ALL" } });
    expect(await members(all)).toEqual(ids("a", "b", "c"));
    expect(await members(all, true)).toEqual(ids("a", "b", "c"));

    await make("d", "T10 D");
    expect(await members(all)).toEqual(ids("a", "b", "c", "d"));
    // NONE and SELECTED do not grow with the group.
    expect(await members(none)).toEqual([]);
  });

  it("SELECTED covers only the named companies; ticking every current one is still not ALL", async () => {
    await updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "SELECTED", companyIds: [company.a, company.c] } });
    expect(await members(sel)).toEqual(ids("a", "c"));

    await updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "SELECTED", companyIds: ids("a", "b", "c", "d") } });
    expect(await state(sel)).toMatchObject({ mode: "SELECTED" });
    await make("e", "T10 E");
    expect(await members(sel)).toEqual(ids("a", "b", "c", "d"));
    expect(await members(all)).toEqual(ids("a", "b", "c", "d", "e"));
  });

  it("refuses a company outside the group, an empty selection and a stale form, applying nothing", async () => {
    otherId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T10 Other", slug: OTHER }))).id;
    const foreign = (await createGroupCompany(admin, otherId, createGroupCompanySchema.parse({ name: "T10 X", slug: "t10a-x" }))).companyId;
    const before = await state(sel);
    await expect(updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "SELECTED", companyIds: [company.a, foreign] } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "SELECTED", companyIds: [] } })).rejects.toBeTruthy();
    await expect(updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "NONE" }, expectedVersion: before.version - 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await state(sel)).toEqual(before);
    expect(await members(sel)).toEqual(ids("a", "b", "c", "d"));
    expect(await members(sel, false)).toEqual([]);
  });

  it("is idempotent: the same configuration twice changes and audits nothing the second time", async () => {
    const first = await updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "SELECTED", companyIds: [company.a, company.b] } });
    const events = await prisma.auditEvent.count({ where: { parentGroupId: groupId, actionKey: { startsWith: "GROUP_COMPANY_ACCESS" } } });
    const second = await updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "SELECTED", companyIds: [company.b, company.a] } });
    expect(second).toEqual(first);
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, actionKey: { startsWith: "GROUP_COMPANY_ACCESS" } } })).toBe(events);
    expect(await prisma.parentGroupMemberCompany.count({ where: { seat: { userId: sel } } })).toBe(2);
    expect(await members(sel)).toEqual(ids("a", "b"));
  });

  it("audits the mode change and the selected-company changes", async () => {
    const changed = await prisma.auditEvent.findMany({ where: { parentGroupId: groupId, entityId: all, actionKey: { startsWith: "GROUP_COMPANY_ACCESS" } }, select: { actionKey: true } });
    expect(changed.map((row) => row.actionKey)).toEqual(expect.arrayContaining(["GROUP_COMPANY_ACCESS_CHANGED", "GROUP_COMPANY_ACCESS_MODE_CHANGED"]));
    const keys = (await prisma.auditEvent.findMany({ where: { parentGroupId: groupId, entityId: sel, actionKey: { startsWith: "GROUP_COMPANY_ACCESS" } }, select: { actionKey: true } })).map((row) => row.actionKey);
    expect(keys).toEqual(expect.arrayContaining(["GROUP_COMPANY_ACCESS_GRANTED", "GROUP_COMPANY_ACCESS_REVOKED"]));
  });

  it("keeps a direct membership when the policy shrinks, and tells the sources apart", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" }, select: { id: true } }).catch(() => prisma.role.findFirstOrThrow({ where: { key: { not: "OWNER" } }, select: { id: true } }));
    // A company administrator's own grant in company A, beside the policy's.
    await prisma.companyMember.updateMany({ where: { userId: all, companyId: company.a }, data: { groupDerived: false, roleId: role.id } });
    expect(await resolveGroupCompanyAccess(all, company.a)).toMatchObject({ allowed: true, source: "BOTH", mode: "ALL" });
    expect(await resolveGroupCompanyAccess(all, company.b)).toMatchObject({ allowed: true, source: "GROUP_DERIVED" });

    await updateGroupUserAccess(actor(), { groupId, userId: all, companyAccess: { mode: "NONE" } });
    expect(await members(all)).toEqual(ids("a"));
    expect(await resolveGroupCompanyAccess(all, company.a)).toMatchObject({ allowed: true, source: "DIRECT_COMPANY", mode: "NONE" });
    expect(await resolveGroupCompanyAccess(all, company.b)).toMatchObject({ allowed: false, source: "NONE" });
    expect((await state(all)).mode).toBe("NONE");
  });

  it("answers ALL for the group's own companies only", async () => {
    await updateGroupUserAccess(actor(), { groupId, userId: all, companyAccess: { mode: "ALL" } });
    expect(await resolveGroupCompanyAccess(all, company.c)).toMatchObject({ allowed: true });
    const foreign = await prisma.company.findUniqueOrThrow({ where: { slug: "t10a-x" }, select: { id: true } });
    expect(await resolveGroupCompanyAccess(all, foreign.id)).toMatchObject({ allowed: false, source: "NONE" });
  });

  it("offers the group's companies to the picker, searched and counted, and nobody else's", async () => {
    const page = await groupCompanyChoices(actor(), { groupId, q: "T10" });
    expect(page.companies.map((row) => row.id).sort()).toEqual(ids("a", "b", "c", "d", "e"));
    expect(page.total).toBe(5);
    expect((await groupCompanyChoices(actor(), { groupId, q: "T10 X" })).companies).toEqual([]);
  });

  it("ends the policy's access when the seat is removed, keeping a direct membership", async () => {
    await removeGroupUser(admin, { groupId, userId: all });
    expect(await members(all, true)).toEqual([]);
    expect(await members(all, false)).toEqual(ids("a"));
  });

  it("drops a selected company when it leaves the group", async () => {
    await make("f", "T10 F");
    await updateGroupUserAccess(actor(), { groupId, userId: sel, companyAccess: { mode: "SELECTED", companyIds: [company.a, company.f] } });
    expect(await members(sel)).toEqual(ids("a", "f"));
    await detachCompanyFromGroup(admin, company.f, "test");
    expect(await prisma.parentGroupMemberCompany.count({ where: { companyId: company.f } })).toBe(0);
    expect(await members(sel)).toEqual(ids("a"));
    expect((await resolveGroupCompanyAccess(sel, company.f)).allowed).toBe(false);
  });

  it("keeps ALL for a group with no companies and applies it to the first one created", async () => {
    const empty = (await addGroupUser(admin, { mode: "new", groupId: otherId, roleKey: "GROUP_IT", companyAccess: { mode: "ALL" }, firstName: "Emi", lastName: "Empty", email: EMAILS[3] })).userId;
    expect(await getGroupUserAccess(actor(), { groupId: otherId, userId: empty })).toMatchObject({ mode: "ALL" });
    const foreign = await prisma.company.findUniqueOrThrow({ where: { slug: "t10a-x" }, select: { id: true } });
    // The foreign company was created before this seat existed; ALL reaches it on the next reconcile, which creation does.
    await updateGroupUserAccess(actor(), { groupId: otherId, userId: empty, companyAccess: { mode: "NONE" } });
    await updateGroupUserAccess(actor(), { groupId: otherId, userId: empty, companyAccess: { mode: "ALL" } });
    expect((await resolveGroupCompanyAccess(empty, foreign.id)).allowed).toBe(true);
    expect(await resolveGroupCompanyAccess(empty, company.a)).toMatchObject({ allowed: false });
  });
});
