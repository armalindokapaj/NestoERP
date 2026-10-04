import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { platformActor, type GroupActor } from "@/lib/modules/platform/group-actor";
import { updateGroupUserAccess } from "@/lib/modules/platform/group-company-access.service";
import {
  addCompanyUser, bulkCompanyUsers, companyUserActivity, getCompanyUserDetail, listCompanyUsers, previewCompanyUserRemoval, reactivateCompanyUserAccess,
  removeCompanyUserAccess, suspendCompanyUserAccess, updateCompanyUserAccess,
} from "@/lib/modules/platform/company-users.service";
import { addGroupUser } from "@/lib/modules/platform/platform-group-users.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * A company's people from inside the company (Admin PRD #13): one row per
 * person with the source worked out by the resolver, direct changes that never
 * touch the group seat, group-only rows that cannot be mutated here, and every
 * request confined to the company and group in it.
 */

const GROUP = "t13a-group";
const OTHER = "t13a-other";
const SLUGS = ["t13a-a", "t13a-b", "t13a-x"];
const EMAILS = ["t13a-maria@nesto.test", "t13a-besar@nesto.test", "t13a-anna@nesto.test", "t13a-new@nesto.test"];

let admin: PlatformContext;

async function purgeCompany(slug: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
  if (!company) return;
  const companyId = company.id;
  await prisma.company.update({ where: { id: companyId }, data: { ceoMemberId: null } });
  await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
  await prisma.auditEvent.deleteMany({ where: { companyId } });
  await prisma.activity.deleteMany({ where: { companyId } });
  await prisma.projectMember.deleteMany({ where: { companyId } });
  await prisma.project.deleteMany({ where: { companyId } });
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

async function removeAll(): Promise<void> {
  const users = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((row) => row.id);
  const rootIds = new Set<string>();
  for (const slug of SLUGS) {
    const company = await prisma.company.findUnique({ where: { slug }, select: { parentGroupId: true } });
    if (company) rootIds.add(company.parentGroupId);
    await purgeCompany(slug);
  }
  for (const slug of [GROUP, OTHER]) {
    const group = await prisma.parentGroup.findUnique({ where: { slug }, select: { id: true } });
    if (!group) continue;
    await prisma.departmentAssignment.deleteMany({ where: { parentGroupId: group.id } });
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId: group.id } });
  }
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

describe("company users (PRD #13)", () => {
  const actor = () => platformActor(admin);
  let groupId: string;
  let otherGroupId: string;
  let a: string;
  let b: string;
  let foreign: string;
  let maria: string; // group seat covering A (ALL) — becomes BOTH when given a direct role
  let anna: string; // group seat only
  let besar: string; // direct only
  let projectA: string;
  let departmentA: string;
  let ceoMember: string;

  const row = async (companyId: string, userId: string) => (await listCompanyUsers(actor(), { companyId })).rows.find((item) => item.userId === userId);
  const rowsOf = async (companyId: string) => (await listCompanyUsers(actor(), { companyId })).rows;

  it("lists group-covered people once, as GROUP, without a fake direct membership", async () => {
    groupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T13 Holdings", slug: GROUP }))).id;
    a = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "T13 A", slug: "t13a-a" }))).companyId;
    b = (await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "T13 B", slug: "t13a-b" }))).companyId;
    maria = (await addGroupUser(admin, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Maria", lastName: "Brown", email: EMAILS[0] })).userId;
    anna = (await addGroupUser(admin, { mode: "new", groupId, roleKey: "GROUP_IT", firstName: "Anna", lastName: "Smith", email: EMAILS[2] })).userId;
    expect((await listCompanyUsers(actor(), { companyId: a })).total).toBe(0);
    await updateGroupUserAccess(actor(), { groupId, userId: maria, companyAccess: { mode: "ALL" } });
    await updateGroupUserAccess(actor(), { groupId, userId: anna, companyAccess: { mode: "SELECTED", companyIds: [a] } });
    const rows = await rowsOf(a);
    expect(rows.map((item) => [item.userId, item.source]).sort()).toEqual([[anna, "GROUP"], [maria, "GROUP"]].sort());
    expect(await prisma.companyMember.count({ where: { companyId: a, groupDerived: false } })).toBe(0);
    expect((await rowsOf(b)).map((item) => item.userId)).toEqual([maria]);
  });

  it("adds a new account with a required role: one user, one membership, source DIRECT", async () => {
    projectA = (await prisma.project.create({ data: { companyId: a, code: "T13-A1", name: "T13 Eyes", status: "ACTIVE", createdBy: admin.userId }, select: { id: true } })).id;
    departmentA = (await prisma.department.create({ data: { companyId: a, name: "T13 Finance" }, select: { id: true } })).id;
    await expect(addCompanyUser(actor(), { mode: "new", companyId: a, roleKey: "CEO", firstName: "No", lastName: "Ceo", email: EMAILS[3] })).rejects.toBeTruthy();
    await expect(addCompanyUser(actor(), { mode: "new", companyId: a, roleKey: "PLATFORM_ADMIN", firstName: "No", lastName: "Admin", email: EMAILS[3] })).rejects.toBeTruthy();
    const added = await addCompanyUser(actor(), { mode: "new", companyId: a, roleKey: "ARCHITECT", firstName: "Besar", lastName: "Zifla", email: EMAILS[1], departmentId: departmentA, jobTitle: "Senior Architect", projectIds: [projectA] });
    besar = added.userId;
    expect(added.source).toBe("DIRECT");
    expect(await prisma.user.count({ where: { email: EMAILS[1] } })).toBe(1);
    expect(await prisma.companyMember.count({ where: { companyId: a, userId: besar } })).toBe(1);
    expect(await row(a, besar)).toMatchObject({ source: "DIRECT", directRoleKey: "ARCHITECT", jobTitle: "Senior Architect", projects: 1, department: { id: departmentA } });
    // The same address again offers the account, never a duplicate identity.
    await expect(addCompanyUser(actor(), { mode: "new", companyId: a, roleKey: "ARCHITECT", firstName: "Besar", lastName: "Again", email: EMAILS[1] })).rejects.toMatchObject({ details: { code: "ACCOUNT_EXISTS", userId: besar } });
    expect(await prisma.user.count({ where: { email: EMAILS[1] } })).toBe(1);
  });

  it("adding direct access to a group-covered person makes ONE row, BOTH, and leaves the seat alone", async () => {
    const seatBefore = await prisma.parentGroupMember.findFirstOrThrow({ where: { userId: maria, parentGroupId: groupId }, select: { companyAccessMode: true, accessVersion: true, role: { select: { key: true } } } });
    const added = await addCompanyUser(actor(), { mode: "existing", companyId: a, userId: maria, roleKey: "FINANCE", departmentId: departmentA });
    expect(added.source).toBe("BOTH");
    expect(await prisma.companyMember.count({ where: { companyId: a, userId: maria } })).toBe(1);
    expect(await row(a, maria)).toMatchObject({ source: "BOTH", directRoleKey: "FINANCE", groupRole: "Group IT" });
    expect((await rowsOf(a)).filter((item) => item.userId === maria)).toHaveLength(1);
    expect(await prisma.parentGroupMember.findFirstOrThrow({ where: { userId: maria, parentGroupId: groupId }, select: { companyAccessMode: true, accessVersion: true, role: { select: { key: true } } } })).toEqual(seatBefore);
    // Idempotent: a second submission is refused, not duplicated.
    await expect(addCompanyUser(actor(), { mode: "existing", companyId: a, userId: maria, roleKey: "FINANCE" })).rejects.toMatchObject({ details: { code: "ALREADY_MEMBER" } });
    expect(await prisma.companyMember.count({ where: { companyId: a, userId: maria } })).toBe(1);
  });

  it("filters by source, role, department and search across the whole set", async () => {
    const ids = async (input: Record<string, string>) => (await listCompanyUsers(actor(), { companyId: a, ...input })).rows.map((item) => item.userId).sort();
    expect(await ids({ source: "DIRECT" })).toEqual([besar]);
    expect(await ids({ source: "GROUP" })).toEqual([anna]);
    expect(await ids({ source: "BOTH" })).toEqual([maria]);
    expect(await ids({ role: "FINANCE" })).toEqual([maria]);
    expect(await ids({ departmentId: departmentA })).toEqual([besar, maria].sort());
    expect(await ids({ projectId: projectA })).toEqual([besar]);
    expect(await ids({ q: "zifla" })).toEqual([besar]);
    expect(await ids({ q: EMAILS[2] })).toEqual([anna]);
    expect((await listCompanyUsers(actor(), { companyId: a })).total).toBe(3);
  });

  it("edits role, department, position and projects together without touching the group role, and audits it", async () => {
    const detail = await getCompanyUserDetail(actor(), { companyId: a, userId: maria });
    expect(detail.groupAccess?.roleName).toBe("Group IT");
    await updateCompanyUserAccess(actor(), { companyId: a, userId: maria, roleKey: "LEGAL", jobTitle: "Head of Legal", projectIds: [projectA], expectedVersion: detail.version });
    const changed = await row(a, maria);
    expect(changed).toMatchObject({ source: "BOTH", directRoleKey: "LEGAL", jobTitle: "Head of Legal", projects: 1, department: { id: departmentA } });
    // Role change leaves the department alone (§54).
    expect(changed?.department?.id).toBe(departmentA);
    const seat = await prisma.parentGroupMember.findFirstOrThrow({ where: { userId: maria, parentGroupId: groupId }, select: { role: { select: { key: true } } } });
    expect(seat.role?.key).toBe("GROUP_IT");
    expect((await companyUserActivity(actor(), { companyId: a, userId: maria })).rows.map((item) => item.actionKey)).toEqual(expect.arrayContaining(["COMPANY_USER_ACCESS_CHANGED", "PLATFORM_ORGANIZATION_USER_PROJECTS_CHANGED"]));
    // Nothing to change: no write, no audit.
    const events = await prisma.auditEvent.count({ where: { companyId: a, entityId: changed?.membershipId } });
    expect((await updateCompanyUserAccess(actor(), { companyId: a, userId: maria, roleKey: "LEGAL", projectIds: [projectA] })).changed).toBe(false);
    expect(await prisma.auditEvent.count({ where: { companyId: a, entityId: changed?.membershipId } })).toBe(events);
    // A stale form is refused.
    await expect(updateCompanyUserAccess(actor(), { companyId: a, userId: maria, jobTitle: "Stale", expectedVersion: detail.version })).rejects.toMatchObject({ details: { code: "ACCESS_CHANGED" } });
  });

  it("rolls the whole save back when one part is invalid", async () => {
    const before = await row(a, besar);
    const foreignProject = (await prisma.project.create({ data: { companyId: b, code: "T13-B1", name: "T13 Other", status: "ACTIVE", createdBy: admin.userId }, select: { id: true } })).id;
    await expect(updateCompanyUserAccess(actor(), { companyId: a, userId: besar, roleKey: "ENGINEER", jobTitle: "Changed", projectIds: [foreignProject] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await row(a, besar)).toEqual(before);
    const foreignDepartment = (await prisma.department.create({ data: { companyId: b, name: "T13 Foreign" }, select: { id: true } })).id;
    await expect(updateCompanyUserAccess(actor(), { companyId: a, userId: besar, departmentId: foreignDepartment })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await row(a, besar)).toEqual(before);
    // A role outside the company's list is refused whole.
    await expect(updateCompanyUserAccess(actor(), { companyId: a, userId: besar, roleKey: "PLATFORM_ADMIN" })).rejects.toBeTruthy();
    await expect(updateCompanyUserAccess(actor(), { companyId: a, userId: besar, roleKey: "GROUP_IT" })).rejects.toBeTruthy();
    expect(await row(a, besar)).toEqual(before);
  });

  it("will not edit or remove a group-only person here", async () => {
    await expect(updateCompanyUserAccess(actor(), { companyId: a, userId: anna, jobTitle: "Nope" })).rejects.toMatchObject({ details: { code: "GROUP_ONLY" } });
    await expect(removeCompanyUserAccess(actor(), { companyId: a, userId: anna })).rejects.toMatchObject({ details: { code: "GROUP_ONLY" } });
    await expect(suspendCompanyUserAccess(actor(), { companyId: a, userId: anna })).rejects.toMatchObject({ details: { code: "GROUP_ONLY" } });
    expect(await row(a, anna)).toMatchObject({ source: "GROUP", membershipStatus: "ACTIVE" });
    expect((await previewCompanyUserRemoval(actor(), { companyId: a, userId: anna })).blocked).toBe("GROUP_ONLY");
    const detail = await getCompanyUserDetail(actor(), { companyId: a, userId: anna });
    expect(detail.can).toMatchObject({ editAccess: false, removeDirect: false, suspend: false, manageGroupAccess: true });
    const bulk = await bulkCompanyUsers(actor(), { companyId: a, userIds: [anna, besar], operation: { type: "department", departmentId: departmentA } });
    expect(bulk.done).toEqual([besar]);
    expect(bulk.skipped.map((item) => item.userId)).toEqual([anna]);
  });

  it("suspends and reactivates direct-only access, and refuses to suspend a mixed one", async () => {
    await suspendCompanyUserAccess(actor(), { companyId: a, userId: besar });
    expect(await row(a, besar)).toMatchObject({ membershipStatus: "SUSPENDED", effective: "SUSPENDED" });
    await reactivateCompanyUserAccess(actor(), { companyId: a, userId: besar });
    expect(await row(a, besar)).toMatchObject({ membershipStatus: "ACTIVE", effective: "ACTIVE" });
    await expect(suspendCompanyUserAccess(actor(), { companyId: a, userId: maria })).rejects.toMatchObject({ details: { code: "SUSPEND_MIXED" } });
    expect(await row(a, maria)).toMatchObject({ membershipStatus: "ACTIVE" });
  });

  it("removes direct access from a mixed person: BOTH becomes GROUP, the person stays, the seat is untouched", async () => {
    const preview = await previewCompanyUserRemoval(actor(), { companyId: a, userId: maria });
    expect(preview).toMatchObject({ kind: "BOTH", stillViaGroup: { roleName: "Group IT" }, blocked: null });
    expect(preview.projects).toEqual(["T13 Eyes"]);
    expect(await removeCompanyUserAccess(actor(), { companyId: a, userId: maria })).toEqual({ stillViaGroup: true });
    expect(await row(a, maria)).toMatchObject({ source: "GROUP", directRole: null, projects: 0 });
    expect(await prisma.user.count({ where: { id: maria } })).toBe(1);
    expect(await prisma.parentGroupMember.count({ where: { userId: maria, parentGroupId: groupId, status: "ACTIVE" } })).toBe(1);
    const events = await prisma.auditEvent.findMany({ where: { companyId: a, actionKey: "COMPANY_DIRECT_ACCESS_REMOVED" }, select: { afterJson: true } });
    expect(events.some((event) => (event.afterJson as { stillViaGroup?: boolean }).stillViaGroup === true)).toBe(true);
  });

  it("removes a direct-only person from the company without deleting the account or their other companies", async () => {
    await addCompanyUser(actor(), { mode: "existing", companyId: b, userId: besar, roleKey: "ENGINEER" });
    expect(await removeCompanyUserAccess(actor(), { companyId: a, userId: besar })).toEqual({ stillViaGroup: false });
    expect(await row(a, besar)).toBeUndefined();
    expect(await row(b, besar)).toMatchObject({ source: "DIRECT" });
    expect(await prisma.user.count({ where: { id: besar } })).toBe(1);
    expect(await prisma.projectMember.count({ where: { companyId: a, member: { userId: besar }, status: "ACTIVE" } })).toBe(0);
    await expect(getCompanyUserDetail(actor(), { companyId: a, userId: besar })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("protects the Company CEO from role change, suspension and removal here", async () => {
    ceoMember = (await prisma.companyMember.findFirstOrThrow({ where: { companyId: a, userId: maria }, select: { id: true } })).id;
    await addCompanyUser(actor(), { mode: "existing", companyId: a, userId: maria, roleKey: "FINANCE" });
    ceoMember = (await prisma.companyMember.findFirstOrThrow({ where: { companyId: a, userId: maria }, select: { id: true } })).id;
    await prisma.company.update({ where: { id: a }, data: { ceoMemberId: ceoMember } });
    expect(await row(a, maria)).toMatchObject({ isCeo: true });
    await expect(updateCompanyUserAccess(actor(), { companyId: a, userId: maria, roleKey: "ARCHITECT" })).rejects.toMatchObject({ details: { code: "IS_COMPANY_CEO" } });
    await expect(suspendCompanyUserAccess(actor(), { companyId: a, userId: maria })).rejects.toBeTruthy();
    await expect(removeCompanyUserAccess(actor(), { companyId: a, userId: maria })).rejects.toMatchObject({ details: { code: "IS_COMPANY_CEO" } });
    // Other access (position) can still be edited.
    expect((await updateCompanyUserAccess(actor(), { companyId: a, userId: maria, jobTitle: "Chief" })).changed).toBe(true);
    expect(await row(a, maria)).toMatchObject({ directRoleKey: "FINANCE", jobTitle: "Chief" });
  });

  it("answers 403 for a company outside the actor's group and for a company that does not exist", async () => {
    otherGroupId = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T13 Other", slug: OTHER }))).id;
    foreign = (await createGroupCompany(admin, otherGroupId, createGroupCompanySchema.parse({ name: "T13 X", slug: "t13a-x" }))).companyId;
    const seat: GroupActor = { userId: "seat-user", fullName: "Group Seat", roleKey: "GROUP_IT", can: (capability, forGroup) => forGroup === groupId && (capability === "users.view" || capability === "users.manage") };
    expect((await listCompanyUsers(seat, { companyId: a })).total).toBeGreaterThan(0);
    await expect(listCompanyUsers(seat, { companyId: foreign })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listCompanyUsers(seat, { companyId: "nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getCompanyUserDetail(seat, { companyId: foreign, userId: maria })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addCompanyUser(seat, { mode: "existing", companyId: foreign, userId: maria, roleKey: "FINANCE" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeCompanyUserAccess(seat, { companyId: foreign, userId: maria })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A viewer sees, and is refused every change.
    const viewer: GroupActor = { ...seat, can: (capability, forGroup) => forGroup === groupId && capability === "users.view" };
    expect((await listCompanyUsers(viewer, { companyId: a })).can.manage).toBe(false);
    await expect(updateCompanyUserAccess(viewer, { companyId: a, userId: maria, jobTitle: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Someone from another organization cannot be added.
    const stranger = await prisma.user.findFirstOrThrow({ where: { personProfile: { parentGroupId: otherGroupId } } }).catch(() => null);
    expect(stranger).toBeNull();
  });

  it("recomputes group-derived users when the group's access changes", async () => {
    await updateGroupUserAccess(actor(), { groupId, userId: anna, companyAccess: { mode: "NONE" } });
    expect(await row(a, anna)).toBeUndefined();
    await updateGroupUserAccess(actor(), { groupId, userId: anna, companyAccess: { mode: "ALL" } });
    expect(await row(a, anna)).toMatchObject({ source: "GROUP" });
    expect(await row(b, anna)).toMatchObject({ source: "GROUP" });
  });
});
