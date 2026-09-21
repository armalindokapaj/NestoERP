import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PlatformContext } from "@/lib/context/platform-context";
import { createPlatformProjectStructure, deletePlatformProjectStructure, getPlatformProjectStructure, updatePlatformProjectStructure } from "@/lib/modules/project-3d/project-3d.structure";
import { cleanupSessions, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

describe("Platform 3D canonical Project structure", () => {
  const tag = `p3d-structure-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;
  let groupId: string | null = null;
  let companyId: string | null = null;
  let projectId: string | null = null;
  let unitTypeId: string | null = null;
  let buildingId: string;
  let floorIds: string[] = [];
  let unitIds: string[] = [];

  beforeAll(async () => {
    admin = await loginAsPlatformAdmin();
    const group = await prisma.parentGroup.create({ data: { slug: tag, name: "3D Structure Group", status: "ACTIVE" } });
    groupId = group.id;
    const company = await prisma.company.create({ data: { slug: `${tag}-company`, name: "3D Structure Company", parentGroupId: group.id } });
    companyId = company.id;
    const project = await prisma.project.create({ data: { companyId: company.id, code: tag.slice(0, 30), name: "3D Structure Project", status: "ACTIVE", createdBy: admin.userId } });
    projectId = project.id;
    await prisma.project3DConfig.create({ data: { companyId: company.id, projectId: project.id, experienceName: "Structure Test", authoringDocument: {}, updatedByUserId: admin.userId } });
    const type = await prisma.projectUnitType.create({ data: { companyId: company.id, name: `Apartment ${tag}`, code: `APT_${Date.now()}`, category: "RESIDENTIAL", createdBy: admin.userId } });
    unitTypeId = type.id;
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.projectUnit.deleteMany({ where: { projectId } });
      await prisma.projectFloor.deleteMany({ where: { projectId } });
      await prisma.projectBuilding.deleteMany({ where: { projectId } });
      await prisma.project3DConfig.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    if (unitTypeId) await prisma.projectUnitType.deleteMany({ where: { id: unitTypeId } });
    if (groupId) await prisma.auditEvent.deleteMany({ where: { parentGroupId: groupId } });
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
    if (groupId) {
      await prisma.groupDepartment.deleteMany({ where: { parentGroupId: groupId } });
      await prisma.parentGroup.deleteMany({ where: { id: groupId } });
    }
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("creates canonical Buildings, a Floor range, and a Unit range", async () => {
    const building = await createPlatformProjectStructure(admin, projectId!, { action: "building.create", name: "Tower A", code: "A", description: null, reason: "Create test tower" });
    buildingId = building.ids[0]!;
    const floors = await createPlatformProjectStructure(admin, projectId!, { action: "floor.bulk", buildingId, from: -1, to: 2, reason: "Create test levels" });
    floorIds = floors.ids;
    const ground = (await getPlatformProjectStructure(admin, projectId!)).buildings[0]!.floors.find((floor) => floor.number === 0)!;
    const units = await createPlatformProjectStructure(admin, projectId!, { action: "unit.bulk", floorId: ground.id, prefix: "A-", start: 101, end: 103, padding: 3, suffix: "", unitTypeId: unitTypeId!, internalArea: "82.50", saleableArea: "91.00", rooms: 4, bedrooms: 2, bathrooms: 2, description: null, reason: "Create test units" });
    unitIds = units.ids;

    const structure = await getPlatformProjectStructure(admin, projectId!);
    expect(structure.buildings).toHaveLength(1);
    expect(structure.buildings[0]!.floors).toHaveLength(4);
    expect(ground.name).toBe("Ground Floor");
    expect(structure.buildings[0]!.floors.flatMap((floor) => floor.units).map((unit) => unit.unitCode)).toEqual(["A-101", "A-102", "A-103"]);
  });

  it("rejects normalized collisions and protects non-empty parents", async () => {
    const ground = (await getPlatformProjectStructure(admin, projectId!)).buildings[0]!.floors.find((floor) => floor.number === 0)!;
    await expect(createPlatformProjectStructure(admin, projectId!, { action: "unit.create", floorId: ground.id, unitCode: "a-101", name: null, unitTypeId: unitTypeId!, internalArea: null, saleableArea: null, rooms: null, bedrooms: null, bathrooms: null, description: null, reason: "Collision check" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(deletePlatformProjectStructure(admin, projectId!, "building", buildingId, "Protect child records")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("moves a Unit without changing its canonical identity", async () => {
    const structure = await getPlatformProjectStructure(admin, projectId!);
    const source = structure.buildings[0]!.floors.find((floor) => floor.number === 0)!;
    const target = structure.buildings[0]!.floors.find((floor) => floor.number === 1)!;
    const unit = source.units[0]!;
    await updatePlatformProjectStructure(admin, projectId!, unit.id, { kind: "unit", floorId: target.id, unitCode: unit.unitCode, name: unit.name, unitTypeId: unit.unitTypeId, internalArea: unit.internalArea, saleableArea: unit.saleableArea, rooms: unit.rooms, bedrooms: unit.bedrooms, bathrooms: unit.bathrooms, description: unit.description, isActive: unit.isActive, expectedVersion: unit.version, reason: "Move unit to next floor" });
    const moved = await prisma.projectUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(moved.id).toBe(unit.id);
    expect(moved.floorId).toBe(target.id);
  });

  it("allows view-only structure reads and refuses writes", async () => {
    const readOnly = { ...admin, permissions: ["platform.3d.view"] } as PlatformContext;
    await expect(getPlatformProjectStructure(readOnly, projectId!)).resolves.toMatchObject({ project: { id: projectId } });
    await expect(createPlatformProjectStructure(readOnly, projectId!, { action: "building.create", name: "Forbidden", code: null, description: null, reason: "Permission boundary" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.auditEvent.count({ where: { parentGroupId: groupId!, projectId: projectId!, actionKey: "PLATFORM_THREE_D_STRUCTURE_CHANGED" } })).toBeGreaterThanOrEqual(4);
  });
});
