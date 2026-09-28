import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { Document, NodeIO } from "@gltf-transform/core";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider } from "@/lib/core/storage/storage-provider.factory";
import { deliverProject3DAsset } from "@/lib/modules/project-3d/project-3d.delivery";
import { setProject3DVisibility } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { approveProject3DPublicProjection, getProject3DPublicPreview, getPublic3DBootstrap, getPublic3DStatus, prepareProject3DPublicProjection } from "@/lib/modules/project-3d/project-3d.public";
import { activateProject3DRelease, publishProject3DRelease } from "@/lib/modules/project-3d/project-3d.release";
import { getProject3DViewerBootstrap } from "@/lib/modules/project-3d/project-3d.viewer";
import { parseGlbJsonChunk } from "@/lib/modules/project-3d/processing/glb.validate";
import { cleanupSessions, COMPANY, loginAs, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

/**
 * ADM-04A Part B against real PostgreSQL and real model bytes: the public
 * projection, its approval, anonymous viewing and revocation — EV-04, EV-05,
 * EV-07, EV-08, EV-09, EV-11, EV-12, EV-14.
 */

/** Words planted in the model and records that must never reach a public visitor. */
const SECRETS = ["Jane Buyer", "Private Architect", "Secret_Owner", "Owner Private Material", "secret-texture", "internal cost", "CV-101", "41.327546", "Company Viewer"];

function pngWithText(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from("Author\0Jane Buyer")),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk("IEND", new Uint8Array()),
  ]);
}

async function leakyGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const triangle = () => doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const texture = doc.createTexture("secret-texture.png").setImage(pngWithText()).setMimeType("image/png").setURI("secret-texture.png");
  const material = doc.createMaterial("Owner Private Material").setBaseColorTexture(texture).setExtras({ note: "internal cost 900k" });
  const mesh = (name: string) => doc.createMesh(name).addPrimitive(doc.createPrimitive().setAttribute("POSITION", triangle()).setMaterial(material));
  const scene = doc.createScene("Private Architect scene");
  scene.addChild(doc.createNode("Unit_CV-101").setMesh(mesh("Unit_CV-101")).setExtras({ buyer: "Jane Buyer" }));
  scene.addChild(doc.createNode("Glass_Front").setMesh(mesh("Glass_Front")));
  scene.addChild(doc.createNode("Secret_Owner_Layer").setMesh(mesh("Secret_Owner_Layer")));
  doc.getRoot().getAsset().copyright = "Private Architect Ltd";
  return new NodeIO().writeBinary(doc);
}

describe("public 3D projection and anonymous viewer", () => {
  const tag = `p3d-pub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let storageRoot: string;
  let local: LocalStorageProvider;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let projectId: string;
  let unitId: string;
  let versionId: string;
  let runtimeKey: string;
  let publicId: string;
  let firstReleaseId: string;
  let publicHandleUrl: string;

  const control = () => prisma.project3DConfig.findUniqueOrThrow({ where: { projectId }, select: { controlVersion: true, publicId: true, activeReleaseId: true } });
  const setVisibility = async (visibility: "OFFLINE" | "PUBLIC" | "COMPANY_ONLY", extra: { releaseId?: string; publicManifestHash?: string } = {}) =>
    setProject3DVisibility(admin, projectId, { visibility, expectedControlVersion: (await control()).controlVersion, reason: `Set ${visibility}`, ...extra });
  const fetchPublic = (url: string, headers: Record<string, string> = {}) =>
    deliverProject3DAsset(new Request(`http://localhost${url}`, { headers }), url.split("/").pop()!, { audience: "public", publicId });

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-public-3d-"));
    local = new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" });
    setStorageProvider(local);
    [owner, admin] = await Promise.all([loginAs("OWNER"), loginAsPlatformAdmin()]);

    const project = await prisma.project.create({ data: { companyId: COMPANY.a, code: tag.slice(0, 30), name: "Company Viewer Private Name", status: "ACTIVE", city: "Durrës", createdBy: owner.userId } });
    projectId = project.id;
    const unitType = await prisma.projectUnitType.create({ data: { companyId: COMPANY.a, name: `Public type ${tag}`, code: tag.toUpperCase(), category: "RESIDENTIAL", createdBy: owner.userId } });
    const building = await prisma.projectBuilding.create({ data: { companyId: COMPANY.a, projectId, name: "Tower", nameKey: `TOWER ${tag}`.toUpperCase(), sortOrder: 1, createdBy: owner.userId } });
    const floor = await prisma.projectFloor.create({ data: { companyId: COMPANY.a, projectId, buildingId: building.id, number: 3, name: "Floor 3", levelType: "STANDARD", floorKey: "STANDARD:3", sortOrder: 1, createdBy: owner.userId } });
    const unit = await prisma.projectUnit.create({ data: { companyId: COMPANY.a, projectId, floorId: floor.id, unitCode: "CV-101", unitCodeKey: "CV-101", unitTypeId: unitType.id, sortOrder: 1, createdBy: owner.userId } });
    unitId = unit.id;
    await prisma.unitCommercialProfile.create({ data: { companyId: COMPANY.a, projectId, unitId, status: "RESERVED" } });
    await prisma.project3DEntitlement.create({ data: { companyId: COMPANY.a, projectId, status: "ACTIVE", viewerEnabled: true, activatedAt: new Date(Date.now() - 60_000), provisionedByUserId: admin.userId } });
    const config = await prisma.project3DConfig.create({
      data: {
        companyId: COMPANY.a, projectId, visibility: "COMPANY_ONLY", experienceName: "Company Viewer 3D", updatedByUserId: admin.userId,
        authoringDocument: { schemaVersion: 1, revision: 1, config: { ...DEFAULT_PROJECT_3D_CONFIG, geoLatitude: 41.327546, mapViewLatitude: 41.327546, cameraPresets: [{ id: "internal", label: "Jane Buyer's balcony", position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, fov: 45, durationMs: 800 }] } } as unknown as Prisma.InputJsonValue,
      },
    });
    publicId = config.publicId;
    const slot = await prisma.project3DModelSlot.create({ data: { companyId: COMPANY.a, projectId, configId: config.id, role: "UNITS", slotKey: "units", displayName: "Unit blocks" } });
    runtimeKey = `companies/${COMPANY.a}/projects/${projectId}/3d/runtime/${tag}.glb`;
    const bytes = await leakyGlb();
    await local.putObject(runtimeKey, bytes, "model/gltf-binary");
    const version = await prisma.project3DModelVersion.create({
      data: {
        companyId: COMPANY.a, projectId, slotId: slot.id, version: 1, originalFileName: "Private Architect.glb",
        sourceStorageKey: `companies/${COMPANY.a}/projects/${projectId}/3d/source/${tag}.glb`, runtimeStorageKey: runtimeKey, storageProvider: "local",
        sourceSizeBytes: BigInt(bytes.byteLength), runtimeSizeBytes: BigInt(bytes.byteLength), sourceContentType: "model/gltf-binary", runtimeContentType: "model/gltf-binary",
        validationStatus: "READY", status: "READY", unitNodeNames: ["Unit_CV-101"],
        sceneManifest: [{ nodeId: "node_0_unit_cv_101", name: "Unit_CV-101", meshIndex: 0, parentNodeId: null, depth: 0, isMesh: true, autoClassification: "unit_block" }],
        nodeOverrides: [{ nodeId: "node_1_glass_front", opacity: 0.4 }],
        uploadedByUserId: admin.userId,
      },
    });
    versionId = version.id;
    await prisma.project3DUnitMeshBinding.create({ data: { companyId: COMPANY.a, projectId, modelVersionId: versionId, projectUnitId: unitId, meshName: "Unit_CV-101", mappingStatus: "MAPPED", mappedByUserId: admin.userId } });
    firstReleaseId = (await publishProject3DRelease(admin, projectId, { versionIds: [versionId], reason: null })).id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { projectId } });
    await prisma.project3DMutationRequest.deleteMany({ where: { projectId } });
    await prisma.project3DConfig.updateMany({ where: { projectId }, data: { activeReleaseId: null } });
    await prisma.project3DRelease.deleteMany({ where: { projectId } });
    await prisma.project3DUnitMeshBinding.deleteMany({ where: { projectId } });
    await prisma.project3DModelVersion.deleteMany({ where: { projectId } });
    await prisma.project3DModelSlot.deleteMany({ where: { projectId } });
    await prisma.project3DConfig.deleteMany({ where: { projectId } });
    await prisma.project3DEntitlement.deleteMany({ where: { projectId } });
    await prisma.unitCommercialProfile.deleteMany({ where: { projectId } });
    await prisma.projectUnit.deleteMany({ where: { projectId } });
    await prisma.projectFloor.deleteMany({ where: { projectId } });
    await prisma.projectBuilding.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.projectUnitType.deleteMany({ where: { code: tag.toUpperCase() } });
    setStorageProvider(null);
    await rm(storageRoot, { recursive: true, force: true });
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("EV-04: refuses PUBLIC until a reviewed projection of the active release is approved", async () => {
    await expect(setVisibility("PUBLIC")).rejects.toMatchObject({ details: { code: "PUBLIC_NOT_READY", blockers: ["PUBLIC_PROJECTION_MISSING"] } });
    expect(await getPublic3DStatus(publicId)).toEqual({ state: "LOGIN_REQUIRED", token: null });
  });

  it("EV-11: the prepared projection and its model bytes carry nothing that was not approved", async () => {
    const prepared = await prepareProject3DPublicProjection(admin, projectId, { releaseId: firstReleaseId, title: "Harbour Residences", fields: ["availability", "unitFloor"] });
    const json = JSON.stringify(prepared.manifest);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(json).not.toContain(unitId);
    expect(json).not.toContain(projectId);
    expect(json).not.toContain(COMPANY.a);
    expect(json).not.toContain("storageKey");
    expect(prepared.manifest.units).toEqual([{ ref: "u1", label: "Unit 1", code: null, floor: 3, type: null, area: null, status: "reserved" }]);
    expect(prepared.manifest.experience.mapViewEnabled).toBe(false);
    expect((prepared.manifest.experience.cameraPresets as Array<{ label: string }>)[0].label).toBe("View 1");

    const model = prepared.manifest.models[0];
    const unitNode = model.sceneManifest.find((node) => node.name.startsWith("Unit_"))!;
    expect(model.unitBindings).toEqual([expect.objectContaining({ meshName: unitNode.name, unitRef: "u1" })]);
    expect(model.sceneManifest.some((node) => node.name.startsWith("Glass_"))).toBe(true);
    expect(model.nodeOverrides).toEqual([expect.objectContaining({ opacity: 0.4, nodeId: model.sceneManifest.find((node) => node.name.startsWith("Glass_"))!.nodeId })]);

    // The artifact itself, byte for byte.
    const release = await prisma.project3DRelease.findUniqueOrThrow({ where: { id: firstReleaseId }, select: { publicArtifactKeys: true } });
    const artifact = (release.publicArtifactKeys as Record<string, { key: string }>).m1.key;
    const bytes = (await local.getObject(artifact))!;
    const text = Buffer.from(bytes).toString("latin1");
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    const glbJson = JSON.stringify(parseGlbJsonChunk(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    expect(glbJson).not.toMatch(/"extras"|"copyright"|"uri"/);
  });

  it("EV-05/EV-07: approved and public, an anonymous visitor views it without any session — and gets nothing internal", async () => {
    const preview = await getProject3DPublicPreview(admin, projectId, firstReleaseId);
    if (!preview.prepared) throw new Error("expected a prepared projection");
    await expect(approveProject3DPublicProjection(admin, projectId, { releaseId: firstReleaseId, publicManifestHash: "0".repeat(64), confirmPublicDistribution: true, reason: "Wrong hash" })).rejects.toMatchObject({ details: { code: "PUBLIC_REVIEW_STALE" } });
    await approveProject3DPublicProjection(admin, projectId, { releaseId: firstReleaseId, publicManifestHash: preview.publicManifestHash, confirmPublicDistribution: true, reason: "Approved for the launch" });
    await expect(setVisibility("PUBLIC", { releaseId: firstReleaseId, publicManifestHash: "f".repeat(64) })).rejects.toMatchObject({ details: { code: "PUBLIC_REVIEW_STALE" } });
    await setVisibility("PUBLIC", { releaseId: firstReleaseId, publicManifestHash: preview.publicManifestHash });

    const memberships = await prisma.companyMember.count();
    const result = await getPublic3DBootstrap(publicId);
    if (result.state !== "AVAILABLE") throw new Error(`expected AVAILABLE, got ${result.state}`);
    const json = JSON.stringify(result.bootstrap);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    expect(json).not.toContain(unitId);
    expect(json).not.toContain(`/units/`);
    publicHandleUrl = result.bootstrap.models[0].assetUrl;
    expect(publicHandleUrl).toMatch(new RegExp(`^/api/public/3d/${publicId}/assets/`));
    const asset = await fetchPublic(publicHandleUrl, { range: "bytes=0-3" });
    expect(asset.status).toBe(206);
    expect(Buffer.from(await asset.arrayBuffer()).toString("latin1")).toBe("glTF");
    expect(await prisma.companyMember.count()).toBe(memberships);

    // Public does not close the internal route to those it was open to.
    await expect(getProject3DViewerBootstrap(owner, projectId)).resolves.toMatchObject({ release: { id: firstReleaseId } });
  });

  it("EV-12: public unit facts stay the approved snapshot; the preview says they are stale", async () => {
    await prisma.unitCommercialProfile.update({ where: { unitId }, data: { status: "SOLD" } });
    const preview = await getProject3DPublicPreview(admin, projectId, firstReleaseId);
    expect(preview).toMatchObject({ prepared: true, approved: true, stale: true });
    const result = await getPublic3DBootstrap(publicId);
    expect(result.state === "AVAILABLE" && result.bootstrap.units[0].status).toBe("reserved");
  });

  it("EV-14: while public, a new release is staged; a failed preparation leaves the live one serving; approval moves it live", async () => {
    const staged = await publishProject3DRelease(admin, projectId, { versionIds: [versionId], reason: null });
    expect(staged).toMatchObject({ active: false, needsPublicReview: true });
    expect((await control()).activeReleaseId).toBe(firstReleaseId);
    await expect(activateProject3DRelease(admin, projectId, staged.id)).rejects.toMatchObject({ details: { code: "PUBLIC_PROJECTION_REQUIRED" } });

    const bytes = (await local.getObject(runtimeKey))!;
    await local.deleteObject(runtimeKey);
    await expect(prepareProject3DPublicProjection(admin, projectId, { releaseId: staged.id, title: "Harbour Residences", fields: [] })).rejects.toMatchObject({ details: { code: "PUBLIC_SANITIZATION_FAILED" } });
    expect((await getPublic3DStatus(publicId)).state).toBe("AVAILABLE");
    expect((await fetchPublic(publicHandleUrl)).status).toBe(200);
    await local.putObject(runtimeKey, bytes, "model/gltf-binary");

    const prepared = await prepareProject3DPublicProjection(admin, projectId, { releaseId: staged.id, title: "Harbour Residences", fields: [] });
    const approved = await approveProject3DPublicProjection(admin, projectId, { releaseId: staged.id, publicManifestHash: prepared.publicManifestHash, confirmPublicDistribution: true, reason: "Release 2 approved" });
    expect(approved.live).toBe(true);
    expect((await control()).activeReleaseId).toBe(staged.id);
    // The handle for the release that was live before no longer works.
    expect((await fetchPublic(publicHandleUrl)).status).toBe(404);
    const next = await getPublic3DBootstrap(publicId);
    if (next.state !== "AVAILABLE") throw new Error("expected AVAILABLE");
    publicHandleUrl = next.bootstrap.models[0].assetUrl;
    expect((await fetchPublic(publicHandleUrl)).status).toBe(200);
  });

  it("EV-09/EV-08: company-only closes anonymous delivery at once; offline closes everything", async () => {
    await setVisibility("COMPANY_ONLY");
    expect((await fetchPublic(publicHandleUrl, { range: "bytes=0-3" })).status).toBe(404);
    expect(await getPublic3DStatus(publicId)).toEqual({ state: "LOGIN_REQUIRED", token: null });
    expect(await getPublic3DBootstrap(publicId)).toEqual({ state: "LOGIN_REQUIRED" });
    await expect(getProject3DViewerBootstrap(owner, projectId)).resolves.toBeTruthy();

    await setVisibility("OFFLINE");
    expect(await getPublic3DStatus(publicId)).toEqual({ state: "UNAVAILABLE", token: null });
    await expect(getProject3DViewerBootstrap(owner, projectId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getPublic3DStatus("not-a-real-id")).toEqual({ state: "UNAVAILABLE", token: null });
    expect(await getPublic3DStatus("../../etc")).toEqual({ state: "UNAVAILABLE", token: null });
  });
});
