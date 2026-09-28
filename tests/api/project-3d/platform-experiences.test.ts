import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { createProject3DExperience, listProject3DExperiences, updateProject3DExperienceMetadata } from "@/lib/modules/project-3d/project-3d.service";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

describe("Platform 3D Experience provisioning", () => {
  const tag = `p3d-experience-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string | null = null;
  let companyId: string | null = null;
  let projectId: string | null = null;

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
    const group = await prisma.parentGroup.create({ data: { slug: tag, name: "Experience Group", status: "ACTIVE" } });
    groupId = group.id;
    const company = await prisma.company.create({ data: { slug: `${tag}-company`, name: "Experience Company", parentGroupId: group.id } });
    companyId = company.id;
    const project = await prisma.project.create({ data: { companyId: company.id, code: tag.slice(0, 30), name: "Experience Project", status: "ACTIVE", createdBy: admin.userId } });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.project3DConfig.deleteMany({ where: { projectId } });
      await prisma.project3DEntitlement.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    if (groupId) await prisma.auditEvent.deleteMany({ where: { parentGroupId: groupId } });
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
    if (groupId) {
      await prisma.groupDepartment.deleteMany({ where: { parentGroupId: groupId } });
      await prisma.parentGroup.deleteMany({ where: { id: groupId } });
    }
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("lists only provisioned Experiences and validates the hierarchy", async () => {
    expect((await listProject3DExperiences(admin, { q: tag })).some((row) => row.projectId === projectId)).toBe(false);
    await expect(createProject3DExperience(admin, { parentGroupId: "wrong-group", companyId: companyId!, projectId: projectId!, experienceName: "Wrong", internalNotes: null, activateEntitlement: true, structureMode: "CREATE_LATER", reason: "Validate hierarchy" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createProject3DExperience(admin, { parentGroupId: groupId!, companyId: companyId!, projectId: projectId!, experienceName: "No structure", internalNotes: null, activateEntitlement: true, structureMode: "USE_EXISTING", reason: "Validate structure choice" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates entitlement and metadata atomically and refuses duplicates", async () => {
    const created = await createProject3DExperience(admin, { parentGroupId: groupId!, companyId: companyId!, projectId: projectId!, experienceName: "Flagship Experience", internalNotes: "Initial implementation", activateEntitlement: true, structureMode: "CREATE_LATER", reason: "Provision flagship Experience" });
    expect(created).toMatchObject({ projectId, openPath: `/admin/3d/projects/${projectId}` });
    await expect(prisma.project3DEntitlement.findUnique({ where: { projectId: projectId! } })).resolves.toMatchObject({ status: "ACTIVE", viewerEnabled: true });
    expect((await listProject3DExperiences(admin, { q: "Flagship" })).map((row) => row.projectId)).toContain(projectId);
    await expect(createProject3DExperience(admin, { parentGroupId: groupId!, companyId: companyId!, projectId: projectId!, experienceName: "Duplicate", internalNotes: null, activateEntitlement: true, structureMode: "CREATE_LATER", reason: "Reject duplicate" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("updates metadata with audit evidence and enforces configure permission", async () => {
    await updateProject3DExperienceMetadata(admin, projectId!, { experienceName: "Flagship Residence Experience", internalNotes: "Ready for model intake", reason: "Refine Experience identity" });
    await expect(prisma.project3DConfig.findUnique({ where: { projectId: projectId! } })).resolves.toMatchObject({ experienceName: "Flagship Residence Experience", internalNotes: "Ready for model intake" });
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId!, projectId: projectId!, actionKey: "PLATFORM_THREE_D_EXPERIENCE_CHANGED" } })).toBeGreaterThanOrEqual(2);

    const readOnly = { ...admin, permissions: ["platform.3d.view"] } as PlatformContext;
    await expect(updateProject3DExperienceMetadata(readOnly, projectId!, { experienceName: "Forbidden", internalNotes: null, reason: "Permission check" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
