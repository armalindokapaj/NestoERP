import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { createPlatformProject } from "@/lib/modules/platform/platform-control.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { organizationMember, organizationRoles, organizationUsers } from "@/lib/modules/platform/platform-organization-detail.query";
import { addOrganizationUser, changeOrganizationMemberRole, eligibleOrganizationUsers, removeOrganizationMember, setOrganizationMemberProjects } from "@/lib/modules/platform/platform-organization-admin.service";
import { projectCreateSchema } from "@/lib/modules/platform/platform-control.schema";
import { createCompanySchema, createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Managing an organization from inside it (Admin Organization-Scoped PRD #7
 * §14-§24, §61-§66, §82, §92, §109-§116).
 */

const PREFIX = "T-OSA";
const EMAIL = "t-osa.anna@example.com";
let admin: PlatformContext;
const ids = { group: "", a: "", b: "", standalone: "", projectA: "", projectB: "", anna: "", annaA: "", annaB: "" };

async function removeAll() {
  const companies = await prisma.company.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true, parentGroupId: true } });
  const companyIds = companies.map((row) => row.id);
  const roots = [...new Set(companies.map((row) => row.parentGroupId))];
  const users = await prisma.user.findMany({ where: { personProfile: { parentGroupId: { in: roots } } }, select: { id: true } });
  const userIds = users.map((row) => row.id);
  await prisma.projectMember.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.project.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  for (const companyId of companyIds) {
    for (const model of ["companyNumberingScheme", "companyStorageQuota", "financeSettings", "companyIntegrationSettings", "companySettings", "companyModule", "departmentAssignment", "companyMember", "department", "projectType", "projectUnitType", "activity", "companyEntitlement"] as const) {
      await (prisma[model] as unknown as { deleteMany: (args: object) => Promise<unknown> }).deleteMany({ where: { companyId } });
    }
  }
  await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { parentGroupId: { in: roots } }, { entityId: { in: [...companyIds, ...userIds] } }] } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  for (const root of roots) {
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId: root } });
    await prisma.departmentAssignment.deleteMany({ where: { parentGroupId: root } });
    await prisma.personProfile.deleteMany({ where: { parentGroupId: root } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: root } });
    await prisma.parentGroup.deleteMany({ where: { id: root } });
  }
}

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
  ids.group = (await createParentGroup(admin, createParentGroupSchema.parse({ name: `${PREFIX} Group` }))).id;
  ids.a = (await createGroupCompany(admin, ids.group, createGroupCompanySchema.parse({ name: `${PREFIX} Construction` }))).companyId;
  ids.b = (await createGroupCompany(admin, ids.group, createGroupCompanySchema.parse({ name: `${PREFIX} Development` }))).companyId;
  ids.standalone = (await createCompany(admin, createCompanySchema.parse({ name: `${PREFIX} Texas` }))).companyId;
  ids.projectA = (await createPlatformProject(admin, projectCreateSchema.parse({ companyId: ids.a, name: `${PREFIX} Tower` }))).id;
  ids.projectB = (await createPlatformProject(admin, projectCreateSchema.parse({ companyId: ids.b, name: `${PREFIX} Plaza` }))).id;
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("organization-scoped users", () => {
  it("creates an account with its person, membership, role and projects in one step (§15, §16, §92)", async () => {
    const added = await addOrganizationUser(admin, { mode: "new", companyId: ids.a, firstName: "Anna", lastName: "Brown", email: EMAIL, roleKey: "ARCHITECT", projectIds: [ids.projectA] });
    expect(added.temporaryPassword).toBeTruthy();
    ids.anna = added.userId;
    ids.annaA = added.membershipId;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ids.anna }, select: { personProfile: { select: { parentGroupId: true } }, memberships: { select: { companyId: true, role: { select: { key: true } } } } } });
    expect(user.personProfile?.parentGroupId).toBe(ids.group);
    expect(user.memberships).toEqual([{ companyId: ids.a, role: { key: "ARCHITECT" } }]);
    expect(await prisma.projectMember.count({ where: { companyMemberId: ids.annaA, projectId: ids.projectA, status: "ACTIVE" } })).toBe(1);
    // The organization is on the audit event (§82, §83).
    expect(await prisma.auditEvent.count({ where: { actionKey: "PLATFORM_ORGANIZATION_USER_ADDED", companyId: ids.a, parentGroupId: ids.group } })).toBe(1);
  });

  it("refuses a second account for the same email and names the existing one (§18)", async () => {
    await expect(addOrganizationUser(admin, { mode: "new", companyId: ids.b, firstName: "Anna", lastName: "Again", email: EMAIL.toUpperCase(), roleKey: "FINANCE" })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "ACCOUNT_EXISTS", userId: ids.anna } });
    expect(await prisma.user.count({ where: { email: { equals: EMAIL, mode: "insensitive" } } })).toBe(1);
  });

  it("adds the existing account to another company without touching the first role (§17, §64, §110)", async () => {
    expect((await eligibleOrganizationUsers(admin, ids.b, "anna")).map((row) => row.id)).toEqual([ids.anna]);
    expect(await eligibleOrganizationUsers(admin, ids.a, "anna")).toEqual([]);
    expect(await eligibleOrganizationUsers(admin, ids.standalone, "anna")).toEqual([]);
    ids.annaB = (await addOrganizationUser(admin, { mode: "existing", companyId: ids.b, userId: ids.anna, roleKey: "FINANCE" })).membershipId;
    await changeOrganizationMemberRole(admin, { companyId: ids.b, membershipId: ids.annaB, roleKey: "SALES" });
    const roles = await prisma.companyMember.findMany({ where: { userId: ids.anna }, select: { companyId: true, role: { select: { key: true } } }, orderBy: { companyId: "asc" } });
    expect(Object.fromEntries(roles.map((row) => [row.companyId, row.role.key]))).toEqual({ [ids.a]: "ARCHITECT", [ids.b]: "SALES" });
  });

  it("refuses a user of another organization and a membership named under the wrong company (§62, §63)", async () => {
    await expect(addOrganizationUser(admin, { mode: "existing", companyId: ids.standalone, userId: ids.anna, roleKey: "FINANCE" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(changeOrganizationMemberRole(admin, { companyId: ids.a, membershipId: ids.annaB, roleKey: "HR" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setOrganizationMemberProjects(admin, { companyId: ids.a, membershipId: ids.annaA, projectIds: [ids.projectB] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(addOrganizationUser(admin, { mode: "new", companyId: ids.a, firstName: "Owen", lastName: "Er", email: "t-osa.owner@example.com", roleKey: "OWNER" })).rejects.toThrow();
  });

  it("shows each company only its own users, and the group all of them (§11, §12, §116, §119)", async () => {
    const a = await organizationUsers(admin, { kind: "company", companyId: ids.a });
    expect(a.rows.map((row) => row.membershipId)).toEqual([ids.annaA]);
    expect((await organizationUsers(admin, { kind: "company", companyId: ids.standalone }, { q: "anna" })).rows).toEqual([]);
    expect((await organizationUsers(admin, { kind: "group", groupId: ids.group }, { q: "anna" })).rows).toHaveLength(2);
    expect((await organizationUsers(admin, { kind: "group", groupId: ids.group }, { role: "SALES" })).rows.map((row) => row.company?.id)).toEqual([ids.b]);
    expect((await organizationUsers(admin, { kind: "company", companyId: ids.a }, { project: ids.projectA })).rows).toHaveLength(1);
    expect(await organizationMember(admin, { kind: "company", companyId: ids.b }, ids.annaA)).toBeNull();
    const roles = await organizationRoles(admin, { kind: "company", companyId: ids.a });
    expect(roles.roles.find((row) => row.key === "ARCHITECT")?.users).toBe(1);
    expect(roles.roles.some((row) => row.key === "PLATFORM_ADMIN")).toBe(false);
  });

  it("removes company access and nothing else: the account and the other company stay (§20, §21, §111)", async () => {
    await removeOrganizationMember(admin, { companyId: ids.a, membershipId: ids.annaA });
    const rows = await prisma.companyMember.findMany({ where: { userId: ids.anna }, select: { companyId: true, status: true } });
    expect(Object.fromEntries(rows.map((row) => [row.companyId, row.status]))).toEqual({ [ids.a]: "INACTIVE", [ids.b]: "ACTIVE" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.anna } })).status).toBe("ACTIVE");
    expect(await prisma.projectMember.count({ where: { companyMemberId: ids.annaA, status: "ACTIVE" } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { actionKey: "PLATFORM_ORGANIZATION_USER_REMOVED", companyId: ids.a } })).toBe(1);
    // Coming back reuses the one membership of that company.
    expect((await addOrganizationUser(admin, { mode: "existing", companyId: ids.a, userId: ids.anna, roleKey: "ENGINEER" })).membershipId).toBe(ids.annaA);
  });
});
