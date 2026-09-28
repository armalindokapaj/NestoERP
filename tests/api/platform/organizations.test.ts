import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { attachCompanyToGroup, createCompany, detachCompanyFromGroup, moveCompanyToGroup } from "@/lib/modules/platform/platform-company.service";
import { setCompanyStatus } from "@/lib/modules/platform/platform-control.service";
import { dashboardSummary } from "@/lib/modules/platform/platform-dashboard.query";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { organizationProjects, organizationUsage, organizationUsers } from "@/lib/modules/platform/platform-organization-detail.query";
import { listOrganizations } from "@/lib/modules/platform/platform-organizations.query";
import { createCompanySchema, createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Organizations management (Organizations PRD §3-§31, §45-§55, §90-§96).
 */

const PREFIX = "T-ORG";
let admin: PlatformContext;
const ids = { groupA: "", groupB: "", company: "", standalone: "" };

async function removeCompany(companyId: string) {
  for (const model of ["candidateProfile", "companyNumberingScheme", "companyStorageQuota", "financeSettings", "companyIntegrationSettings", "companySettings", "companyModule", "departmentAssignment", "department", "projectType", "projectUnitType", "activity", "companyMember"] as const) {
    const where = model === "candidateProfile" ? { targetCompanyId: companyId } : { companyId };
    await (prisma[model] as unknown as { deleteMany: (args: object) => Promise<unknown> }).deleteMany({ where });
  }
  await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId }, { entityId: companyId }] } });
  await prisma.company.delete({ where: { id: companyId } });
}

async function removeAll() {
  const companies = await prisma.company.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true, parentGroupId: true } });
  for (const company of companies) await removeCompany(company.id);
  const roots = await prisma.parentGroup.findMany({ where: { OR: [{ name: { startsWith: PREFIX } }, { id: { in: companies.map((row) => row.parentGroupId) } }] }, select: { id: true } });
  for (const root of roots) {
    if (await prisma.company.count({ where: { parentGroupId: root.id } })) continue;
    await prisma.auditEvent.deleteMany({ where: { parentGroupId: root.id } });
    await prisma.parentGroupMember.deleteMany({ where: { parentGroupId: root.id } });
    await prisma.personProfile.deleteMany({ where: { parentGroupId: root.id } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: root.id } });
    await prisma.parentGroup.delete({ where: { id: root.id } });
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

describe("Organizations management", () => {
  it("creates a Parent Group and a group company from their names alone (§3, §18, §26, §91)", async () => {
    ids.groupA = (await createParentGroup(admin, createParentGroupSchema.parse({ name: `${PREFIX} Alpha Group` }))).id;
    ids.groupB = (await createParentGroup(admin, createParentGroupSchema.parse({ name: `${PREFIX} Beta Group`, slug: "" }))).id;
    const groupA = await prisma.parentGroup.findUniqueOrThrow({ where: { id: ids.groupA } });
    expect(groupA.slug).toBe("t-org-alpha-group");
    expect(groupA.kind).toBe("GROUP");

    ids.company = (await createGroupCompany(admin, ids.groupA, createGroupCompanySchema.parse({ name: `${PREFIX} Construction` }))).companyId;
    expect((await prisma.company.findUniqueOrThrow({ where: { id: ids.company } })).parentGroupId).toBe(ids.groupA);
    ids.standalone = (await createCompany(admin, createCompanySchema.parse({ name: `${PREFIX} Studio` }))).companyId;

    expect(() => createCompanySchema.parse({ name: "   " })).toThrow();
    expect(await prisma.auditEvent.count({ where: { parentGroupId: ids.groupA, actionKey: "PLATFORM_PARENT_GROUP_CREATED" } })).toBe(1);
  });

  it("lists each organization once under All / Groups / Companies / Standalone, with search (§6, §9, §10, §95)", async () => {
    const all = await listOrganizations(admin, { q: PREFIX });
    expect(all.rows.map((row) => `${row.type}:${row.name}`).sort()).toEqual([
      `Company:${PREFIX} Construction`, `Group:${PREFIX} Alpha Group`, `Group:${PREFIX} Beta Group`, `Standalone:${PREFIX} Studio`,
    ]);
    expect((await listOrganizations(admin, { q: PREFIX, type: "group" })).rows.every((row) => row.type === "Group")).toBe(true);
    expect((await listOrganizations(admin, { q: PREFIX, type: "company" })).rows.map((row) => row.name).sort()).toEqual([`${PREFIX} Construction`, `${PREFIX} Studio`]);
    expect((await listOrganizations(admin, { q: PREFIX, type: "standalone" })).rows.map((row) => row.name)).toEqual([`${PREFIX} Studio`]);
    const inA = await listOrganizations(admin, { q: PREFIX, group: ids.groupA });
    expect(inA.rows.map((row) => row.name)).toEqual([`${PREFIX} Construction`]);
    expect(inA.rows[0].parentGroup?.id).toBe(ids.groupA);
  });

  it("filters by status, sorts stably and survives junk parameters (§11, §12)", async () => {
    const implementing = await listOrganizations(admin, { q: PREFIX, status: "IMPLEMENTING" });
    expect(implementing.rows.every((row) => row.type === "Group")).toBe(true);
    expect((await listOrganizations(admin, { q: PREFIX, status: "INACTIVE" })).rows).toHaveLength(0);
    const desc = await listOrganizations(admin, { q: PREFIX, sort: "name", dir: "desc" });
    expect(desc.rows.map((row) => row.name)).toEqual([...desc.rows.map((row) => row.name)].sort((a, b) => b.localeCompare(a)));
    const again = await listOrganizations(admin, { q: PREFIX, sort: "projects" });
    expect((await listOrganizations(admin, { q: PREFIX, sort: "projects" })).rows.map((row) => row.id)).toEqual(again.rows.map((row) => row.id));
    const junk = await listOrganizations(admin, { type: "nonsense", sort: "evil", page: "-4" });
    expect(junk.query).toMatchObject({ type: "all", sort: "name", page: 1 });
  });

  it("moves a group company to another group in one step, keeping its id and data (§31, §32, §92)", async () => {
    const before = await prisma.company.findUniqueOrThrow({ where: { id: ids.company }, select: { slug: true, _count: { select: { modules: true, departments: true } } } });
    await moveCompanyToGroup(admin, ids.company, ids.groupB, "Restructuring");
    const after = await prisma.company.findUniqueOrThrow({ where: { id: ids.company }, select: { parentGroupId: true, slug: true, _count: { select: { modules: true, departments: true } } } });
    expect(after.parentGroupId).toBe(ids.groupB);
    expect(after.slug).toBe(before.slug);
    expect(after._count).toEqual(before._count);
    expect(await prisma.auditEvent.count({ where: { entityId: ids.company, actionKey: "PLATFORM_COMPANY_MOVED_BETWEEN_GROUPS" } })).toBe(2);
    // No standalone root was left behind by the move.
    expect(await prisma.parentGroup.count({ where: { name: `${PREFIX} Construction`, kind: "STANDALONE" } })).toBe(0);
    await expect(moveCompanyToGroup(admin, ids.company, ids.groupB, "Again")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(moveCompanyToGroup(admin, ids.standalone, ids.groupA, "Standalone")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("attaches a standalone company and detaches it again (§25, §27, §29, §92)", async () => {
    await attachCompanyToGroup(admin, ids.standalone, ids.groupA, "Joining");
    expect((await listOrganizations(admin, { q: PREFIX, type: "standalone" })).rows).toHaveLength(0);
    await detachCompanyFromGroup(admin, ids.standalone, "Leaving");
    const row = (await listOrganizations(admin, { q: PREFIX, type: "standalone" })).rows[0];
    expect(row).toMatchObject({ id: ids.standalone, type: "Standalone", parentGroup: null });
  });

  it("suspends and reactivates without deleting anything (§45-§47, §54, §94)", async () => {
    const modules = await prisma.companyModule.count({ where: { companyId: ids.standalone } });
    await setCompanyStatus(admin, ids.standalone, "SUSPENDED", "Unpaid");
    expect((await listOrganizations(admin, { q: PREFIX, status: "SUSPENDED" })).rows.map((row) => row.id)).toEqual([ids.standalone]);
    await setCompanyStatus(admin, ids.standalone, "ACTIVE", "Paid");
    expect(await prisma.companyModule.count({ where: { companyId: ids.standalone } })).toBe(modules);
  });

  it("reads tabs from canonical records, and the dashboard agrees on the company count (§33-§41, §96)", async () => {
    expect(await organizationProjects(admin, { kind: "group", groupId: ids.groupB })).toEqual([]);
    expect(await organizationUsers(admin, { kind: "company", companyId: ids.standalone })).toEqual([]);
    const usage = await organizationUsage(admin, { kind: "group", groupId: ids.groupB });
    expect(usage).toMatchObject({ companies: 1, projects: 0, users: 0 });
    const summary = await dashboardSummary(admin);
    expect(summary.organizations.companies).toBe((await listOrganizations(admin, { type: "company" })).total);
  });
});
