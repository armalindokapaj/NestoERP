import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { DEFAULT_PROJECT_3D_CONFIG } from "@/lib/3d/shared/experience";
import { getProject3DUnitBindingWorkspace, replaceProject3DUnitBindings } from "@/lib/modules/project-3d/project-3d.binding";
import { getProject3DEditorWorkspace, updateProject3DExperience, updateProject3DModelSettings } from "@/lib/modules/project-3d/project-3d.editor";
import { activateProject3DRelease, publishProject3DRelease } from "@/lib/modules/project-3d/project-3d.release";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

type Fixture = { companyId: string; projectId: string; unitTypeId: string; buildingId: string; floorId: string; unitId: string };

describe("Platform 3D unit bindings", () => {
  const tag = `p3d-bind-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string;
  let versionId: string;
  let primary: Fixture;
  let anotherProject: Fixture;
  let anotherCompany: Fixture;
  let inactiveUnitId: string;

  async function createFixture(companyId: string, projectLabel: string): Promise<Fixture> {
    const project = await prisma.project.create({
      data: { companyId, code: `${tag}-${projectLabel}`.slice(0, 30), name: `Binding ${projectLabel}`, status: "ACTIVE", createdBy: admin.userId },
    });
    const unitType = await prisma.projectUnitType.create({
      data: { companyId, name: `Apartment ${projectLabel}`, code: `APT_${projectLabel}`.toUpperCase(), category: "RESIDENTIAL", createdBy: admin.userId },
    });
    const building = await prisma.projectBuilding.create({
      data: { companyId, projectId: project.id, name: `Tower ${projectLabel}`, nameKey: `TOWER ${projectLabel}`.toUpperCase(), sortOrder: 1, createdBy: admin.userId },
    });
    const floor = await prisma.projectFloor.create({
      data: { companyId, projectId: project.id, buildingId: building.id, number: 1, name: "Floor 1", levelType: "STANDARD", floorKey: "STANDARD:1", sortOrder: 1, createdBy: admin.userId },
    });
    const unit = await prisma.projectUnit.create({
      data: { companyId, projectId: project.id, floorId: floor.id, unitCode: "A-101", unitCodeKey: "A-101", unitTypeId: unitType.id, sortOrder: 1, createdBy: admin.userId },
    });
    return { companyId, projectId: project.id, unitTypeId: unitType.id, buildingId: building.id, floorId: floor.id, unitId: unit.id };
  }

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
    const group = await prisma.parentGroup.create({ data: { slug: tag, name: "3D binding group", status: "ACTIVE" } });
    groupId = group.id;
    const [company, otherCompany] = await Promise.all([
      prisma.company.create({ data: { slug: `${tag}-a`, name: "3D binding A", parentGroupId: group.id } }),
      prisma.company.create({ data: { slug: `${tag}-b`, name: "3D binding B", parentGroupId: group.id } }),
    ]);
    primary = await createFixture(company.id, "primary");
    anotherProject = await createFixture(company.id, "other-project");
    anotherCompany = await createFixture(otherCompany.id, "other-company");
    const inactive = await prisma.projectUnit.create({
      data: {
        companyId: primary.companyId,
        projectId: primary.projectId,
        floorId: primary.floorId,
        unitCode: "A-102",
        unitCodeKey: "A-102",
        unitTypeId: primary.unitTypeId,
        sortOrder: 2,
        isActive: false,
        createdBy: admin.userId,
      },
    });
    inactiveUnitId = inactive.id;

    await prisma.project3DEntitlement.create({
      data: { companyId: primary.companyId, projectId: primary.projectId, status: "ACTIVE", viewerEnabled: true, activatedAt: new Date(Date.now() - 60_000), provisionedByUserId: admin.userId },
    });

    const config = await prisma.project3DConfig.create({
      data: { companyId: primary.companyId, projectId: primary.projectId, authoringDocument: { schemaVersion: 1, revision: 1 }, updatedByUserId: admin.userId },
    });
    const slot = await prisma.project3DModelSlot.create({
      data: { companyId: primary.companyId, projectId: primary.projectId, configId: config.id, role: "UNITS", slotKey: "units", displayName: "Unit blocks" },
    });
    const version = await prisma.project3DModelVersion.create({
      data: {
        companyId: primary.companyId,
        projectId: primary.projectId,
        slotId: slot.id,
        version: 1,
        originalFileName: "units.glb",
        sourceStorageKey: `companies/${primary.companyId}/projects/${primary.projectId}/3d/source/${tag}.glb`,
        runtimeStorageKey: `companies/${primary.companyId}/projects/${primary.projectId}/3d/runtime/${tag}.glb`,
        storageProvider: "test",
        sourceSizeBytes: BigInt(100),
        runtimeSizeBytes: BigInt(80),
        sourceContentType: "model/gltf-binary",
        runtimeContentType: "model/gltf-binary",
        validationStatus: "READY",
        status: "READY",
        unitNodeNames: ["Unit_A-101", "Unit_A-102"],
        sceneManifest: [
          { nodeId: "node_0", name: "Unit_A-101", meshIndex: 0, parentNodeId: null, depth: 0, isMesh: true, autoClassification: "unit_block" },
          { nodeId: "node_1", name: "Unit_A-102", meshIndex: 1, parentNodeId: null, depth: 0, isMesh: true, autoClassification: "unit_block" },
        ],
        uploadedByUserId: admin.userId,
      },
    });
    versionId = version.id;
  });

  afterAll(async () => {
    const fixtures = [primary, anotherProject, anotherCompany].filter((fixture): fixture is Fixture => Boolean(fixture));
    const projectIds = fixtures.map((fixture) => fixture.projectId);
    if (versionId) await prisma.project3DUnitMeshBinding.deleteMany({ where: { modelVersionId: versionId } });
    if (projectIds.length > 0) {
      await prisma.project3DModelVersion.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project3DModelSlot.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project3DConfig.updateMany({ where: { projectId: { in: projectIds } }, data: { activeReleaseId: null } });
      await prisma.project3DRelease.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project3DConfig.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project3DEntitlement.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectUnit.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectFloor.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectBuilding.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.projectUnitType.deleteMany({ where: { id: { in: fixtures.map((fixture) => fixture.unitTypeId) } } });
      await prisma.company.deleteMany({ where: { id: { in: Array.from(new Set(fixtures.map((fixture) => fixture.companyId))) } } });
    }
    if (groupId) {
      await prisma.auditEvent.deleteMany({ where: { parentGroupId: groupId } });
      await prisma.groupDepartment.deleteMany({ where: { parentGroupId: groupId } });
      await prisma.parentGroup.deleteMany({ where: { id: groupId } });
    }
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("returns detected nodes and only active canonical units from the model project", async () => {
    await expect(getProject3DUnitBindingWorkspace(admin, primary.projectId, versionId)).resolves.toMatchObject({
      detectedNodes: ["Unit_A-101", "Unit_A-102"],
      units: [{ id: primary.unitId, unitCode: "A-101" }],
      bindings: [],
    });
  });

  it("replaces links atomically and records an audit event", async () => {
    await expect(replaceProject3DUnitBindings(admin, primary.projectId, versionId, {
      bindings: [{ meshName: "Unit_A-101", projectUnitId: primary.unitId, mappingStatus: "MAPPED", poiYawDeg: 15, poiEnabled: true, poiDistanceOverride: null, poiHeightOverride: null }],
      reason: "Map the processed unit node",
    })).resolves.toMatchObject([{ meshName: "Unit_A-101", projectUnitId: primary.unitId, poiYawDeg: 15 }]);
    await expect(prisma.auditEvent.findFirstOrThrow({ where: { parentGroupId: groupId, actionKey: "PLATFORM_THREE_D_BINDING_CHANGED" } })).resolves.toMatchObject({
      projectId: primary.projectId,
      beforeJson: { projectId: primary.projectId, versionId, bindingCount: 0 },
      afterJson: { projectId: primary.projectId, versionId, bindingCount: 1 },
    });
  });

  it("rejects duplicate nodes and duplicate canonical units", async () => {
    const base = { mappingStatus: "MAPPED" as const, poiYawDeg: 0, poiEnabled: true, poiDistanceOverride: null, poiHeightOverride: null };
    await expect(replaceProject3DUnitBindings(admin, primary.projectId, versionId, {
      bindings: [
        { ...base, meshName: "Unit_A-101", projectUnitId: primary.unitId },
        { ...base, meshName: "Unit_A-101", projectUnitId: inactiveUnitId },
      ],
      reason: "Reject repeated scene nodes",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(replaceProject3DUnitBindings(admin, primary.projectId, versionId, {
      bindings: [
        { ...base, meshName: "Unit_A-101", projectUnitId: primary.unitId },
        { ...base, meshName: "Unit_A-102", projectUnitId: primary.unitId },
      ],
      reason: "Reject repeated canonical units",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects nodes outside the processed scene manifest", async () => {
    await expect(replaceProject3DUnitBindings(admin, primary.projectId, versionId, {
      bindings: [{ meshName: "Unit_INVENTED", projectUnitId: primary.unitId, mappingStatus: "MAPPED", poiYawDeg: 0, poiEnabled: true, poiDistanceOverride: null, poiHeightOverride: null }],
      reason: "Reject an invented node",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it.each([
    ["another project", () => anotherProject.unitId],
    ["another company", () => anotherCompany.unitId],
    ["an inactive unit", () => inactiveUnitId],
  ])("rejects a link to %s", async (_label, unitId) => {
    await expect(replaceProject3DUnitBindings(admin, primary.projectId, versionId, {
      bindings: [{ meshName: "Unit_A-101", projectUnitId: unitId(), mappingStatus: "MAPPED", poiYawDeg: 0, poiEnabled: true, poiDistanceOverride: null, poiHeightOverride: null }],
      reason: "Enforce canonical unit scope",
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR", reason: "CROSS_PROJECT_REFERENCE" });
  });

  it("checks binding permission independently of route authentication", async () => {
    const readOnly = { ...admin, permissions: ["platform.3d.view"] } as PlatformContext;
    await expect(replaceProject3DUnitBindings(readOnly, primary.projectId, versionId, {
      bindings: [],
      reason: "Permission boundary check",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("saves a complete Experience revision with optimistic concurrency and audit", async () => {
    const config = { ...structuredClone(DEFAULT_PROJECT_3D_CONFIG), exposure: 1.25 };
    await expect(updateProject3DExperience(admin, primary.projectId, { expectedRevision: 1, config, reason: "Tune the authored scene" })).resolves.toMatchObject({ document: { revision: 2, config: { exposure: 1.25 } } });
    await expect(updateProject3DExperience(admin, primary.projectId, { expectedRevision: 1, config, reason: "Reject the stale editor" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, projectId: primary.projectId, actionKey: "PLATFORM_THREE_D_EXPERIENCE_CHANGED" } })).toBe(1);
  });

  it("saves model transforms and manifest-bound material overrides with concurrency", async () => {
    const before = await prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: versionId } });
    const input = { expectedUpdatedAt: before.updatedAt.toISOString(), scale: 1.5, rotationDeg: 10, altitudeOffset: 2, positionX: 3, positionZ: 4, rotationXDeg: 0, rotationZDeg: 0, visible: true, castShadow: true, receiveShadow: true, selectable: true, transformLocked: false, nodeOverrides: [{ nodeId: "node_0", materialOverrideEnabled: true, colorHex: "#aabbcc", roughness: 0.4 }], reason: "Author model placement and finish" };
    const saved = await updateProject3DModelSettings(admin, primary.projectId, versionId, input);
    await expect(prisma.project3DModelVersion.findUniqueOrThrow({ where: { id: versionId } })).resolves.toMatchObject({ scale: 1.5, rotationDeg: 10, positionX: 3, nodeOverrides: input.nodeOverrides });
    await expect(updateProject3DModelSettings(admin, primary.projectId, versionId, { ...input, expectedUpdatedAt: saved.updatedAt, nodeOverrides: [{ nodeId: "invented", visible: false }] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(updateProject3DModelSettings(admin, primary.projectId, versionId, input)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("builds a Platform preview DTO without source storage identity", async () => {
    const workspace = await getProject3DEditorWorkspace(admin, primary.projectId);
    expect(workspace.config.document).toMatchObject({ schemaVersion: 1, revision: 2, config: { exposure: 1.25 } });
    expect(workspace.slots[0]?.versions[0]?.asset?.url).toContain("/api/storage/objects/");
    expect(JSON.stringify(workspace)).not.toContain("sourceStorageKey");
    expect(JSON.stringify(workspace)).not.toContain(`/source/${tag}.glb`);
  });

  it("blocks invalid models and unresolved unit mappings before publication", async () => {
    await prisma.project3DModelVersion.update({ where: { id: versionId }, data: { validationStatus: "BLOCKED" } });
    await expect(publishProject3DRelease(admin, primary.projectId, { versionIds: [versionId], reason: "Reject blocked model" })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "MODEL_NOT_READY" } });
    await prisma.project3DModelVersion.update({ where: { id: versionId }, data: { validationStatus: "READY" } });
    await expect(publishProject3DRelease(admin, primary.projectId, { versionIds: [versionId], reason: "Reject unresolved unit node" })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "UNIT_BINDINGS_UNRESOLVED" } });
    expect(await prisma.project3DRelease.count({ where: { projectId: primary.projectId } })).toBe(0);
  });

  it("publishes immutable releases, preserves the active release on failure, and rolls back by pointer", async () => {
    await prisma.project3DModelVersion.update({ where: { id: versionId }, data: { unitNodeNames: ["Unit_A-101"] } });
    const first = await publishProject3DRelease(admin, primary.projectId, { versionIds: [versionId], reason: "Publish approved first release" });
    await expect(prisma.project3DConfig.findUniqueOrThrow({ where: { projectId: primary.projectId } })).resolves.toMatchObject({ activeReleaseId: first.id });
    const immutableBefore = await prisma.project3DRelease.findUniqueOrThrow({ where: { id: first.id } });

    await prisma.project3DEntitlement.update({ where: { projectId: primary.projectId }, data: { status: "SUSPENDED" } });
    await expect(publishProject3DRelease(admin, primary.projectId, { versionIds: [versionId], reason: "Do not replace active while suspended" })).rejects.toMatchObject({ code: "CONFLICT", details: { code: "ENTITLEMENT_INACTIVE" } });
    await expect(prisma.project3DConfig.findUniqueOrThrow({ where: { projectId: primary.projectId } })).resolves.toMatchObject({ activeReleaseId: first.id });
    await prisma.project3DEntitlement.update({ where: { projectId: primary.projectId }, data: { status: "ACTIVE" } });

    await updateProject3DExperience(admin, primary.projectId, { expectedRevision: 2, config: { ...structuredClone(DEFAULT_PROJECT_3D_CONFIG), exposure: 1.4 }, reason: "Prepare a second release" });
    const second = await publishProject3DRelease(admin, primary.projectId, { versionIds: [versionId], reason: "Publish approved second release" });
    expect(second.manifestHash).not.toBe(first.manifestHash);
    await expect(prisma.project3DRelease.findUniqueOrThrow({ where: { id: first.id } })).resolves.toMatchObject({ manifestHash: immutableBefore.manifestHash, manifest: immutableBefore.manifest, experienceSnapshot: immutableBefore.experienceSnapshot });

    await expect(activateProject3DRelease(admin, primary.projectId, first.id, "Restore the first approved release")).resolves.toMatchObject({ id: first.id, releaseNumber: 1, active: true });
    await expect(prisma.project3DConfig.findUniqueOrThrow({ where: { projectId: primary.projectId } })).resolves.toMatchObject({ activeReleaseId: first.id });
    expect(await prisma.project3DRelease.count({ where: { projectId: primary.projectId } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, projectId: primary.projectId, actionKey: "PLATFORM_THREE_D_RELEASE_PUBLISHED" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId, projectId: primary.projectId, actionKey: "PLATFORM_THREE_D_RELEASE_ACTIVATED" } })).toBe(3);
  });
});
