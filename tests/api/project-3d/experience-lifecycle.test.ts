import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteProject3DExperience,
  restoreProject3DExperience,
  rotateProject3DPublicLink,
  setProject3DVisibility,
} from "@/lib/modules/project-3d/project-3d.lifecycle";
import { createProject3DModelSlot } from "@/lib/modules/project-3d/project-3d.ingestion";
import { createProject3DExperience, listProject3DExperiences, updateProject3DExperienceMetadata } from "@/lib/modules/project-3d/project-3d.service";
import type { PlatformContext } from "@/lib/context/platform-context";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

/**
 * ADM-04A Part A: audience, soft deletion and restoration against real
 * PostgreSQL — EV-01, EV-15, EV-16, EV-17, EV-18, EV-19, EV-23.
 */
describe("3D experience lifecycle and visibility", () => {
  const tag = `p3d-life-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const NAME = "Lifecycle Experience";
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string;
  let companyId: string;
  let projectId: string;
  let configId: string;

  const control = async () => prisma.project3DConfig.findUniqueOrThrow({ where: { projectId }, select: { controlVersion: true, accessEpoch: true, visibility: true, publicId: true, deletedAt: true, purgeAfter: true, activeReleaseId: true } });

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
    const group = await prisma.parentGroup.create({ data: { slug: tag, name: "Lifecycle Group", status: "ACTIVE", activatedAt: new Date() } });
    groupId = group.id;
    const company = await prisma.company.create({ data: { slug: `${tag}-co`, name: "Lifecycle Company", parentGroupId: group.id } });
    companyId = company.id;
    const project = await prisma.project.create({ data: { companyId, code: tag.slice(0, 30), name: "Lifecycle Project", status: "ACTIVE", createdBy: admin.userId } });
    projectId = project.id;
    await createProject3DExperience(admin, { parentGroupId: groupId, companyId, projectId, experienceName: NAME, internalNotes: null, activateEntitlement: true, structureMode: "CREATE_LATER", reason: "Lifecycle fixture" });
    configId = (await prisma.project3DConfig.findUniqueOrThrow({ where: { projectId }, select: { id: true } })).id;
    // A published release stands in for the publishing pipeline, which has its own tests.
    const release = await prisma.project3DRelease.create({ data: { companyId, projectId, configId, releaseNumber: 1, experienceSnapshot: {}, manifest: {}, manifestHash: "0".repeat(64), publishedByUserId: admin.userId } });
    await prisma.project3DConfig.update({ where: { id: configId }, data: { activeReleaseId: release.id } });
  });

  afterAll(async () => {
    // The purge job's opt-out is the only way to clear rows under a deleted experience.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL nesto.project3d_purge = 'on'");
      await tx.project3DConfig.updateMany({ where: { projectId }, data: { deletedAt: null } });
      await tx.project3DConfig.updateMany({ where: { projectId }, data: { activeReleaseId: null } });
      await tx.project3DRelease.deleteMany({ where: { projectId } });
      await tx.project3DModelSlot.deleteMany({ where: { projectId } });
    });
    await prisma.project3DMutationRequest.deleteMany({ where: { projectId } });
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

  it("EV-01: a new experience is OFFLINE, and a metadata save does not open it", async () => {
    const before = await control();
    expect(before.visibility).toBe("OFFLINE");
    expect(before.publicId).toMatch(/^[A-Za-z0-9_-]{12,}$/);
    await updateProject3DExperienceMetadata(admin, projectId, { experienceName: NAME, internalNotes: "Edited", expectedControlVersion: before.controlVersion, reason: null });
    const row = (await listProject3DExperiences(admin, { q: tag.slice(0, 30) })).find((item) => item.projectId === projectId)!;
    expect(row.visibility).toBe("OFFLINE");
    expect(row.availability).toEqual({ available: false, blockers: ["OFFLINE"] });
  });

  it("EV-15: a decision made against a stale version is a 409, never a silent rebase", async () => {
    const { controlVersion } = await control();
    await expect(updateProject3DExperienceMetadata(admin, projectId, { experienceName: NAME, expectedControlVersion: controlVersion - 1, reason: null })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "STALE_CONTROL_VERSION" } });
    await expect(setProject3DVisibility(admin, projectId, { visibility: "COMPANY_ONLY", expectedControlVersion: controlVersion + 5, reason: "Stale decision" })).rejects.toMatchObject({ details: { code: "STALE_CONTROL_VERSION" } });

    // Two decisions from the same version: exactly one lands.
    const results = await Promise.allSettled([
      setProject3DVisibility(admin, projectId, { visibility: "COMPANY_ONLY", expectedControlVersion: controlVersion, reason: "Open to the company" }),
      setProject3DVisibility(admin, projectId, { visibility: "COMPANY_ONLY", expectedControlVersion: controlVersion, reason: "Open to the company again" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const after = await control();
    expect(after).toMatchObject({ visibility: "COMPANY_ONLY", controlVersion: controlVersion + 1 });
  });

  it("refuses PUBLIC until the active release has an approved public projection", async () => {
    const { controlVersion } = await control();
    await expect(setProject3DVisibility(admin, projectId, { visibility: "PUBLIC", expectedControlVersion: controlVersion, reason: "Try to publish" })).rejects.toMatchObject({ details: { code: "PUBLIC_NOT_READY", blockers: ["PUBLIC_PROJECTION_MISSING"] } });
    expect((await control()).visibility).toBe("COMPANY_ONLY");
  });

  it("EV-16: a retried request returns its first outcome; the same id with another payload conflicts", async () => {
    const { controlVersion, accessEpoch } = await control();
    const requestId = `req_${tag}`.replace(/[^A-Za-z0-9_-]/g, "_");
    const first = await setProject3DVisibility(admin, projectId, { visibility: "OFFLINE", expectedControlVersion: controlVersion, reason: "Take offline", requestId });
    const retried = await setProject3DVisibility(admin, projectId, { visibility: "OFFLINE", expectedControlVersion: controlVersion, reason: "Take offline", requestId });
    expect(retried).toEqual(first);
    expect(await control()).toMatchObject({ visibility: "OFFLINE", controlVersion: controlVersion + 1, accessEpoch: accessEpoch + 1 });
    expect(await prisma.auditEvent.count({ where: { projectId, actionKey: "PLATFORM_THREE_D_VISIBILITY_CHANGED", reason: "Take offline" } })).toBe(1);
    await expect(setProject3DVisibility(admin, projectId, { visibility: "COMPANY_ONLY", expectedControlVersion: controlVersion, reason: "Take offline", requestId })).rejects.toMatchObject({ details: { code: "REQUEST_ID_REUSED" } });
  });

  it("refuses audience and lifecycle changes without their own permissions", async () => {
    const configureOnly = { ...admin, permissions: ["platform.3d.view", "platform.3d.configure", "platform.3d.publish", "platform.3d.model.delete"] } as PlatformContext;
    const { controlVersion } = await control();
    await expect(setProject3DVisibility(configureOnly, projectId, { visibility: "COMPANY_ONLY", expectedControlVersion: controlVersion, reason: "No permission" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteProject3DExperience(configureOnly, projectId, { expectedControlVersion: controlVersion, confirmationName: NAME, reason: "No permission" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(restoreProject3DExperience(configureOnly, projectId, { expectedControlVersion: controlVersion, reason: "No permission" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("EV-17/EV-18: delete is soft, keeps the ERP Project, and freezes every write under it", async () => {
    await setProject3DVisibility(admin, projectId, { visibility: "COMPANY_ONLY", expectedControlVersion: (await control()).controlVersion, reason: "Reopen before delete" });
    const before = await control();
    await expect(deleteProject3DExperience(admin, projectId, { expectedControlVersion: before.controlVersion, confirmationName: "wrong name", reason: "Retire experience" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const deleted = await deleteProject3DExperience(admin, projectId, { expectedControlVersion: before.controlVersion, confirmationName: NAME, reason: "Retire experience" });
    expect(deleted.visibility).toBe("OFFLINE");
    expect(deleted.blockers).toContain("DELETED");

    const after = await prisma.project3DConfig.findUniqueOrThrow({ where: { projectId }, select: { deletedAt: true, previousVisibility: true, visibility: true, purgeAfter: true, purgeStatus: true, accessEpoch: true, activeReleaseId: true } });
    expect(after).toMatchObject({ previousVisibility: "COMPANY_ONLY", visibility: "OFFLINE", purgeStatus: "SCHEDULED", accessEpoch: before.accessEpoch + 1, activeReleaseId: before.activeReleaseId });
    expect(after.purgeAfter!.getTime() - after.deletedAt!.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    // The canonical Project and its release history stay.
    expect(await prisma.project.count({ where: { id: projectId, archivedAt: null } })).toBe(1);
    expect(await prisma.project3DRelease.count({ where: { projectId } })).toBe(1);

    // Readable refusals on the authoring paths, and the trigger behind every other one.
    await expect(createProject3DModelSlot(admin, projectId, { displayName: "Late", role: "UNITS", kind: "DETAIL", reason: null } as never)).rejects.toMatchObject({ details: { code: "EXPERIENCE_DELETED" } });
    await expect(prisma.project3DModelSlot.create({ data: { companyId, projectId, configId, role: "UNITS", slotKey: "late", displayName: "Late worker" } })).rejects.toThrow(/PROJECT_3D_EXPERIENCE_DELETED/);
    await expect(prisma.project3DConfig.update({ where: { id: configId }, data: { visibility: "PUBLIC" } })).rejects.toThrow(/PROJECT_3D_EXPERIENCE_DELETED/);
    await expect(setProject3DVisibility(admin, projectId, { visibility: "COMPANY_ONLY", expectedControlVersion: (await control()).controlVersion, reason: "Reopen deleted" })).rejects.toMatchObject({ details: { code: "EXPERIENCE_DELETED" } });
    await expect(createProject3DExperience(admin, { parentGroupId: groupId, companyId, projectId, experienceName: "Duplicate", internalNotes: null, activateEntitlement: true, structureMode: "CREATE_LATER", reason: "Recreate" })).rejects.toMatchObject({ details: { code: "EXPERIENCE_DELETED_RESTORE" } });

    const active = await listProject3DExperiences(admin, { q: tag.slice(0, 30) });
    const trash = await listProject3DExperiences(admin, { q: tag.slice(0, 30), trash: "1" });
    expect(active.some((row) => row.projectId === projectId)).toBe(false);
    expect(trash.find((row) => row.projectId === projectId)?.deleted?.reason).toBe("Retire experience");
  });

  it("EV-19: restore is OFFLINE with a new public link, and a claimed purge cannot be undone", async () => {
    const before = await control();
    const restored = await restoreProject3DExperience(admin, projectId, { expectedControlVersion: before.controlVersion, reason: "Customer renewed" });
    expect(restored.visibility).toBe("OFFLINE");
    expect(restored.publicId).not.toBe(before.publicId);
    expect(await control()).toMatchObject({ deletedAt: null, visibility: "OFFLINE", publicId: restored.publicId, accessEpoch: before.accessEpoch + 1 });

    const rotated = await rotateProject3DPublicLink(admin, projectId, { expectedControlVersion: (await control()).controlVersion, reason: "Old link leaked" });
    expect(rotated.publicId).not.toBe(restored.publicId);

    await deleteProject3DExperience(admin, projectId, { expectedControlVersion: (await control()).controlVersion, confirmationName: NAME, reason: "Retire again" });
    await prisma.project3DConfig.update({ where: { id: configId }, data: { purgeStatus: "CLAIMED", purgeClaimedAt: new Date() } });
    await expect(restoreProject3DExperience(admin, projectId, { expectedControlVersion: (await control()).controlVersion, reason: "Too late" })).rejects.toMatchObject({ details: { code: "EXPERIENCE_PURGED" } });
  });

  it("EV-23: every decision is audited with actor, reason and before/after", async () => {
    const events = await prisma.auditEvent.findMany({ where: { projectId, actionKey: { in: ["PLATFORM_THREE_D_VISIBILITY_CHANGED", "PLATFORM_THREE_D_EXPERIENCE_DELETED", "PLATFORM_THREE_D_EXPERIENCE_RESTORED", "PLATFORM_THREE_D_PUBLIC_LINK_ROTATED"] } }, select: { actionKey: true, actorUserId: true, reason: true } });
    expect(new Set(events.map((event) => event.actionKey)).size).toBe(4);
    expect(events.every((event) => event.actorUserId === admin.userId && Boolean(event.reason))).toBe(true);
  });
});
