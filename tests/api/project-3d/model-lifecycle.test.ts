import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { getProject3DEditorWorkspace, updateProject3DModelSettings } from "@/lib/modules/project-3d/project-3d.editor";
import {
  completeProject3DModelUpload,
  createProject3DModelSlot,
  createProject3DModelUpload,
  deactivateProject3DModelSlot,
  getProject3DModelStatuses,
  processProject3DModelVersion,
  project3DProcessingInRequest,
  retryProject3DModelProcessing,
} from "@/lib/modules/project-3d/project-3d.ingestion";
import { deleteProject3DModelVersion, getProject3DModelVersionUsage } from "@/lib/modules/project-3d/project-3d.model-library";
import { publishProject3DRelease } from "@/lib/modules/project-3d/project-3d.release";
import { project3DModelSettingsUpdateSchema, project3DSlotCreateSchema, project3DUploadCreateSchema } from "@/lib/modules/project-3d/project-3d.schema";
import { listProject3DModels, updateProject3DEntitlement } from "@/lib/modules/project-3d/project-3d.service";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

/**
 * A model's life in the editor after the upload: who prepares it, what counts
 * as stalled and how it is put back in line, removing a model, and the limit a
 * deployment's storage sets (Experience Editor upload fix, 2026-09-27).
 */

function oneTriangleGlb(): Uint8Array {
  const binary = new Uint8Array(44);
  new Float32Array(binary.buffer, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Tower", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    buffers: [{ byteLength: 44 }],
  }));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const total = 20 + jsonLength + 8 + binary.length;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binary.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(binary, 28 + jsonLength);
  return bytes;
}

describe("Project 3D model lifecycle", () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string;
  let companyId: string;
  let projectId: string;
  let buildingSlotId: string;

  async function uploaded(slotId: string, reason: string | null) {
    const bytes = oneTriangleGlb();
    // Through the request schema, so a body without a reason is what is tested.
    const input = project3DUploadCreateSchema.parse({ fileName: "tower.glb", sizeBytes: bytes.length, ...(reason ? { reason } : {}) });
    const intent = await createProject3DModelUpload(admin, projectId, slotId, input);
    const version = await prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: intent.versionId }, select: { sourceStorageKey: true } });
    await storageProvider().putObject(version.sourceStorageKey, bytes, "model/gltf-binary");
    await completeProject3DModelUpload(admin, projectId, intent.versionId, reason);
    return intent.versionId;
  }

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
    const group = await prisma.parentGroup.create({ data: { slug: `p3d-life-${suffix}`, name: "3D model lifecycle", status: "ACTIVE" } });
    groupId = group.id;
    const company = await prisma.company.create({ data: { slug: `p3d-life-company-${suffix}`, name: "3D lifecycle company", parentGroupId: group.id } });
    companyId = company.id;
    const project = await prisma.project.create({ data: { companyId, code: `3DL-${suffix}`.slice(0, 30), name: "3D lifecycle", status: "ACTIVE", createdBy: admin.userId } });
    projectId = project.id;
    await updateProject3DEntitlement(admin, projectId, { status: "ACTIVE", viewerEnabled: true, planKey: null, activatedAt: null, expiresAt: null, reason: "Prepare lifecycle test" });
    buildingSlotId = (await createProject3DModelSlot(admin, projectId, { kind: "DETAIL", role: "BUILDING", slotKey: "tower", displayName: "Tower", sortOrder: 0, transformParentSlotId: null, reason: "Create the tower" })).id;
  });

  afterAll(async () => {
    const versions = await prisma.project3DModelVersion.findMany({ where: { projectId }, select: { sourceStorageKey: true, runtimeStorageKey: true } });
    await prisma.project3DConfig.updateMany({ where: { projectId }, data: { activeReleaseId: null } });
    await prisma.project3DRelease.deleteMany({ where: { projectId } });
    await prisma.project3DModelVersion.deleteMany({ where: { projectId } });
    await prisma.project3DModelSlot.updateMany({ where: { projectId }, data: { transformParentSlotId: null } });
    await prisma.project3DModelSlot.deleteMany({ where: { projectId } });
    await prisma.project3DConfig.deleteMany({ where: { projectId } });
    await prisma.project3DEntitlement.deleteMany({ where: { projectId } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ parentGroupId: groupId }, { companyId }] } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.groupDepartment.deleteMany({ where: { parentGroupId: groupId } });
    await prisma.parentGroup.deleteMany({ where: { id: groupId } });
    for (const version of versions) {
      await storageProvider().deleteObject(version.sourceStorageKey).catch(() => undefined);
      if (version.runtimeStorageKey) await storageProvider().deleteObject(version.runtimeStorageKey).catch(() => undefined);
    }
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("prepares uploads in the request unless a live worker runs the documents group", async () => {
    await expect(project3DProcessingInRequest({ PROJECT_3D_PROCESSING: "worker" } as unknown as NodeJS.ProcessEnv)).resolves.toBe(false);
    await expect(project3DProcessingInRequest({ PROJECT_3D_PROCESSING: "inline" } as unknown as NodeJS.ProcessEnv)).resolves.toBe(true);
    const workerId = `lifecycle-test:${suffix}`;
    await prisma.$executeRaw`INSERT INTO "worker_processes" ("workerId", "hostname", "pid", "version", "groups", "status", "startedAt", "lastHeartbeatAt") VALUES (${workerId}, 'test', 1, 'test', ${["notifications"]}::text[], 'RUNNING', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`;
    try {
      // Another live worker on this database would change the answer; count them first.
      const [{ others }] = await prisma.$queryRaw<Array<{ others: number }>>`SELECT count(*)::int AS "others" FROM "worker_processes" WHERE "workerId" <> ${workerId} AND 'documents' = ANY("groups") AND "status" <> 'STOPPED' AND "lastHeartbeatAt" > (now() AT TIME ZONE 'UTC') - interval '60 seconds'`;
      // A worker that does not run the documents group does not prepare models.
      await expect(project3DProcessingInRequest({} as NodeJS.ProcessEnv)).resolves.toBe(others === 0);
      await prisma.$executeRaw`UPDATE "worker_processes" SET "groups" = ${["documents"]}::text[] WHERE "workerId" = ${workerId}`;
      await expect(project3DProcessingInRequest({} as NodeJS.ProcessEnv)).resolves.toBe(false);
    } finally {
      await prisma.$executeRaw`DELETE FROM "worker_processes" WHERE "workerId" = ${workerId}`;
    }
  });

  it("reports a stalled preparation, refuses to retry a live one, and puts a stalled one back in line", async () => {
    const versionId = await uploaded(buildingSlotId, "First tower");
    expect(await getProject3DModelStatuses(admin, projectId)).toEqual([{ id: versionId, status: "PROCESSING", validationStatus: "PENDING", stalled: false }]);
    await expect(retryProject3DModelProcessing(admin, projectId, versionId, "Too early")).rejects.toMatchObject({ code: "CONFLICT", details: { code: "MODEL_STILL_PROCESSING" } });

    // Columns hold UTC without a zone; the database's own zone may not be UTC.
    await prisma.$executeRaw`UPDATE "project_3d_model_versions" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '10 minutes' WHERE "id" = ${versionId}`;
    expect((await getProject3DModelStatuses(admin, projectId))[0]).toMatchObject({ stalled: true });
    expect((await getProject3DEditorWorkspace(admin, projectId)).slots[0].versions[0]).toMatchObject({ id: versionId, stalled: true, assetMissing: false, asset: null });

    await expect(retryProject3DModelProcessing(admin, projectId, versionId, "Worker crashed")).resolves.toEqual({ id: versionId, status: "PROCESSING" });
    expect((await getProject3DModelStatuses(admin, projectId))[0]).toMatchObject({ stalled: false });
    expect(await prisma.auditEvent.count({ where: { projectId, actionKey: "PLATFORM_THREE_D_MODEL_CHANGED", reason: "Worker crashed" } })).toBe(1);

    await expect(processProject3DModelVersion(versionId)).resolves.toBe("READY");
    await expect(retryProject3DModelProcessing(admin, projectId, versionId, "Not processing")).rejects.toMatchObject({ details: { code: "MODEL_NOT_PROCESSING" } });
    const workspace = await getProject3DEditorWorkspace(admin, projectId);
    expect(workspace.slots[0].versions[0]).toMatchObject({ status: "READY", stalled: false, assetMissing: false });
    expect(workspace.slots[0].versions[0].asset).not.toBeNull();
    // The product ceiling, or less when the storage has its own limit (a Supabase bucket).
    expect(workspace.uploadLimitBytes).toBeGreaterThan(0);
    expect(workspace.uploadLimitBytes).toBeLessThanOrEqual(200 * 1024 * 1024);
  });

  it("removes a model so that an empty or mistaken one no longer blocks publishing", async () => {
    const ready = await prisma.project3DModelVersion.findFirstOrThrow({ where: { projectId, slotId: buildingSlotId, status: "READY" }, select: { id: true } });
    const empty = await createProject3DModelSlot(admin, projectId, { kind: "DETAIL", role: "CONTEXT", slotKey: "surroundings", displayName: "Surroundings", sortOrder: 1, transformParentSlotId: buildingSlotId, reason: "Created by mistake" });
    await expect(publishProject3DRelease(admin, projectId, { versionIds: [ready.id], reason: "Publish the tower" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(deactivateProject3DModelSlot(admin, projectId, empty.id, "Created by mistake")).resolves.toEqual({ id: empty.id, isActive: false });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { projectId, entityId: empty.id, reason: "Created by mistake", actionKey: "PLATFORM_THREE_D_MODEL_CHANGED" }, orderBy: { occurredAt: "desc" } });
    expect(audit.afterJson).toMatchObject({ isActive: false, displayName: "Surroundings" });
    await expect(deactivateProject3DModelSlot(admin, projectId, empty.id, "Again")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getProject3DEditorWorkspace(admin, projectId)).slots.map((slot) => slot.id)).toEqual([buildingSlotId]);

    await expect(publishProject3DRelease(admin, projectId, { versionIds: [ready.id], reason: "Publish the tower" })).resolves.toMatchObject({ releaseNumber: 1, active: true });
  });

  it("clears the transform parent of models that followed a removed one", async () => {
    const follower = await createProject3DModelSlot(admin, projectId, { kind: "DETAIL", role: "UNITS", slotKey: "units", displayName: "Units", sortOrder: 2, transformParentSlotId: buildingSlotId, reason: "Units follow the tower" });
    await deactivateProject3DModelSlot(admin, projectId, buildingSlotId, "Replace the tower");
    await expect(prisma.project3DModelSlot.findUniqueOrThrow({ where: { id: follower.id } })).resolves.toMatchObject({ transformParentSlotId: null, isActive: true });
  });

  it("refuses a model larger than the storage accepts before creating a version", async () => {
    const local = storageProvider();
    const limited = Object.assign(Object.create(Object.getPrototypeOf(local)) as LocalStorageProvider, local, { maxObjectBytes: async () => 50 * 1024 * 1024 });
    setStorageProvider(limited);
    try {
      const slot = await prisma.project3DModelSlot.findFirstOrThrow({ where: { projectId, isActive: true }, select: { id: true } });
      const before = await prisma.project3DModelVersion.count({ where: { projectId } });
      await expect(createProject3DModelUpload(admin, projectId, slot.id, { fileName: "big.glb", sizeBytes: 60 * 1024 * 1024, scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0, reason: "Too big" }))
        .rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { field: "sizeBytes", limitBytes: 50 * 1024 * 1024 } });
      expect(await prisma.project3DModelVersion.count({ where: { projectId } })).toBe(before);
      expect((await getProject3DEditorWorkspace(admin, projectId)).uploadLimitBytes).toBe(50 * 1024 * 1024);
    } finally {
      setStorageProvider(local);
    }
  });

  it("takes every authoring action without a reason, and audits who, what and which version by itself", async () => {
    const annex = await createProject3DModelSlot(admin, projectId, project3DSlotCreateSchema.parse({ role: "CUSTOM", slotKey: "annex", displayName: "Annex" }));
    const first = await uploaded(annex.id, null);
    await expect(processProject3DModelVersion(first)).resolves.toBe("READY");
    const second = await uploaded(annex.id, null);
    await expect(processProject3DModelVersion(second)).resolves.toBe("READY");

    const row = await prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: second } });
    await updateProject3DModelSettings(admin, projectId, second, project3DModelSettingsUpdateSchema.parse({
      expectedUpdatedAt: row.updatedAt.toISOString(), scale: 2, rotationDeg: row.rotationDeg, altitudeOffset: row.altitudeOffset, positionX: row.positionX, positionZ: row.positionZ,
      rotationXDeg: row.rotationXDeg, rotationZDeg: row.rotationZDeg, visible: row.visible, castShadow: row.castShadow, receiveShadow: row.receiveShadow, selectable: row.selectable, transformLocked: row.transformLocked, nodeOverrides: [],
    }));

    // The admin's own actions; preparing the file is audited as the system's.
    const events = await prisma.auditEvent.findMany({ where: { projectId, actorType: "USER", OR: [{ entityId: annex.id }, { entityId: { in: [first, second] } }] }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    expect(events.every((event) => event.reason === null && event.actorUserId === admin.userId && event.actorDisplayNameSnapshot === admin.fullName)).toBe(true);
    const operations = events.map((event) => (event.metadataJson as { operation?: string } | null)?.operation);
    expect(operations).toEqual(["MODEL_ATTACHED", "MODEL_UPLOAD_STARTED", "MODEL_UPLOAD_COMPLETED", "MODEL_REPLACED", "MODEL_UPLOAD_COMPLETED", "MODEL_SETTINGS_UPDATED"]);
    expect(events[3].metadataJson).toMatchObject({ oldVersion: 1, newVersion: 2, summary: "Annex: version 1 → 2" });
    expect(events[5].metadataJson).toMatchObject({ summary: "1 model property changed", changedProperties: ["scale"] });
  });

  it("deletes a model file permanently only when nothing still uses it", async () => {
    const annex = await prisma.project3DModelSlot.findFirstOrThrow({ where: { projectId, slotKey: "annex" }, include: { versions: { orderBy: { version: "asc" } } } });
    const [older, newest] = annex.versions;

    // The version the Experience shows must be removed from it first.
    await expect(getProject3DModelVersionUsage(admin, newest.id)).resolves.toMatchObject({ blockers: ["SHOWN_IN_EXPERIENCE"], shownInExperience: true, releases: [] });
    await expect(deleteProject3DModelVersion(admin, newest.id)).rejects.toMatchObject({ code: "CONFLICT", details: { code: "MODEL_IN_USE", blockers: ["SHOWN_IN_EXPERIENCE"] } });

    // A released version stays restorable, even after its model left the Experience.
    const released = await prisma.project3DModelVersion.findFirstOrThrow({ where: { projectId, status: "PUBLISHED" } });
    await expect(getProject3DModelVersionUsage(admin, released.id)).resolves.toMatchObject({ blockers: ["RELEASED"], releases: [1] });
    await expect(deleteProject3DModelVersion(admin, released.id)).rejects.toMatchObject({ details: { code: "MODEL_IN_USE" } });
    await expect(storageProvider().headObject(released.runtimeStorageKey!)).resolves.not.toBeNull();

    // Permission first: confirmation never replaces it.
    const withoutDelete = { ...admin, permissions: admin.permissions.filter((permission) => permission !== "platform.3d.model.delete") };
    await expect(deleteProject3DModelVersion(withoutDelete, older.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(getProject3DModelVersionUsage(admin, older.id)).resolves.toMatchObject({ blockers: [], bindingCount: 0 });
    await expect(deleteProject3DModelVersion(admin, older.id)).resolves.toEqual({ id: older.id, unitBindingsRemoved: 0 });
    await expect(prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: older.id } })).resolves.toMatchObject({ deletedByUserId: admin.userId, deletedAt: expect.any(Date) });
    await expect(storageProvider().headObject(older.sourceStorageKey)).resolves.toBeNull();
    await expect(storageProvider().headObject(older.runtimeStorageKey!)).resolves.toBeNull();
    expect((await listProject3DModels(admin)).some((model) => model.id === older.id)).toBe(false);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: older.id }, orderBy: { occurredAt: "desc" } });
    expect(audit).toMatchObject({ reason: null, actorUserId: admin.userId });
    expect(audit.metadataJson).toMatchObject({ operation: "MODEL_FILE_DELETED" });
    await expect(deleteProject3DModelVersion(admin, older.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("puts a model whose preparation failed on the server back in line, but not one validation refused", async () => {
    const annex = await prisma.project3DModelSlot.findFirstOrThrow({ where: { projectId, slotKey: "annex" }, select: { id: true } });
    const versionId = await uploaded(annex.id, null);
    await prisma.project3DModelVersion.update({ where: { id: versionId }, data: { status: "FAILED", validationStatus: "BLOCKED", processingDiagnostics: { stage: "failed", message: "Model processing failed. Review the source GLB and retry with a new version.", error: "Error: boom" } } });
    expect((await getProject3DEditorWorkspace(admin, projectId)).slots.find((slot) => slot.id === annex.id)!.versions[0]).toMatchObject({ id: versionId, retryable: true });
    await expect(retryProject3DModelProcessing(admin, projectId, versionId)).resolves.toEqual({ id: versionId, status: "PROCESSING" });
    await expect(processProject3DModelVersion(versionId)).resolves.toBe("READY");

    await prisma.project3DModelVersion.update({ where: { id: versionId }, data: { status: "FAILED", processingDiagnostics: { stage: "failed", message: "GLB validation blocked this version." } } });
    await expect(retryProject3DModelProcessing(admin, projectId, versionId)).rejects.toMatchObject({ details: { code: "MODEL_NOT_PROCESSING" } });
  });
});
