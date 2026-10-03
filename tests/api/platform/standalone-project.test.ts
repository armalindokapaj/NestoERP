import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { accessibleProjectIds } from "@/lib/access/scope";
import type { PlatformContext } from "@/lib/context/platform-context";
import { PLATFORM_PERMISSIONS } from "@/config/platform";
import { AccessError } from "@/lib/access/guards";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { createCompanySchema } from "@/lib/modules/platform/platform.schema";
import { platformSearch } from "@/lib/modules/platform/platform-control.query";
import { archivePlatformProject, createPlatformProject } from "@/lib/modules/platform/platform-control.service";
import { assignProjectToCompany, previewProjectAssignment } from "@/lib/modules/platform/platform-project-assignment.service";
import { getPlatformProjectDetail, listProjectsDirectory } from "@/lib/modules/platform/platform-projects.query";
import { ownershipOf } from "@/lib/access/project-ownership";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Standalone projects and deferred company assignment (PRD §56).
 *
 * A project made from a name alone belongs to no company: only Platform Admin
 * can see it, and NULL never means public. Assigning it changes its owner and
 * nothing else — same id, same history — atomically, once, and into a company
 * that has room and no clashing code.
 */

const PREFIX = "T-SP ";
const SOLO = "T-SP Solo Company";

let admin: PlatformContext;
let soloCompanyId: string;

async function removeCompany(companyId: string): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { parentGroupId: true } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId }, { entityId: companyId }] } });
  await prisma.activity.deleteMany({ where: { companyId } });
  await prisma.project.deleteMany({ where: { companyId } });
  await prisma.companyMember.deleteMany({ where: { companyId } });
  await prisma.companyNumberingScheme.deleteMany({ where: { companyId } });
  await prisma.companyStorageQuota.deleteMany({ where: { companyId } });
  await prisma.financeSettings.deleteMany({ where: { companyId } });
  await prisma.companyIntegrationSettings.deleteMany({ where: { companyId } });
  await prisma.companySettings.deleteMany({ where: { companyId } });
  await prisma.companyModule.deleteMany({ where: { companyId } });
  await prisma.companyEntitlement.deleteMany({ where: { companyId } });
  await prisma.departmentAssignment.deleteMany({ where: { companyId } });
  await prisma.department.deleteMany({ where: { companyId } });
  await prisma.projectType.deleteMany({ where: { companyId } });
  await prisma.projectUnitType.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  if (company) {
    await prisma.auditEvent.deleteMany({ where: { parentGroupId: company.parentGroupId } });
    await prisma.personProfile.deleteMany({ where: { parentGroupId: company.parentGroupId } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: company.parentGroupId } });
    await prisma.parentGroup.delete({ where: { id: company.parentGroupId } });
  }
}

async function removeAll(): Promise<void> {
  const projects = await prisma.project.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({ where: { projectId: { in: projects.map((row) => row.id) } } });
  await prisma.project.deleteMany({ where: { id: { in: projects.map((row) => row.id) } } });
  for (const company of await prisma.company.findMany({ where: { name: SOLO }, select: { id: true } })) await removeCompany(company.id);
}

/** The same administrator with some permissions taken away, to prove the server checks them. */
function without(context: PlatformContext, ...removed: string[]): PlatformContext {
  return { ...context, permissions: PLATFORM_PERMISSIONS.filter((permission) => !removed.includes(permission)) };
}

async function make(name: string, extra: { code?: string; companyId?: string } = {}) {
  return (await createPlatformProject(admin, { name: `${PREFIX}${name}`, status: "PENDING", ...extra })).id;
}

beforeAll(async () => {
  await removeAll();
  admin = await loginAsPlatformAdmin();
  ({ companyId: soloCompanyId } = await createCompany(admin, createCompanySchema.parse({ name: SOLO })));
});

afterAll(async () => {
  await removeAll();
  await cleanupSessions();
});

describe("creating an unassigned project", () => {
  it("needs only a name: no company, no group, no invented owner (§5, §30, §56.1-5)", async () => {
    const companiesBefore = await prisma.company.count();
    const groupsBefore = await prisma.parentGroup.count();
    const id = await make("Eyes of Tirana");

    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(row.companyId).toBeNull();
    expect(ownershipOf(row)).toBe("UNASSIGNED");
    expect(row.status).toBe("PENDING"); // ownership is not the construction status (§9)
    expect(row.code).toMatch(/^[A-Z0-9-]+$/);
    expect(await prisma.company.count()).toBe(companiesBefore);
    expect(await prisma.parentGroup.count()).toBe(groupsBefore);

    const detail = await getPlatformProjectDetail(admin, id);
    expect(detail.ownership).toBe("UNASSIGNED");
    expect(detail.company).toBeNull();
    expect(detail.group).toBeNull();
    const created = await prisma.auditEvent.findFirst({ where: { projectId: id, actionKey: "PLATFORM_PROJECT_CREATED_UNASSIGNED" } });
    expect(created?.companyId).toBeNull();
  });

  it("keeps unassigned codes unique among themselves (§48)", async () => {
    await make("Code One", { code: "T-SP-CODE" });
    await expect(make("Code Two", { code: "T-SP-CODE" })).rejects.toMatchObject({ code: "CONFLICT" });
    // The generated code walks past a taken one.
    const a = await make("Zulu Alpha");
    const b = await make("Zulu Alpha");
    const codes = await prisma.project.findMany({ where: { id: { in: [a, b] } }, select: { code: true } });
    expect(new Set(codes.map((row) => row.code)).size).toBe(2);
  });

  it("still creates a company project the old way (§56.32)", async () => {
    const id = await make("Owned From Birth", { companyId: COMPANY.a });
    const row = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(row.companyId).toBe(COMPANY.a);
    expect(ownershipOf(row)).toBe("ASSIGNED");
    expect(await prisma.auditEvent.count({ where: { projectId: id, actionKey: "PLATFORM_PROJECT_CREATED" } })).toBe(1);
  });
});

describe("who can see and change it", () => {
  let id: string;
  beforeAll(async () => { id = await make("Hidden Until Assigned"); });

  it("is listed, searched and filtered for Platform Admin, labelled Unassigned (§10, §42, §43)", async () => {
    const unassigned = await listProjectsDirectory(admin, { ownership: "unassigned", q: PREFIX.trim() });
    expect(unassigned.rows.some((row) => row.id === id && row.ownership === "UNASSIGNED" && row.company === null)).toBe(true);
    const assigned = await listProjectsDirectory(admin, { ownership: "assigned", q: PREFIX.trim() });
    expect(assigned.rows.some((row) => row.id === id)).toBe(false);
    const all = await listProjectsDirectory(admin, { q: "Hidden Until Assigned" });
    expect(all.rows.some((row) => row.id === id)).toBe(true);
    // A company filter can only match an assigned project.
    expect((await listProjectsDirectory(admin, { company: COMPANY.a, q: "Hidden Until Assigned" })).rows).toHaveLength(0);
    expect((await platformSearch(admin, "Hidden Until Assigned")).some((hit) => hit.type === "Project" && hit.id === id && hit.subtitle.startsWith("Unassigned"))).toBe(true);
  });

  it("is invisible to every company user, in any company or group (§21, §56.7)", async () => {
    for (const person of [await loginAs("CEO"), await loginAsEmail(DEMO_EMAIL.ceoB), await loginAsEmail(DEMO_EMAIL.tenantOwner)]) {
      expect(await accessibleProjectIds(person)).not.toContain(id);
    }
  });

  it("is created and assigned only by someone holding the permission (§35, §56.8-9)", async () => {
    await expect(createPlatformProject(without(admin, "platform.project.create_unassigned"), { name: `${PREFIX}Nope`, status: "PENDING" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assignProjectToCompany(without(admin, "platform.project.assign_company"), { projectId: id, companyId: soloCompanyId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(previewProjectAssignment(without(admin, "platform.project.assign_company"), { projectId: id, companyId: soloCompanyId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).companyId).toBeNull();
  });

  it("can be edited and archived while unassigned, without ever gaining a company (§12, §36)", async () => {
    const other = await make("Archive Me");
    await archivePlatformProject(admin, other, "Not needed after all");
    const row = await prisma.project.findUniqueOrThrow({ where: { id: other } });
    expect(row.companyId).toBeNull();
    expect(row.archivedAt).not.toBeNull();
    // An archived project is restored before it can be assigned.
    const preview = await previewProjectAssignment(admin, { projectId: other, companyId: soloCompanyId });
    expect(preview.blockers.map((item) => item.code)).toContain("PROJECT_ARCHIVED");
  });
});

describe("assigning it to a company", () => {
  it("assigns to a standalone company: same project, history kept, event written (§14, §18, §44, §56.10-18)", async () => {
    const id = await make("To Solo");
    const before = await prisma.project.findUniqueOrThrow({ where: { id } });
    const preview = await previewProjectAssignment(admin, { projectId: id, companyId: soloCompanyId });
    expect(preview.group).toBeNull(); // a standalone company contributes no group context
    expect(preview.blockers).toEqual([]);

    const result = await assignProjectToCompany(admin, { projectId: id, companyId: soloCompanyId, reason: "Contract signed" });
    expect(result).toEqual({ id, companyId: soloCompanyId });

    const after = await prisma.project.findUniqueOrThrow({ where: { id } });
    expect(after.id).toBe(before.id);
    expect(after.code).toBe(before.code);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.createdBy).toBe(before.createdBy);
    expect(after.companyId).toBe(soloCompanyId);
    expect(after.assignedBy).toBe(admin.userId);
    expect(after.assignedAt).not.toBeNull();
    expect(ownershipOf(after)).toBe("ASSIGNED");

    const events = await prisma.auditEvent.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" }, select: { actionKey: true, companyId: true, reason: true } });
    expect(events.map((event) => event.actionKey)).toEqual(["PLATFORM_PROJECT_CREATED_UNASSIGNED", "PLATFORM_PROJECT_COMPANY_ASSIGNED"]);
    expect(events[1]).toMatchObject({ companyId: soloCompanyId, reason: "Contract signed" });

    const detail = await getPlatformProjectDetail(admin, id);
    expect(detail.ownership).toBe("ASSIGNED");
    expect(detail.company?.id).toBe(soloCompanyId);
    expect((await listProjectsDirectory(admin, { ownership: "unassigned", q: "To Solo" })).rows).toHaveLength(0);
    expect((await listProjectsDirectory(admin, { ownership: "assigned", q: "To Solo" })).rows.map((row) => row.id)).toEqual([id]);
  });

  it("assigns into a company of a parent group and inherits the group (§8, §56.11-12, §56.19-20)", async () => {
    const id = await make("To Meridian");
    const preview = await previewProjectAssignment(admin, { projectId: id, companyId: COMPANY.b });
    expect(preview.group?.name).toBeTruthy();
    await assignProjectToCompany(admin, { projectId: id, companyId: COMPANY.b });

    // The destination company's normal authorization now applies: its CEO reaches it, nobody else does.
    expect(await accessibleProjectIds(await loginAsEmail(DEMO_EMAIL.ceoB))).toContain(id);
    expect(await accessibleProjectIds(await loginAs("CEO"))).not.toContain(id);
    expect(await accessibleProjectIds(await loginAsEmail(DEMO_EMAIL.tenantOwner))).not.toContain(id);
    expect(await prisma.projectMember.count({ where: { projectId: id } })).toBe(0); // nobody is added silently (§23)
    const detail = await getPlatformProjectDetail(admin, id);
    expect(detail.group?.id).toBeTruthy();
  });

  it("will not assign twice, and will not move an owned project (§37, §51, §56.23)", async () => {
    const id = await make("Twice");
    await assignProjectToCompany(admin, { projectId: id, companyId: soloCompanyId });
    await expect(assignProjectToCompany(admin, { projectId: id, companyId: COMPANY.b })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).companyId).toBe(soloCompanyId);
    expect(await prisma.auditEvent.count({ where: { projectId: id, actionKey: "PLATFORM_PROJECT_COMPANY_ASSIGNED" } })).toBe(1);
  });

  it("lets exactly one of two simultaneous assignments win (§51, §56.24)", async () => {
    const id = await make("Race");
    const outcomes = await Promise.allSettled([
      assignProjectToCompany(admin, { projectId: id, companyId: soloCompanyId }),
      assignProjectToCompany(admin, { projectId: id, companyId: COMPANY.b }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const loser = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")!;
    expect(loser.reason).toBeInstanceOf(AccessError);
    const winner = outcomes.find((outcome): outcome is PromiseFulfilledResult<{ id: string; companyId: string }> => outcome.status === "fulfilled")!;
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).companyId).toBe(winner.value.companyId);
    expect(await prisma.auditEvent.count({ where: { projectId: id, actionKey: "PLATFORM_PROJECT_COMPANY_ASSIGNED" } })).toBe(1);
  });

  it("refuses a company at its project limit and leaves the project unassigned (§47, §50, §56.22, §56.29)", async () => {
    const id = await make("Over The Limit");
    await prisma.companyEntitlement.upsert({ where: { companyId: soloCompanyId }, update: { maxProjects: 1 }, create: { companyId: soloCompanyId, maxProjects: 1 } });
    try {
      const preview = await previewProjectAssignment(admin, { projectId: id, companyId: soloCompanyId });
      expect(preview.blockers.map((item) => item.code)).toContain("PROJECT_LIMIT_REACHED");
      await expect(assignProjectToCompany(admin, { projectId: id, companyId: soloCompanyId })).rejects.toMatchObject({ code: "CONFLICT" });
      const row = await prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row.companyId).toBeNull();
      expect(row.assignedAt).toBeNull();
      expect(await prisma.auditEvent.count({ where: { projectId: id, actionKey: "PLATFORM_PROJECT_COMPANY_ASSIGNED" } })).toBe(0);
    } finally {
      await prisma.companyEntitlement.deleteMany({ where: { companyId: soloCompanyId } });
    }
  });

  it("refuses a code the company already uses, and says so before confirming (§48)", async () => {
    const owned = await make("Owner Of The Code", { companyId: soloCompanyId });
    const { code } = await prisma.project.findUniqueOrThrow({ where: { id: owned }, select: { code: true } });
    const id = await make("Clashing Code", { code });
    const preview = await previewProjectAssignment(admin, { projectId: id, companyId: soloCompanyId });
    expect(preview.blockers.map((item) => item.code)).toEqual(["PROJECT_CODE_TAKEN"]);
    await expect(assignProjectToCompany(admin, { projectId: id, companyId: soloCompanyId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).companyId).toBeNull();
  });

  it("refuses an inactive company", async () => {
    const id = await make("Inactive Target");
    await prisma.company.update({ where: { id: soloCompanyId }, data: { status: "INACTIVE" } });
    try {
      const preview = await previewProjectAssignment(admin, { projectId: id, companyId: soloCompanyId });
      expect(preview.blockers.map((item) => item.code)).toContain("COMPANY_INACTIVE");
    } finally {
      await prisma.company.update({ where: { id: soloCompanyId }, data: { status: "ACTIVE" } });
    }
  });
});
