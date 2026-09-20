import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider } from "@/lib/core/storage/storage-provider.factory";
import { publishProject3DRelease } from "@/lib/modules/project-3d/project-3d.release";
import { getProject3DViewerBootstrap, hasActiveProject3DViewer } from "@/lib/modules/project-3d/project-3d.viewer";
import { cleanupSessions, COMPANY, loginAs, loginAsPlatformAdmin, prisma, PROJECT } from "@/tests/helpers";

describe("Company Project 3D viewer", () => {
  const tag = `p3d-view-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let storageRoot: string;
  let owner: Awaited<ReturnType<typeof loginAs>>;
  let projectManager: Awaited<ReturnType<typeof loginAs>>;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let projectId: string;
  let unitTypeId: string;
  let unitId: string;
  let versionId: string;
  let sourceStorageKey: string;
  let runtimeStorageKey: string;

  beforeAll(async () => {
    storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-project-3d-viewer-"));
    setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
    [owner, projectManager, admin] = await Promise.all([loginAs("OWNER"), loginAs("PROJECT_MANAGER"), loginAsPlatformAdmin()]);

    const project = await prisma.project.create({
      data: { companyId: COMPANY.a, code: tag.slice(0, 30), name: "Company Viewer Test", status: "ACTIVE", createdBy: owner.userId },
    });
    projectId = project.id;
    const unitType = await prisma.projectUnitType.create({
      data: { companyId: COMPANY.a, name: `Viewer type ${tag}`, code: tag.toUpperCase(), category: "RESIDENTIAL", createdBy: owner.userId },
    });
    unitTypeId = unitType.id;
    const building = await prisma.projectBuilding.create({
      data: { companyId: COMPANY.a, projectId, name: "Viewer tower", nameKey: `VIEWER TOWER ${tag}`.toUpperCase(), sortOrder: 1, createdBy: owner.userId },
    });
    const floor = await prisma.projectFloor.create({
      data: { companyId: COMPANY.a, projectId, buildingId: building.id, number: 1, name: "Floor 1", levelType: "STANDARD", floorKey: "STANDARD:1", sortOrder: 1, createdBy: owner.userId },
    });
    const unit = await prisma.projectUnit.create({
      data: { companyId: COMPANY.a, projectId, floorId: floor.id, unitCode: "CV-101", unitCodeKey: "CV-101", unitTypeId, sortOrder: 1, createdBy: owner.userId },
    });
    unitId = unit.id;
    await prisma.unitCommercialProfile.create({ data: { companyId: COMPANY.a, projectId, unitId, status: "RESERVED" } });

    const config = await prisma.project3DConfig.create({
      data: {
        companyId: COMPANY.a,
        projectId,
        authoringDocument: { schemaVersion: 1, revision: 1, config: DEFAULT_PROJECT_3D_CONFIG } as unknown as Prisma.InputJsonValue,
        updatedByUserId: admin.userId,
      },
    });
    const slot = await prisma.project3DModelSlot.create({
      data: { companyId: COMPANY.a, projectId, configId: config.id, role: "UNITS", slotKey: "units", displayName: "Unit blocks" },
    });
    sourceStorageKey = `companies/${COMPANY.a}/projects/${projectId}/3d/source/${tag}.glb`;
    runtimeStorageKey = `companies/${COMPANY.a}/projects/${projectId}/3d/runtime/${tag}.glb`;
    const version = await prisma.project3DModelVersion.create({
      data: {
        companyId: COMPANY.a,
        projectId,
        slotId: slot.id,
        version: 1,
        originalFileName: "viewer.glb",
        sourceStorageKey,
        runtimeStorageKey,
        storageProvider: "local",
        sourceSizeBytes: BigInt(120),
        runtimeSizeBytes: BigInt(100),
        sourceContentType: "model/gltf-binary",
        runtimeContentType: "model/gltf-binary",
        validationStatus: "READY",
        status: "READY",
        unitNodeNames: ["Unit_CV-101"],
        sceneManifest: [{ nodeId: "node_0", name: "Unit_CV-101", meshIndex: 0, parentNodeId: null, depth: 0, isMesh: true, autoClassification: "unit_block" }],
        uploadedByUserId: admin.userId,
      },
    });
    versionId = version.id;
    await prisma.project3DUnitMeshBinding.create({
      data: { companyId: COMPANY.a, projectId, modelVersionId: versionId, projectUnitId: unitId, meshName: "Unit_CV-101", mappingStatus: "MAPPED", mappedByUserId: admin.userId },
    });
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.auditEvent.deleteMany({ where: { projectId } });
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
    }
    if (unitTypeId) await prisma.projectUnitType.deleteMany({ where: { id: unitTypeId } });
    setStorageProvider(null);
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("requires an active entitlement and an active published release", async () => {
    await expect(hasActiveProject3DViewer(owner, projectId)).resolves.toBe(false);
    await expect(getProject3DViewerBootstrap(owner, projectId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await prisma.project3DEntitlement.create({
      data: { companyId: COMPANY.a, projectId, status: "INACTIVE", viewerEnabled: true, provisionedByUserId: admin.userId },
    });
    await expect(hasActiveProject3DViewer(owner, projectId)).resolves.toBe(false);
    await prisma.project3DEntitlement.update({
      where: { projectId },
      data: { status: "ACTIVE", activatedAt: new Date(Date.now() - 60_000) },
    });
    await expect(hasActiveProject3DViewer(owner, projectId)).resolves.toBe(false);

    await publishProject3DRelease(admin, projectId, { versionIds: [versionId], reason: "Publish the Company viewer fixture" });
    await expect(hasActiveProject3DViewer(owner, projectId)).resolves.toBe(true);

    await prisma.project3DEntitlement.update({ where: { projectId }, data: { status: "SUSPENDED" } });
    await expect(hasActiveProject3DViewer(owner, projectId)).resolves.toBe(false);
    await expect(getProject3DViewerBootstrap(owner, projectId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.project3DEntitlement.update({ where: { projectId }, data: { status: "ACTIVE", expiresAt: new Date(Date.now() - 1_000) } });
    await expect(hasActiveProject3DViewer(owner, projectId)).resolves.toBe(false);
    await prisma.project3DEntitlement.update({ where: { projectId }, data: { expiresAt: new Date(Date.now() + 60_000) } });
    await expect(hasActiveProject3DViewer(owner, projectId)).resolves.toBe(true);
  });

  it("returns only the active release contract with signed runtime assets and canonical units", async () => {
    await prisma.project3DModelVersion.update({
      where: { id: versionId },
      data: { processingDiagnostics: { privateMarker: "diagnostic-must-not-leak" } },
    });
    await prisma.project3DConfig.update({
      where: { projectId },
      data: { authoringDocument: { schemaVersion: 1, revision: 99, draftMarker: "draft-must-not-leak", config: { ...DEFAULT_PROJECT_3D_CONFIG, exposure: 99 } } as unknown as Prisma.InputJsonValue },
    });

    const bootstrap = await getProject3DViewerBootstrap(owner, projectId);
    expect(bootstrap).toMatchObject({
      project: { id: projectId, name: "Company Viewer Test" },
      release: { number: 1 },
      experience: { exposure: 1 },
      units: [{ id: unitId, code: "CV-101", status: "reserved" }],
      capabilities: { unitDetails: true },
      models: [{ transformParentSlotId: null, unitBindings: [{ unitId, unitCode: "CV-101" }] }],
    });
    expect(bootstrap.models[0]?.asset.url).toContain(`/api/storage/objects/companies/${COMPANY.a}/projects/${projectId}/3d/runtime/`);
    expect(bootstrap.models[0]).not.toHaveProperty("runtimeStorageKey");
    const serialized = JSON.stringify(bootstrap);
    expect(serialized).not.toContain(sourceStorageKey);
    expect(serialized).not.toContain("diagnostic-must-not-leak");
    expect(serialized).not.toContain("draft-must-not-leak");
  });

  it("enforces current-company and project scope before returning viewer data", async () => {
    await expect(hasActiveProject3DViewer(projectManager, projectId)).resolves.toBe(false);
    await expect(getProject3DViewerBootstrap(projectManager, projectId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(hasActiveProject3DViewer(owner, PROJECT.companyB)).resolves.toBe(false);
    await expect(getProject3DViewerBootstrap(owner, PROJECT.companyB)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
