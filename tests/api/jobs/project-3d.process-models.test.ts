import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { JOBS } from "@/lib/core/jobs/job.registry";
import { completeProject3DModelUpload, createProject3DModelSlot, createProject3DModelUpload, processPendingProject3DModels } from "@/lib/modules/project-3d/project-3d.ingestion";
import { updateProject3DEntitlement } from "@/lib/modules/project-3d/project-3d.service";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

function glb(json: Record<string, unknown>, binary = new Uint8Array()): Uint8Array {
  const jsonSource = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(jsonSource);
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const hasBinary = binaryLength > 0;
  const total = 12 + 8 + jsonLength + (hasBinary ? 8 + binaryLength : 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(jsonBytes, 20);
  if (hasBinary) {
    const offset = 20 + jsonLength;
    view.setUint32(offset, binaryLength, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    bytes.set(binary, offset + 8);
  }
  return bytes;
}

function oneTriangleGlb(): Uint8Array {
  const binary = new Uint8Array(44);
  new Float32Array(binary.buffer, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  return glb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Unit_A-101", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    buffers: [{ byteLength: 44 }],
  }, binary);
}

describe("project-3d.process-models", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storedKeys = new Set<string>();
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string;
  let companyId: string;
  let projectId: string;
  let otherProjectId: string;
  let slotId: string;

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
    const group = await prisma.parentGroup.create({ data: { slug: `p3d-job-${suffix}`, name: "3D processing job", status: "ACTIVE" } });
    groupId = group.id;
    const company = await prisma.company.create({ data: { slug: `p3d-job-company-${suffix}`, name: "3D processing company", parentGroupId: group.id } });
    companyId = company.id;
    const [project, other] = await Promise.all([
      prisma.project.create({ data: { companyId: company.id, code: `3D-${suffix}`.slice(0, 30), name: "3D processing", status: "ACTIVE", createdBy: admin.userId } }),
      prisma.project.create({ data: { companyId: company.id, code: `3DO-${suffix}`.slice(0, 30), name: "Other 3D project", status: "ACTIVE", createdBy: admin.userId } }),
    ]);
    projectId = project.id;
    otherProjectId = other.id;
    await updateProject3DEntitlement(admin, projectId, { status: "ACTIVE", viewerEnabled: true, planKey: null, activatedAt: null, expiresAt: null, reason: "Prepare processor test" });
    const slot = await createProject3DModelSlot(admin, projectId, { kind: "DETAIL", role: "UNITS", slotKey: "units", displayName: "Units", sortOrder: 0, transformParentSlotId: null, reason: "Create processor slot" });
    slotId = slot.id;
  });

  afterAll(async () => {
    const versions = await prisma.project3DModelVersion.findMany({ where: { projectId }, select: { sourceStorageKey: true, runtimeStorageKey: true } });
    for (const version of versions) {
      storedKeys.add(version.sourceStorageKey);
      if (version.runtimeStorageKey) storedKeys.add(version.runtimeStorageKey);
    }
    await prisma.project3DUnitMeshBinding.deleteMany({ where: { projectId } });
    await prisma.project3DModelVersion.deleteMany({ where: { projectId } });
    await prisma.project3DModelSlot.deleteMany({ where: { projectId } });
    await prisma.project3DRelease.deleteMany({ where: { projectId } });
    await prisma.project3DConfig.deleteMany({ where: { projectId } });
    await prisma.project3DEntitlement.deleteMany({ where: { projectId } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ parentGroupId: groupId }, { companyId }] } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: groupId } });
    await prisma.parentGroup.deleteMany({ where: { id: groupId } });
    for (const key of storedKeys) await storageProvider().deleteObject(key).catch(() => undefined);
    await cleanupSessions();
    await prisma.$disconnect();
  });

  describe("suspended company", () => {
    it("finishes Platform-authorized processing from the durable queue", async () => {
      const bytes = oneTriangleGlb();
      const intent = await createProject3DModelUpload(admin, projectId, slotId, { fileName: "units.glb", sizeBytes: bytes.length, scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0, reason: "Upload unit model" });
      const version = await prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: intent.versionId }, select: { sourceStorageKey: true } });
      storedKeys.add(version.sourceStorageKey);
      await storageProvider().putObject(version.sourceStorageKey, bytes, "model/gltf-binary");
      await expect(completeProject3DModelUpload(admin, projectId, intent.versionId, "Queue verified source")).resolves.toMatchObject({ status: "PROCESSING" });

      await prisma.company.update({ where: { id: companyId }, data: { status: "SUSPENDED" } });
      await expect(processPendingProject3DModels({ limit: 10 })).resolves.toEqual({ processed: 1, ready: 1, failed: 0 });
      await prisma.company.update({ where: { id: companyId }, data: { status: "ACTIVE" } });

      const ready = await prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: intent.versionId } });
      expect(ready).toMatchObject({ status: "READY", validationStatus: "READY", triangleCount: 1, meshCount: 1 });
      expect(ready.runtimeStorageKey).toBeTruthy();
      expect(ready.runtimeStorageKey).not.toBe(ready.sourceStorageKey);
      storedKeys.add(ready.runtimeStorageKey!);
      await expect(storageProvider().headObject(ready.sourceStorageKey)).resolves.not.toBeNull();
      await expect(storageProvider().headObject(ready.runtimeStorageKey!)).resolves.not.toBeNull();
    });
  });

  describe("idempotency", () => {
    it("does not process a ready version again", async () => {
      await expect(processPendingProject3DModels({ limit: 10 })).resolves.toEqual({ processed: 0, ready: 0, failed: 0 });
    });
  });

  describe("failure", () => {
    it("blocks a structurally valid GLB with no meshes and creates no runtime object", async () => {
      const bytes = glb({ asset: { version: "2.0" }, scenes: [{}], nodes: [] });
      const intent = await createProject3DModelUpload(admin, projectId, slotId, { fileName: "empty.glb", sizeBytes: bytes.length, scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0, reason: "Validate empty model" });
      const version = await prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: intent.versionId }, select: { sourceStorageKey: true } });
      storedKeys.add(version.sourceStorageKey);
      await storageProvider().putObject(version.sourceStorageKey, bytes, "model/gltf-binary");
      await completeProject3DModelUpload(admin, projectId, intent.versionId, "Queue empty model");
      await expect(processPendingProject3DModels({ limit: 10 })).resolves.toEqual({ processed: 1, ready: 0, failed: 1 });
      await expect(prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: intent.versionId } })).resolves.toMatchObject({ status: "FAILED", validationStatus: "BLOCKED", runtimeStorageKey: null });
    });
  });

  describe("company isolation", () => {
    it("does not accept a slot through another Project id", async () => {
      await expect(createProject3DModelUpload(admin, otherProjectId, slotId, { fileName: "cross-project.glb", sizeBytes: 100, scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0, reason: "Cross project isolation" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("concurrency", () => {
    it("relies on the worker runner's singleton lease", () => {
      expect(JOBS.find((job) => job.key === "project-3d.process-models")).toMatchObject({ concurrency: "SINGLETON", companyScope: "RECORD" });
    });
  });
});
