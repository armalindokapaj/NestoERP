import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { resolvePlatformContextForSession } from "@/lib/context/platform-context";
import { authorizeProject3DEditor, canOpenProject3DEditor, getProject3DExperienceState, openProject3DEditor, updateProject3DExperience } from "@/lib/modules/project-3d/project-3d.editor";
import { getProject3DWorkspace, updateProject3DEntitlement } from "@/lib/modules/project-3d/project-3d.service";
import { cleanupSessions, loginAs, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(absolute) : entry.name === "route.ts" ? [absolute] : [];
  });
}

describe("Platform 3D authorization", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let tenant: Awaited<ReturnType<typeof loginAs>>;
  let groupId: string;
  let companyId: string;
  let projectId: string;

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
    tenant = await loginAs("OWNER");
    const group = await prisma.parentGroup.create({ data: { slug: `p3d-${suffix}`, name: "Project 3D authorization", status: "ACTIVE" } });
    groupId = group.id;
    const company = await prisma.company.create({ data: { slug: `p3d-company-${suffix}`, name: "Project 3D Company", parentGroupId: group.id } });
    companyId = company.id;
    const project = await prisma.project.create({ data: { companyId: company.id, code: `P3D-${suffix}`.slice(0, 30), name: "Project 3D", status: "ACTIVE", createdBy: admin.userId } });
    projectId = project.id;
  });

  afterAll(async () => {
    await prisma.project3DConfig.deleteMany({ where: { projectId } });
    await prisma.project3DEntitlement.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.auditEvent.deleteMany({ where: { parentGroupId: groupId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: groupId } });
    await prisma.parentGroup.deleteMany({ where: { id: groupId } });
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("refuses a Company session as a Platform session", async () => {
    await expect(resolvePlatformContextForSession(tenant.sessionId)).resolves.toEqual({ ok: false, reason: "NOT_PLATFORM" });
  });

  it("guards every Platform 3D route with withPlatformContext", () => {
    const files = routeFiles(path.join(process.cwd(), "app/api/platform/3d"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("withPlatformContext");
      expect(source, file).not.toContain("withContext(");
    }
  });

  it("provisions entitlement and authoring workspace together with audit evidence", async () => {
    await updateProject3DEntitlement(admin, projectId, {
      status: "ACTIVE",
      viewerEnabled: true,
      planKey: "enterprise",
      activatedAt: null,
      expiresAt: null,
      reason: "Enable the native 3D workspace",
    });

    await expect(getProject3DWorkspace(admin, projectId)).resolves.toMatchObject({
      id: projectId,
      project3DEntitlement: { status: "ACTIVE", viewerEnabled: true, planKey: "enterprise" },
      project3DConfig: { schemaVersion: 1, activeReleaseId: null },
    });
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, projectId, actionKey: "PLATFORM_THREE_D_ENTITLEMENT_CHANGED" } })).toBe(1);
  });

  it("opens the Experience Editor only with the 3D authoring permission, refused before any lookup", async () => {
    const viewOnly = { ...admin, permissions: ["platform.3d.view"] } as PlatformContext;
    expect(canOpenProject3DEditor(admin)).toBe(true);
    expect(canOpenProject3DEditor(viewOnly)).toBe(false);
    await expect(openProject3DEditor(viewOnly, projectId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The same answer for an address that does not exist: a refused session learns nothing.
    await expect(openProject3DEditor(viewOnly, `missing-${suffix}`)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(openProject3DEditor(admin, `missing-${suffix}`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The tab's pre-stream check answers the same way.
    await expect(authorizeProject3DEditor(viewOnly, `missing-${suffix}`)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeProject3DEditor(admin, `missing-${suffix}`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeProject3DEditor(admin, projectId)).resolves.toBeUndefined();
  });

  it("gives the editor tab a compact payload: context, permissions and the draft revision", async () => {
    const workspace = await openProject3DEditor(admin, projectId);
    expect(workspace).toMatchObject({
      project: { id: projectId, name: "Project 3D", company: { id: companyId, name: "Project 3D Company", parentGroup: { id: groupId } } },
      config: { experienceName: "Project 3D 3D Experience", activeRelease: null, document: { revision: 1 } },
      permissions: { configure: true, manageModels: true, manageBindings: true },
      slots: [],
      units: [],
    });
    await expect(getProject3DExperienceState(admin, projectId)).resolves.toMatchObject({ revision: 1, activeReleaseId: null });
  });

  it("saves the editor draft as a new revision without publishing, and refuses a stale tab's save", async () => {
    const { config } = (await openProject3DEditor(admin, projectId)).config.document;
    const saved = await updateProject3DExperience(admin, projectId, { expectedRevision: 1, config: { ...config, skyEnabled: !config.skyEnabled }, reason: "Author the draft in the editor" });
    expect(saved.document.revision).toBe(2);
    expect(await prisma.project3DRelease.count({ where: { projectId } })).toBe(0);
    await expect(getProject3DExperienceState(admin, projectId)).resolves.toMatchObject({ revision: 2, activeReleaseId: null });
    await expect(updateProject3DExperience(admin, projectId, { expectedRevision: 1, config: { ...config }, reason: "A second tab still on revision 1" }))
      .rejects.toMatchObject({ code: "CONFLICT", details: { code: "EXPERIENCE_RACED" } });
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, projectId, actionKey: "PLATFORM_THREE_D_EXPERIENCE_CHANGED" } })).toBe(1);
  });

  it("checks the configure permission in the service, independently of route auth", async () => {
    const readOnly = { ...admin, permissions: ["platform.3d.view"] } as PlatformContext;
    await expect(updateProject3DEntitlement(readOnly, projectId, {
      status: "SUSPENDED",
      viewerEnabled: true,
      planKey: null,
      activatedAt: null,
      expiresAt: null,
      reason: "Permission boundary check",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
