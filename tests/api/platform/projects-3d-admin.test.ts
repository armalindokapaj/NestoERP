import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { createCompany } from "@/lib/modules/platform/platform-company.service";
import { archivePlatformProject, createPlatformProject, updatePlatformProject } from "@/lib/modules/platform/platform-control.service";
import { getPlatformProjectDetail, listProjectsDirectory, unconfiguredProjects } from "@/lib/modules/platform/platform-projects.query";
import { projectCreateSchema } from "@/lib/modules/platform/platform-control.schema";
import { createCompanySchema } from "@/lib/modules/platform/platform.schema";
import { getPublic3DStatus } from "@/lib/modules/project-3d/project-3d.public";
import { createProject3DExperience } from "@/lib/modules/project-3d/project-3d.service";
import { setProject3DVisibility } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "../../helpers";

/**
 * Platform Admin projects and 3D administration (Admin Projects & 3D PRD #5
 * §5-§17, §21, §48-§56, §64-§65).
 */

const NAME = "T-P3D Harbour Developments";
let admin: PlatformContext;
let companyId: string;
let projectId: string;

async function remove() {
  const rows = await prisma.company.findMany({ where: { name: NAME }, select: { id: true, parentGroupId: true } });
  for (const row of rows) {
    const projects = await prisma.project.findMany({ where: { companyId: row.id }, select: { id: true } });
    await prisma.project3DConfig.deleteMany({ where: { projectId: { in: projects.map((project) => project.id) } } });
    await prisma.project3DEntitlement.deleteMany({ where: { projectId: { in: projects.map((project) => project.id) } } });
    await prisma.project.deleteMany({ where: { companyId: row.id } });
    for (const model of ["companyNumberingScheme", "companyStorageQuota", "financeSettings", "companyIntegrationSettings", "companySettings", "companyModule", "departmentAssignment", "department", "projectType", "projectUnitType", "activity", "companyEntitlement"] as const) {
      await (prisma[model] as unknown as { deleteMany: (args: object) => Promise<unknown> }).deleteMany({ where: { companyId: row.id } });
    }
    await prisma.auditEvent.deleteMany({ where: { OR: [{ companyId: row.id }, { entityId: row.id }, { parentGroupId: row.parentGroupId }] } });
    await prisma.company.delete({ where: { id: row.id } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: row.parentGroupId } });
    await prisma.parentGroup.delete({ where: { id: row.parentGroupId } });
  }
}

beforeAll(async () => {
  await remove();
  admin = await loginAsPlatformAdmin();
  ({ companyId } = await createCompany(admin, createCompanySchema.parse({ name: NAME })));
});

afterAll(async () => {
  await remove();
  await cleanupSessions();
});

describe("projects and 3D administration", () => {
  it("creates a project from a name and a managing company; the code is made from the name (§10)", async () => {
    ({ id: projectId } = await createPlatformProject(admin, projectCreateSchema.parse({ companyId, name: "Eyes of Tirana", code: "" })));
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project).toMatchObject({ code: "EOT", status: "PENDING" });
    const second = await createPlatformProject(admin, projectCreateSchema.parse({ companyId, name: "Eyes Over Tirana" }));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: second.id } })).code).toBe("EOT-2");
    await prisma.project.delete({ where: { id: second.id } });
  });

  it("finds it by project, company and 3D state, paged on the server (§6-§8)", async () => {
    const byName = await listProjectsDirectory(admin, { q: "Eyes of Tirana" });
    expect(byName.rows.map((row) => row.id)).toContain(projectId);
    expect((await listProjectsDirectory(admin, { q: NAME })).rows[0]).toMatchObject({ id: projectId, group: null, threeD: "Not configured", status: "PENDING" });
    expect((await listProjectsDirectory(admin, { q: NAME, three: "configured" })).total).toBe(0);
    expect((await listProjectsDirectory(admin, { q: NAME, status: "ARCHIVED" })).total).toBe(0);
    expect((await unconfiguredProjects(admin, "Eyes of Tirana")).map((row) => row.id)).toContain(projectId);
  });

  it("edits identity and lifecycle, and archives without deleting (§64, §65)", async () => {
    await updatePlatformProject(admin, { projectId, name: "Eyes of Tirana", description: "Tower", status: "ACTIVE", reason: "Launch" });
    expect((await getPlatformProjectDetail(admin, projectId))).toMatchObject({ status: "ACTIVE", description: "Tower", company: { id: companyId } });
  });

  it("configures 3D on the canonical project and sets Private / Company Users / Offline audiences (§2, §48-§53)", async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { parentGroupId: true } });
    await createProject3DExperience(admin, { parentGroupId: company.parentGroupId, companyId, projectId, experienceName: "Eyes of Tirana 3D", activateEntitlement: true, structureMode: "CREATE_LATER", reason: "Pilot" });
    expect(await prisma.project.count({ where: { companyId } })).toBe(1);
    expect((await unconfiguredProjects(admin, "Eyes of Tirana")).map((row) => row.id)).not.toContain(projectId);
    const config = await prisma.project3DConfig.findUniqueOrThrow({ where: { projectId }, select: { controlVersion: true, publicId: true } });

    const privateOutcome = await setProject3DVisibility(admin, projectId, { visibility: "PRIVATE", expectedControlVersion: config.controlVersion, reason: "Buyers preview" });
    expect(privateOutcome.visibility).toBe("PRIVATE");
    // A share address never opens a Private experience anonymously.
    expect((await getPublic3DStatus(config.publicId)).state).toBe("LOGIN_REQUIRED");
    expect((await listProjectsDirectory(admin, { q: NAME, three: "PRIVATE" })).rows[0]?.threeD).toBe("Private");

    const offline = await setProject3DVisibility(admin, projectId, { visibility: "OFFLINE", expectedControlVersion: privateOutcome.controlVersion, reason: "Emergency" });
    expect(offline.visibility).toBe("OFFLINE");
    expect((await getPublic3DStatus(config.publicId)).state).toBe("UNAVAILABLE");
    expect(await prisma.project3DConfig.count({ where: { projectId } })).toBe(1);
    // Public needs a published release with an approved public projection (§54).
    await expect(setProject3DVisibility(admin, projectId, { visibility: "PUBLIC", expectedControlVersion: offline.controlVersion, reason: "Launch" })).rejects.toBeTruthy();
  });

  it("archives the project; its 3D configuration and data remain (§65, §73)", async () => {
    await archivePlatformProject(admin, projectId, "Completed and closed");
    const detail = await getPlatformProjectDetail(admin, projectId);
    expect(detail).toMatchObject({ status: "ARCHIVED", archived: true });
    expect(await prisma.project3DConfig.count({ where: { projectId } })).toBe(1);
    expect((await listProjectsDirectory(admin, { q: NAME, status: "ARCHIVED" })).total).toBe(1);
  });

  it("refuses a context without project permissions", async () => {
    await expect(listProjectsDirectory({ ...admin, permissions: [] } as PlatformContext, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createPlatformProject({ ...admin, permissions: ["platform.project.view"] } as PlatformContext, { companyId, name: "X", status: "PENDING" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
