import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { defaultProject3DExperience } from "@/lib/3d/shared/experience";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { db } from "../db";

/** A private, disposable viewer fixture; no existing project is modified. */
export async function createSessionViewer(ownerUsername: string, platformUsername: string) {
  const owner = await db.user.findUniqueOrThrow({ where: { username: ownerUsername }, select: { id: true } });
  const platform = await db.user.findUniqueOrThrow({ where: { username: platformUsername }, select: { id: true } });
  const member = await db.companyMember.findFirstOrThrow({ where: { userId: owner.id, status: "ACTIVE", company: { status: "ACTIVE" } }, select: { companyId: true } });
  const id = `session-viewer-${randomUUID()}`;
  const companyId = member.companyId;
  const key = `companies/${companyId}/projects/${id}/3d/runtime/triangle.glb`;
  async function remove() {
    await db.project3DConfig.updateMany({ where: { projectId: id }, data: { activeReleaseId: null } });
    await db.project3DRelease.deleteMany({ where: { projectId: id } });
    await db.project3DModelVersion.deleteMany({ where: { projectId: id } });
    await db.project3DModelSlot.deleteMany({ where: { projectId: id } });
    await db.project3DConfig.deleteMany({ where: { projectId: id } });
    await db.project3DEntitlement.deleteMany({ where: { projectId: id } });
    await db.auditEvent.deleteMany({ where: { projectId: id } });
    await db.projectMember.deleteMany({ where: { projectId: id } });
    await db.project.deleteMany({ where: { id } });
    await storageProvider().deleteObject(key);
  }
  try {
    const doc = defaultProject3DExperience();
    await db.project.create({ data: { id, companyId, code: id, name: "Session logout test viewer", status: "ACTIVE", createdBy: owner.id } });
    await db.project3DEntitlement.create({ data: { projectId: id, companyId, status: "ACTIVE", viewerEnabled: true, provisionedByUserId: platform.id } });
    const config = await db.project3DConfig.create({ data: { projectId: id, companyId, experienceName: "Session logout test", visibility: "COMPANY_ONLY", authoringDocument: doc as unknown as Prisma.InputJsonValue, updatedByUserId: platform.id } });
    const slot = await db.project3DModelSlot.create({ data: { projectId: id, companyId, configId: config.id, kind: "DETAIL", role: "BUILDING", slotKey: "building", displayName: "Building" } });
    const bytes = triangleGlb();
    await storageProvider().putObject(key, bytes, "model/gltf-binary");
    const version = await db.project3DModelVersion.create({ data: {
      projectId: id, companyId, slotId: slot.id, version: 1, originalFileName: "triangle.glb",
      sourceStorageKey: `companies/${companyId}/projects/${id}/3d/source/triangle.glb`, runtimeStorageKey: key,
      storageProvider: storageProvider().key, sourceSizeBytes: BigInt(bytes.length), runtimeSizeBytes: BigInt(bytes.length),
      sourceContentType: "model/gltf-binary", runtimeContentType: "model/gltf-binary", status: "PUBLISHED", validationStatus: "READY",
      sceneManifest: [], nodeOverrides: [], unitNodeNames: [], uploadedByUserId: platform.id, publishedByUserId: platform.id, publishedAt: new Date(),
    } });
    const releaseId = `${id}-release`;
    const manifest = { schemaVersion: 1, projectId: id, companyId, releaseId, releaseNumber: 1, createdAt: new Date().toISOString(), experience: doc.config, models: [{
      slotId: slot.id, slotName: "Building", slotRole: "BUILDING", transformParentSlotId: null, versionId: version.id, versionNumber: 1,
      runtimeStorageKey: key, runtimeFileName: "triangle.glb", runtimeContentType: "model/gltf-binary",
      transform: { scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0 },
      visible: true, castShadow: true, receiveShadow: true, selectable: true, sceneManifest: [], nodeOverrides: [], unitBindings: [],
    }] };
    await db.project3DRelease.create({ data: { id: releaseId, projectId: id, companyId, configId: config.id, releaseNumber: 1, experienceSnapshot: doc as unknown as Prisma.InputJsonValue, manifest: manifest as unknown as Prisma.InputJsonValue, manifestHash: "session-test", publishedByUserId: platform.id } });
    await db.project3DConfig.update({ where: { id: config.id }, data: { activeReleaseId: releaseId } });
    return { id, companyId, remove };
  } catch (error) { await remove(); throw error; }
}

function triangleGlb(): Uint8Array {
  const binary = new Uint8Array(44);
  new Float32Array(binary.buffer, 0, 9).set([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Triangle", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [10, 10, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }], buffers: [{ byteLength: 44 }],
  }));
  const padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + padded + binary.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("glTF"));
  view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + padded); bytes.set(json, 20);
  view.setUint32(20 + padded, binary.length, true); view.setUint32(24 + padded, 0x004e4942, true);
  bytes.set(binary, 28 + padded);
  return bytes;
}
