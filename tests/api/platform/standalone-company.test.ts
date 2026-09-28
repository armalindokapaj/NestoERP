import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { attachCompanyToGroup, createCompany, detachCompanyFromGroup, getPlatformCompanyOverview, previewDetach } from "@/lib/modules/platform/platform-company.service";
import { createGroupCompany, createParentGroup } from "@/lib/modules/platform/platform-implementation.service";
import { createCompanySchema, createGroupCompanySchema, createParentGroupSchema } from "@/lib/modules/platform/platform.schema";
import { listParentGroups } from "@/lib/modules/platform/platform.service";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Companies without a Parent Group (Simplified Company Creation §2-§12).
 *
 * A name alone makes a company with its own standalone root, which is never
 * listed as a group. Attaching it to a group keeps its id and moves its people
 * and departments; detaching it moves them out again, and is refused while
 * someone also works in another company of the group.
 */

const NAME = "T-SC Armaar Construction";
const GROUP = "t-sc-group";
const SIBLING = "t-sc-sibling";

let admin: PlatformContext;

async function removeCompany(companyId: string): Promise<void> {
  await prisma.candidateProfile.deleteMany({ where: { targetCompanyId: companyId } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId }, { entityId: companyId }] } });
  await prisma.activity.deleteMany({ where: { companyId } });
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

async function removeRoot(parentGroupId: string): Promise<void> {
  await prisma.candidateProfile.deleteMany({ where: { parentGroupId } });
  await prisma.personProfile.deleteMany({ where: { parentGroupId } });
  await prisma.auditEvent.deleteMany({ where: { parentGroupId } });
  await prisma.groupDepartment.deleteMany({ where: { parentGroupId } });
  await prisma.parentGroup.delete({ where: { id: parentGroupId } });
}

async function removeAll(): Promise<void> {
  const companies = await prisma.company.findMany({ where: { OR: [{ name: NAME }, { slug: SIBLING }] }, select: { id: true, parentGroupId: true } });
  for (const company of companies) await removeCompany(company.id);
  const roots = await prisma.parentGroup.findMany({ where: { OR: [{ slug: GROUP }, { name: NAME, kind: "STANDALONE" }, { id: { in: companies.map((row) => row.parentGroupId) } }] }, select: { id: true } });
  for (const root of roots) await removeRoot(root.id);
}

async function candidate(parentGroupId: string, companyId: string, personProfileId?: string) {
  const person = personProfileId ?? (await prisma.personProfile.create({ data: { parentGroupId, firstName: "Tsc", lastName: "Person", lifecycleStatus: "CANDIDATE", createdByUserId: admin.userId }, select: { id: true } })).id;
  await prisma.candidateProfile.create({ data: { parentGroupId, personProfileId: person, targetCompanyId: companyId, createdByUserId: admin.userId } });
  return person;
}

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("simplified company creation", () => {
  let companyId: string;
  let groupId: string;
  let personId: string;

  it("creates a company from its name alone, without a group and without granting access (§2, §10, §11)", async () => {
    ({ companyId } = await createCompany(admin, createCompanySchema.parse({ name: NAME })));
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { parentGroup: true, _count: { select: { memberships: true, departments: true, modules: true } } } });
    expect(company.slug).toBe("t-sc-armaar-construction");
    expect(company.parentGroup.kind).toBe("STANDALONE");
    expect(company.parentGroup.name).toBe(NAME);
    expect(company._count.memberships).toBe(0);
    expect(company._count.departments).toBeGreaterThan(0);
    expect(company._count.modules).toBeGreaterThan(0);
    expect((await listParentGroups(admin)).some((group) => group.id === company.parentGroupId)).toBe(false);

    const overview = await getPlatformCompanyOverview(admin, companyId);
    expect(overview.structure).toEqual({ kind: "STANDALONE", group: null });
    expect(overview.setup.find((item) => item.key === "legal")?.done).toBe(false);
    personId = await candidate(company.parentGroupId, companyId);
  });

  it("refuses a name that is too short", () => {
    expect(() => createCompanySchema.parse({ name: "A" })).toThrow();
  });

  it("attaches to a group keeping its id and moving its people and departments (§6)", async () => {
    ({ id: groupId } = await createParentGroup(admin, createParentGroupSchema.parse({ name: "T-SC Group", slug: GROUP })));
    const oldRoot = (await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).parentGroupId;
    await attachCompanyToGroup(admin, companyId, groupId, "Joining the group");

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { departments: { include: { groupDepartment: true } } } });
    expect(company.parentGroupId).toBe(groupId);
    expect(company.departments.every((department) => !department.groupDepartment || department.groupDepartment.parentGroupId === groupId)).toBe(true);
    expect(await prisma.parentGroup.count({ where: { id: oldRoot } })).toBe(0);
    expect((await prisma.personProfile.findUniqueOrThrow({ where: { id: personId } })).parentGroupId).toBe(groupId);
    expect((await getPlatformCompanyOverview(admin, companyId)).structure.group?.id).toBe(groupId);
    await expect(attachCompanyToGroup(admin, companyId, groupId, "Again")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses to detach while a person also works in another company of the group (§7)", async () => {
    const sibling = await createGroupCompany(admin, groupId, createGroupCompanySchema.parse({ name: "T-SC Sibling", slug: SIBLING }));
    const shared = await prisma.candidateProfile.create({ data: { parentGroupId: groupId, personProfileId: personId, targetCompanyId: sibling.companyId, createdByUserId: admin.userId } });
    expect((await previewDetach(admin, companyId)).allowed).toBe(false);
    await expect(detachCompanyFromGroup(admin, companyId, "Leaving")).rejects.toMatchObject({ code: "CONFLICT" });
    await prisma.candidateProfile.delete({ where: { id: shared.id } });
  });

  it("detaches into a new standalone root with its data intact (§7)", async () => {
    await detachCompanyFromGroup(admin, companyId, "Leaving the group");
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { parentGroup: true, departments: { include: { groupDepartment: true } } } });
    expect(company.parentGroup.kind).toBe("STANDALONE");
    expect(company.departments.every((department) => !department.groupDepartment || department.groupDepartment.parentGroupId === company.parentGroupId)).toBe(true);
    expect((await prisma.personProfile.findUniqueOrThrow({ where: { id: personId } })).parentGroupId).toBe(company.parentGroupId);
    expect(await prisma.candidateProfile.count({ where: { targetCompanyId: companyId, parentGroupId: company.parentGroupId } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: companyId, actionKey: "PLATFORM_COMPANY_DETACHED_FROM_GROUP" } })).toBe(2);
    // The group keeps its own departments.
    expect(await prisma.groupDepartment.count({ where: { parentGroupId: groupId } })).toBeGreaterThan(0);
  });
});
