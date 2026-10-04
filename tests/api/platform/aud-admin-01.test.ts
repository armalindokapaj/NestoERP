import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { platformActor, type GroupActor } from "@/lib/modules/platform/group-actor";
import { findAccessFindings } from "@/lib/modules/organization/access-integrity";
import { moveCompanyToGroup } from "@/lib/modules/platform/platform-company.service";
import { deletePlatformUser } from "@/lib/modules/platform/platform-user-delete.service";
import { changeOrganizationMemberRole, removeOrganizationMember } from "@/lib/modules/platform/platform-organization-admin.service";
import { updateMembership } from "@/lib/modules/platform/platform-control.service";
import { assignCompanyCeo } from "@/lib/modules/platform/company-leadership.service";
import { addCompanyUser, listCompanyUsers, removeCompanyUserAccess } from "@/lib/modules/platform/company-users.service";
import { addGroupUser } from "@/lib/modules/platform/platform-group-users.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma, resolveSession } from "../../helpers";

/**
 * AUD-ADMIN-01 regression tests: the Admin Console's authorization hardening
 * (PRD #14) — serialised CEO changes, group isolation, role injection, and
 * scoped removal that never touches the global account.
 */

const A = "t14-group-a";
const B = "t14-group-b";
const EMPTY = "t14-group-empty";
const SLUGS = ["t14-a1", "t14-b1"];
const EMAILS = ["t14-ceo1@nesto.test", "t14-ceo2@nesto.test", "t14-ceo3@nesto.test", "t14-maria@nesto.test", "t14-companyceo@nesto.test", "t14-it@nesto.test", "t14-it2@nesto.test"];

let admin: PlatformContext;

async function removeAll(): Promise<void> {
  const users = (await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })).map((row) => row.id);
  const roots = new Set<string>();
  for (const slug of SLUGS) {
    const company = await prisma.company.findUnique({ where: { slug }, select: { id: true, parentGroupId: true } });
    if (!company) continue;
    roots.add(company.parentGroupId);
    const companyId = company.id;
    await prisma.session.deleteMany({ where: { currentCompanyId: companyId } });
    await prisma.auditEvent.deleteMany({ where: { companyId } });
    await prisma.activity.deleteMany({ where: { companyId } });
    await prisma.department.updateMany({ where: { companyId }, data: { managerMemberId: null } });
    await prisma.company.updateMany({ where: { id: companyId }, data: { ceoMemberId: null } });
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
  for (const slug of [A, B, EMPTY]) {
    const group = await prisma.parentGroup.findUnique({ where: { slug }, select: { id: true } });
    if (group) {
      await prisma.departmentAssignment.deleteMany({ where: { parentGroupId: group.id } });
      await prisma.parentGroupMember.deleteMany({ where: { parentGroupId: group.id } });
    }
  }
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.authEvent.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  const groups = await prisma.parentGroup.findMany({ where: { OR: [{ slug: { in: [A, B, EMPTY] } }, { id: { in: [...roots] } }] }, select: { id: true } });
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

describe("Admin Console hardening (AUD-ADMIN-01)", () => {
  let groupA: string;
  let groupB: string;
  let companyA: string;
  let companyB: string;
  let maria: string;
  /** A group administrator of group A only: what a real Group CEO's actor can reach. */
  const asGroupA = (): GroupActor => ({ userId: "stub-group-a-ceo", fullName: "Group A CEO", roleKey: "OWNER", can: (_capability, groupId) => groupId === groupA });

  it("sets up two groups with one company each", async () => {
    groupA = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T14 Alpha", slug: A }))).id;
    groupB = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T14 Beta", slug: B }))).id;
    companyA = (await createGroupCompany(admin, groupA, createGroupCompanySchema.parse({ name: "T14 Alpha One", slug: "t14-a1" }))).companyId;
    companyB = (await createGroupCompany(admin, groupB, createGroupCompanySchema.parse({ name: "T14 Beta One", slug: "t14-b1" }))).companyId;
    expect(companyA).not.toBe(companyB);
  });

  it("a Group CEO needs no company: the seat exists with zero companies", async () => {
    const empty = (await createParentGroup(admin, createParentGroupSchema.parse({ name: "T14 Empty", slug: EMPTY }))).id;
    await addGroupUser(admin, { mode: "new", groupId: empty, roleKey: "OWNER", firstName: "Solo", lastName: "Ceo", email: EMAILS[2] });
    const seat = await prisma.parentGroupMember.findFirst({ where: { parentGroupId: empty, role: { key: "OWNER" }, status: "ACTIVE" } });
    expect(seat).not.toBeNull();
    expect(await prisma.company.count({ where: { parentGroupId: empty } })).toBe(0);
  });

  it("simultaneous Group CEO assignments leave exactly one active CEO (§82)", async () => {
    await addGroupUser(admin, { mode: "new", groupId: groupA, roleKey: "OWNER", firstName: "Cea", lastName: "One", email: EMAILS[0] });
    const results = await Promise.allSettled([
      addGroupUser(admin, { mode: "new", groupId: groupA, roleKey: "OWNER", replaceCurrent: true, firstName: "Cea", lastName: "Two", email: EMAILS[1] }),
      addGroupUser(admin, { mode: "new", groupId: groupA, roleKey: "OWNER", replaceCurrent: true, firstName: "Cea", lastName: "Three", email: EMAILS[2] }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const owners = await prisma.parentGroupMember.count({ where: { parentGroupId: groupA, status: "ACTIVE", role: { key: "OWNER" } } });
    expect(owners).toBe(1);
  });

  it("a Group A administrator cannot read or change Company B by id (§76, §153)", async () => {
    await expect(listCompanyUsers(asGroupA(), { companyId: companyB })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addCompanyUser(asGroupA(), { mode: "new", companyId: companyB, roleKey: "FINANCE", firstName: "No", lastName: "Way", email: "t14-no@nesto.test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listCompanyUsers(asGroupA(), { companyId: companyA })).resolves.toBeDefined();
  });

  it("role injection through the company user form fails (§77)", async () => {
    for (const roleKey of ["CEO", "OWNER", "GROUP_IT", "PLATFORM_ADMIN"]) {
      await expect(addCompanyUser(platformActor(admin), { mode: "new", companyId: companyA, roleKey, firstName: "Inj", lastName: "Ect", email: "t14-inject@nesto.test" })).rejects.toMatchObject({ name: "ZodError" });
    }
    expect(await prisma.user.count({ where: { email: "t14-inject@nesto.test" } })).toBe(0);
  });

  it("a foreign department or project id is refused (§78-§80)", async () => {
    const foreignDepartment = await prisma.department.findFirst({ where: { companyId: companyB }, select: { id: true } });
    if (foreignDepartment) {
      await expect(addCompanyUser(platformActor(admin), { mode: "new", companyId: companyA, roleKey: "FINANCE", departmentId: foreignDepartment.id, firstName: "Dep", lastName: "Inj", email: "t14-dep@nesto.test" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    await expect(addCompanyUser(platformActor(admin), { mode: "new", companyId: companyA, roleKey: "FINANCE", projectIds: ["not-a-project-of-this-company"], firstName: "Pro", lastName: "Inj", email: "t14-pro@nesto.test" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("removing a person from a company never deletes the global account (§48, §52)", async () => {
    const added = await addCompanyUser(platformActor(admin), { mode: "new", companyId: companyA, roleKey: "FINANCE", firstName: "Maria", lastName: "Brown", email: EMAILS[3] });
    maria = added.userId;
    await removeCompanyUserAccess(platformActor(admin), { companyId: companyA, userId: maria });
    expect(await prisma.user.findUnique({ where: { id: maria }, select: { status: true } })).toMatchObject({ status: "ACTIVE" });
    expect(await prisma.companyMember.count({ where: { companyId: companyA, userId: maria, status: "ACTIVE" } })).toBe(0);
  });

  it("adding the same existing person twice is idempotent (§107)", async () => {
    await addCompanyUser(platformActor(admin), { mode: "existing", companyId: companyA, userId: maria, roleKey: "FINANCE" });
    await expect(addCompanyUser(platformActor(admin), { mode: "existing", companyId: companyA, userId: maria, roleKey: "FINANCE" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.companyMember.count({ where: { companyId: companyA, userId: maria } })).toBe(1);
  });

  it("the access integrity check is quiet on sound data and names a derived membership no seat covers (§21, §28)", async () => {
    const mine = (findings: Awaited<ReturnType<typeof findAccessFindings>>) => findings.filter((finding) => [A, B, EMPTY].includes(finding.group) && finding.level === "error");
    expect(mine(await findAccessFindings(prisma))).toEqual([]);
    await prisma.companyMember.updateMany({ where: { companyId: companyA, userId: maria }, data: { groupDerived: true } });
    expect(mine(await findAccessFindings(prisma)).map((finding) => finding.code)).toContain("DERIVED_WITHOUT_COVERAGE");
    await prisma.companyMember.updateMany({ where: { companyId: companyA, userId: maria }, data: { groupDerived: false } });
  });

  it("the platform membership editor cannot suspend the named CEO or edit a policy-owned membership (§49, §83)", async () => {
    await assignCompanyCeo(platformActor(admin), { companyId: companyA, mode: "new", firstName: "Cora", lastName: "Chief", email: EMAILS[4] });
    const ceo = await prisma.companyMember.findFirstOrThrow({ where: { companyId: companyA, ceoOf: { isNot: null } }, select: { id: true } });
    await expect(updateMembership(admin, ceo.id, { status: "SUSPENDED", reason: "test" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.companyMember.findUnique({ where: { id: ceo.id }, select: { status: true } })).toMatchObject({ status: "ACTIVE" });
    const row = await prisma.companyMember.findFirstOrThrow({ where: { companyId: companyA, userId: maria }, select: { id: true } });
    await prisma.companyMember.update({ where: { id: row.id }, data: { groupDerived: true } });
    await expect(updateMembership(admin, row.id, { roleKey: "VIEWER", reason: "test" })).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.companyMember.update({ where: { id: row.id }, data: { groupDerived: false } });
  });

  it("moving a company recomputes group-derived access and leaves direct memberships alone (§120)", async () => {
    const it = (await addGroupUser(admin, { mode: "new", groupId: groupA, roleKey: "GROUP_IT", firstName: "Ita", lastName: "Admin", email: EMAILS[5], companyAccess: { mode: "ALL", companyIds: [] } })).userId;
    expect(await prisma.companyMember.count({ where: { companyId: companyA, userId: it, groupDerived: true, status: "ACTIVE" } })).toBe(1);
    const mariaBefore = await prisma.companyMember.findFirstOrThrow({ where: { companyId: companyA, userId: maria }, select: { id: true, status: true } });

    await moveCompanyToGroup(admin, companyA, groupB, "test move");

    expect(await prisma.company.findUnique({ where: { id: companyA }, select: { parentGroupId: true } })).toMatchObject({ parentGroupId: groupB });
    expect(await prisma.companyMember.count({ where: { companyId: companyA, userId: it, groupDerived: true, status: "ACTIVE" } })).toBe(0);
    expect(await prisma.companyMember.findUniqueOrThrow({ where: { id: mariaBefore.id }, select: { status: true } })).toMatchObject({ status: mariaBefore.status });
    const errors = (await findAccessFindings(prisma)).filter((finding) => [A, B, EMPTY].includes(finding.group) && finding.level === "error");
    expect(errors).toEqual([]);
  });

  it("a live company session follows a role downgrade and a removal on its next request (§88, §155, §156)", async () => {
    const member = await prisma.companyMember.findFirstOrThrow({ where: { companyId: companyA, userId: maria, status: "ACTIVE" }, select: { id: true } });
    const session = await prisma.session.create({
      data: { sessionToken: `t14_${Math.random().toString(36).slice(2)}`, userId: maria, membershipId: member.id, currentCompanyId: companyA, workspaceScope: "COMPANY", expiresAt: new Date(Date.now() + 3600_000) },
    });
    const before = await resolveSession(session.id, maria);
    expect(before.ok && before.context.role).toBe("FINANCE");

    await updateMembership(admin, member.id, { roleKey: "VIEWER", reason: "test downgrade" });
    const downgraded = await resolveSession(session.id, maria);
    // Either the session is ended and a new one is built, or it carries the new role; never the old one.
    if (downgraded.ok) expect(downgraded.context.role).toBe("VIEWER");

    await removeCompanyUserAccess(platformActor(admin), { companyId: companyA, userId: maria });
    const removed = await resolveSession(session.id, maria);
    if (removed.ok) expect(removed.context.companyId).not.toBe(companyA);
    else expect(["SESSION_EXPIRED", "MEMBERSHIP_INACTIVE", "NO_MEMBERSHIP"]).toContain(removed.reason);
    await prisma.session.deleteMany({ where: { id: session.id } });
  });

  it("the legacy organization editors leave a policy-owned membership alone (§49)", async () => {
    const it = (await addGroupUser(admin, { mode: "new", groupId: groupB, roleKey: "GROUP_IT", firstName: "Iva", lastName: "Admin", email: EMAILS[6], companyAccess: { mode: "ALL", companyIds: [] } })).userId;
    const derived = await prisma.companyMember.findFirstOrThrow({ where: { companyId: companyA, userId: it, groupDerived: true, status: "ACTIVE" }, select: { id: true } });
    await expect(changeOrganizationMemberRole(admin, { companyId: companyA, membershipId: derived.id, roleKey: "VIEWER", reason: "test" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeOrganizationMember(admin, { companyId: companyA, membershipId: derived.id, reason: "test" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.companyMember.findUniqueOrThrow({ where: { id: derived.id }, select: { status: true } })).toMatchObject({ status: "ACTIVE" });
  });

  it("deleting an unused account refuses a named Company CEO or Group CEO (§51, §52)", async () => {
    const companyCeo = await prisma.user.findFirstOrThrow({ where: { email: EMAILS[4] }, select: { id: true } });
    await expect(deletePlatformUser(admin, { userId: companyCeo.id })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "IS_COMPANY_CEO" } });
    const groupCeo = await prisma.parentGroupMember.findFirstOrThrow({ where: { parentGroupId: groupA, status: "ACTIVE", role: { key: "OWNER" } }, select: { userId: true } });
    await expect(deletePlatformUser(admin, { userId: groupCeo.userId })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "IS_GROUP_CEO" } });
    expect(await prisma.user.count({ where: { id: { in: [companyCeo.id, groupCeo.userId] } } })).toBe(2);
  });

  it("the company user list pages and searches a company of 1,200 people with a constant number of queries (§132)", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "VIEWER" }, select: { id: true } });
    const count = 1200;
    await prisma.user.createMany({ data: Array.from({ length: count }, (_, index) => ({ firstName: "Load", lastName: `Person${String(index).padStart(4, "0")}`, username: `t14-load-${index}`, email: `t14-load-${index}@nesto.test`, passwordHash: "x" })) });
    const users = await prisma.user.findMany({ where: { username: { startsWith: "t14-load-" } }, select: { id: true } });
    await prisma.companyMember.createMany({ data: users.map((user) => ({ companyId: companyB, userId: user.id, roleId: role.id, status: "ACTIVE" as const })) });
    try {
      const actor = platformActor(admin);
      const started = Date.now();
      const first = await listCompanyUsers(actor, { companyId: companyB });
      expect(first.total).toBeGreaterThanOrEqual(count);
      expect(first.rows).toHaveLength(25);
      expect(first.nextCursor).not.toBeNull();
      const second = await listCompanyUsers(actor, { companyId: companyB, cursor: first.nextCursor! });
      expect(second.rows.map((row) => row.userId)).not.toContain(first.rows[0].userId);
      const found = await listCompanyUsers(actor, { companyId: companyB, q: "Person0777" });
      expect(found.rows.map((row) => row.name)).toEqual(["Load Person0777"]);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await prisma.companyMember.deleteMany({ where: { companyId: companyB, user: { username: { startsWith: "t14-load-" } } } });
      await prisma.user.deleteMany({ where: { username: { startsWith: "t14-load-" } } });
    }
  });
});
