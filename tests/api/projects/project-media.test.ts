import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import {
  addProjectMedia,
  listProjectMedia,
  removeProjectMedia,
  reorderProjectMedia,
  updateProjectMedia,
} from "@/lib/modules/project-media/project-media.service";
import { createProjectMediaSchema, updateProjectMediaSchema } from "@/lib/modules/project-media/project-media.schema";
import { cleanupSessions, COMPANY, loginAs, prisma } from "@/tests/helpers";

describe("Project media", () => {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const projectId = `project_media_${suffix}`;
  const outsideProjectId = `project_media_outside_${suffix}`;
  const renderOneId = `document_media_render_1_${suffix}`;
  const renderTwoId = `document_media_render_2_${suffix}`;
  const animationId = `document_media_animation_${suffix}`;
  const outsideDocumentId = `document_media_outside_${suffix}`;
  const documentIds = [renderOneId, renderTwoId, animationId, outsideDocumentId];
  let manager: UserContext;
  let viewer: UserContext;

  beforeAll(async () => {
    [manager, viewer] = await Promise.all([loginAs("PROJECT_MANAGER"), loginAs("VIEWER")]);
    await prisma.project.createMany({ data: [
      { id: projectId, companyId: COMPANY.a, code: `MED-${suffix}`.slice(0, 30), name: "Project Media Test", status: "ACTIVE", projectManagerMemberId: manager.membershipId, createdBy: manager.userId },
      { id: outsideProjectId, companyId: COMPANY.a, code: `MED-O-${suffix}`.slice(0, 30), name: "Outside Media Test", status: "ACTIVE", createdBy: manager.userId },
    ] });
    await prisma.projectMember.createMany({ data: [
      { companyId: COMPANY.a, projectId, companyMemberId: manager.membershipId, projectRole: "Project Manager", status: "ACTIVE" },
      { companyId: COMPANY.a, projectId, companyMemberId: viewer.membershipId, projectRole: "Viewer", status: "ACTIVE" },
    ] });
    await prisma.document.createMany({ data: [
      { id: renderOneId, companyId: COMPANY.a, projectId, name: "North elevation.jpg", originalFileName: "north.jpg", mimeType: "image/jpeg", detectedMimeType: "image/jpeg", storageStatus: "AVAILABLE", storageKey: `tests/${renderOneId}.jpg`, uploadedByMemberId: manager.membershipId, createdBy: manager.userId },
      { id: renderTwoId, companyId: COMPANY.a, projectId, name: "South elevation.png", originalFileName: "south.png", mimeType: "image/png", detectedMimeType: "image/png", storageStatus: "AVAILABLE", storageKey: `tests/${renderTwoId}.png`, uploadedByMemberId: manager.membershipId, createdBy: manager.userId },
      { id: animationId, companyId: COMPANY.a, projectId, name: "Main flythrough.mp4", originalFileName: "flythrough.mp4", mimeType: "video/mp4", detectedMimeType: "video/mp4", storageStatus: "AVAILABLE", storageKey: `tests/${animationId}.mp4`, uploadedByMemberId: manager.membershipId, createdBy: manager.userId },
      { id: outsideDocumentId, companyId: COMPANY.a, projectId: outsideProjectId, name: "Outside.jpg", originalFileName: "outside.jpg", mimeType: "image/jpeg", detectedMimeType: "image/jpeg", storageStatus: "AVAILABLE", storageKey: `tests/${outsideDocumentId}.jpg`, uploadedByMemberId: manager.membershipId, createdBy: manager.userId },
    ] });
  });

  beforeEach(async () => {
    await prisma.projectMedia.deleteMany({ where: { projectId } });
    await prisma.project.updateMany({ where: { id: projectId, companyId: COMPANY.a }, data: { coverImageDocumentId: null } });
    await prisma.activity.deleteMany({ where: { entityId: projectId } });
    await prisma.auditEvent.deleteMany({ where: { projectId } });
  });

  afterAll(async () => {
    await prisma.projectMedia.deleteMany({ where: { projectId: { in: [projectId, outsideProjectId] } } });
    await prisma.project.updateMany({ where: { id: projectId, companyId: COMPANY.a }, data: { coverImageDocumentId: null } });
    await prisma.activity.deleteMany({ where: { entityId: { in: [projectId, outsideProjectId] } } });
    await prisma.auditEvent.deleteMany({ where: { projectId: { in: [projectId, outsideProjectId] } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: [projectId, outsideProjectId] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, outsideProjectId] } } });
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("links canonical documents, derives counts, and switches the cover atomically", async () => {
    const first = await addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: renderOneId, type: "RENDER", title: "North elevation", isCover: true }));
    const second = await addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: renderTwoId, type: "RENDER", title: "South elevation" }));
    const animation = await addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: animationId, type: "ANIMATION", title: "Main flythrough", durationSeconds: 94 }));

    await updateProjectMedia(manager, projectId, second.id, updateProjectMediaSchema.parse({ isCover: true, isFeatured: true }));
    await reorderProjectMedia(manager, projectId, [animation.id, second.id, first.id]);

    const collection = await listProjectMedia(manager, projectId);
    expect(collection.counts).toEqual({ renders: 2, animations: 1 });
    expect(collection.cover).toMatchObject({ id: second.id, title: "South elevation", isCover: true });
    expect(collection.renders.find((item) => item.id === first.id)?.isCover).toBe(false);
    expect(collection.animations[0]).toMatchObject({ id: animation.id, durationSeconds: 94 });
    await expect(prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { coverImageDocumentId: true } })).resolves.toEqual({ coverImageDocumentId: renderTwoId });
    await expect(prisma.projectMedia.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" }, select: { id: true } })).resolves.toEqual([{ id: animation.id }, { id: second.id }, { id: first.id }]);
  });

  it("rejects mismatched and out-of-project canonical files", async () => {
    await expect(addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: renderOneId, type: "ANIMATION" })))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: outsideDocumentId, type: "RENDER" })))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lets a project viewer read media but denies management", async () => {
    await addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: renderOneId, type: "RENDER" }));
    const collection = await listProjectMedia(viewer, projectId);
    expect(collection.capabilities).toMatchObject({ canView: true, canManage: false, canUpload: false });
    expect(collection.renders).toHaveLength(1);
    await expect(addProjectMedia(viewer, projectId, createProjectMediaSchema.parse({ documentId: renderTwoId, type: "RENDER" })))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("hides media completely when the media-view permission is absent", async () => {
    await addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: renderOneId, type: "RENDER" }));
    const withoutMedia = { ...viewer, permissions: viewer.permissions.filter((permission) => permission !== "project.media.view") };
    const collection = await listProjectMedia(withoutMedia, projectId);
    expect(collection).toEqual({ renders: [], animations: [], counts: { renders: 0, animations: 0 }, cover: null, capabilities: { canView: false, canManage: false, canUpload: false } });
  });

  it("returns not found before revealing media outside project scope", async () => {
    await expect(listProjectMedia(manager, outsideProjectId)).rejects.toBeInstanceOf(AccessError);
    await expect(listProjectMedia(manager, outsideProjectId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removes only the media link and clears its cover while retaining the document", async () => {
    const media = await addProjectMedia(manager, projectId, createProjectMediaSchema.parse({ documentId: renderOneId, type: "RENDER", isCover: true }));
    await removeProjectMedia(manager, projectId, media.id);
    await expect(prisma.projectMedia.count({ where: { projectId } })).resolves.toBe(0);
    await expect(prisma.document.count({ where: { id: renderOneId } })).resolves.toBe(1);
    await expect(prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { coverImageDocumentId: true } })).resolves.toEqual({ coverImageDocumentId: null });
  });
});
