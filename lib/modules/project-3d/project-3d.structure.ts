import { Prisma } from "@prisma/client";

import { AccessError, assertFound } from "@/lib/access/guards";
import type { PlatformContext } from "@/lib/context/platform-context";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordPlatformAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { floorKeyOf, floorRank, generateUnitCodes, planFloorRange, structureKey } from "@/lib/modules/project-structure/structure.rules";
import { project3DAuditMetadata } from "./project-3d.audit";
import { assertProject3DPlatformPermission } from "./project-3d.permissions";
import type { Project3DStructureCreate, Project3DStructureUpdate } from "./project-3d.schema";

type Tx = Prisma.TransactionClient;

async function requireStructureProject(context: PlatformContext, projectId: string, permission: "platform.3d.view" | "platform.3d.configure" = "platform.3d.configure") {
  assertProject3DPlatformPermission(context, permission);
  return assertFound(await prisma.project.findFirst({
    where: { id: projectId, archivedAt: null, project3DConfig: { isNot: null }, company: { parentGroup: { isTestFixture: false } } },
    select: { id: true, name: true, companyId: true, company: { select: { parentGroupId: true } } },
  }));
}

function decimal(value: string | null | undefined) {
  return value ? new Prisma.Decimal(value) : null;
}

function knownWriteConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AccessError("CONFLICT", "A canonical structure record with that name or code already exists.", { code: "STRUCTURE_COLLISION" });
  }
  throw error;
}

async function audit(context: PlatformContext, parentGroupId: string, tx: Tx, projectId: string, entity: { type: string; id: string; label: string }, operation: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, reason: string | null) {
  await recordPlatformAction(context, parentGroupId, {
    actionKey: AuditAction.PLATFORM_THREE_D_STRUCTURE_CHANGED,
    entity,
    projectId,
    before: before ? { projectId, operation, ...before } : null,
    after: after ? { projectId, operation, ...after } : null,
    reason,
    metadata: structureMetadata(operation, entity.label),
  }, { tx });
}

function structureMetadata(operation: string, label: string) {
  if (operation.endsWith(".delete")) return project3DAuditMetadata("STRUCTURE_DELETED", `${label} deleted`, { structureOperation: operation });
  if (operation.endsWith(".update")) return project3DAuditMetadata("STRUCTURE_UPDATED", `${label} updated`, { structureOperation: operation });
  return project3DAuditMetadata("STRUCTURE_CREATED", `${label} created`, { structureOperation: operation });
}

export async function getPlatformProjectStructure(context: PlatformContext, projectId: string) {
  const project = await requireStructureProject(context, projectId, "platform.3d.view");
  const [buildings, unitTypes] = await Promise.all([
    prisma.projectBuilding.findMany({
      where: { projectId, companyId: project.companyId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, code: true, description: true, isActive: true, version: true, sortOrder: true,
        floors: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true, buildingId: true, number: true, name: true, levelType: true, elevation: true, description: true, isActive: true, version: true, sortOrder: true,
            units: {
              orderBy: [{ sortOrder: "asc" }, { unitCode: "asc" }],
              select: { id: true, floorId: true, unitCode: true, name: true, unitTypeId: true, internalArea: true, saleableArea: true, rooms: true, bedrooms: true, bathrooms: true, description: true, isActive: true, version: true, publicationStatus: true, commercialProfile: { select: { status: true } }, _count: { select: { threeDMeshBindings: true } } },
            },
          },
        },
      },
    }),
    prisma.projectUnitType.findMany({ where: { companyId: project.companyId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true, category: true } }),
  ]);
  return {
    project: { id: project.id, name: project.name },
    unitTypes,
    buildings: buildings.map((building) => ({ ...building, floors: building.floors.map((floor) => ({ ...floor, elevation: floor.elevation?.toFixed(2) ?? null, units: floor.units.map((unit) => ({ ...unit, internalArea: unit.internalArea?.toFixed(2) ?? null, saleableArea: unit.saleableArea?.toFixed(2) ?? null })) })) })),
  };
}

export async function createPlatformProjectStructure(context: PlatformContext, projectId: string, input: Project3DStructureCreate) {
  const project = await requireStructureProject(context, projectId);
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.action === "building.create") {
        const last = await tx.projectBuilding.aggregate({ where: { projectId, companyId: project.companyId }, _max: { sortOrder: true } });
        const row = await tx.projectBuilding.create({ data: { companyId: project.companyId, projectId, name: input.name, nameKey: structureKey(input.name), code: input.code, codeKey: input.code ? structureKey(input.code) : null, description: input.description, sortOrder: (last._max.sortOrder ?? 0) + 1, createdBy: context.userId }, select: { id: true, version: true } });
        await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectBuilding", id: row.id, label: input.name }, input.action, null, { buildingId: row.id, name: input.name, code: input.code, version: row.version }, input.reason);
        return { action: input.action, ids: [row.id] };
      }

      if (input.action === "floor.create" || input.action === "floor.bulk") {
        const building = assertFound(await tx.projectBuilding.findFirst({ where: { id: input.buildingId, projectId, companyId: project.companyId }, select: { id: true, name: true } }));
        const drafts = input.action === "floor.create" ? [{ number: input.number, name: input.name, levelType: input.levelType, elevation: input.elevation, description: input.description }] : planFloorRange(input.from, input.to).map((floor) => ({ ...floor, elevation: null, description: null }));
        const keys = drafts.map((floor) => floorKeyOf(floor.levelType, floor.number, floor.name));
        if (new Set(keys).size !== keys.length) throw new AccessError("CONFLICT", "The floor range contains duplicate levels.", { code: "FLOOR_COLLISION" });
        const collisions = await tx.projectFloor.count({ where: { buildingId: building.id, floorKey: { in: keys } } });
        if (collisions) throw new AccessError("CONFLICT", "One or more of these floors already exist in the building.", { code: "FLOOR_COLLISION" });
        if (input.action === "floor.bulk" && input.dryRun) return { action: input.action, ids: [], preview: { count: drafts.length, labels: drafts.map((floor) => floor.name) } };
        const last = await tx.projectFloor.aggregate({ where: { buildingId: building.id }, _max: { sortOrder: true } });
        const ordered = drafts.toSorted((a, b) => floorRank(a.levelType, a.number) - floorRank(b.levelType, b.number));
        const rows = await tx.projectFloor.createManyAndReturn({ data: ordered.map((floor, index) => ({ companyId: project.companyId, projectId, buildingId: building.id, number: floor.number, name: floor.name, levelType: floor.levelType, floorKey: floorKeyOf(floor.levelType, floor.number, floor.name), sortOrder: (last._max.sortOrder ?? 0) + index + 1, elevation: decimal(floor.elevation), description: floor.description, createdBy: context.userId })), select: { id: true } });
        await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectBuilding", id: building.id, label: building.name }, input.action, null, { buildingId: building.id, count: rows.length }, input.reason);
        return { action: input.action, ids: rows.map((row) => row.id) };
      }

      const floor = assertFound(await tx.projectFloor.findFirst({ where: { id: input.floorId, projectId, companyId: project.companyId }, select: { id: true, name: true } }));
      const type = assertFound(await tx.projectUnitType.findFirst({ where: { id: input.unitTypeId, companyId: project.companyId, isActive: true }, select: { id: true } }));
      const units = input.action === "unit.create" ? [{ unitCode: input.unitCode, name: input.name }] : generateUnitCodes({ prefix: input.prefix, start: input.start, end: input.end, padding: input.padding, suffix: input.suffix }).map((unitCode) => ({ unitCode, name: null }));
      const keys = units.map((unit) => structureKey(unit.unitCode));
      if (new Set(keys).size !== keys.length) throw new AccessError("CONFLICT", "The unit range contains duplicate codes.", { code: "UNIT_CODE_COLLISION" });
      const collisions = await tx.projectUnit.count({ where: { projectId, unitCodeKey: { in: keys } } });
      if (collisions) throw new AccessError("CONFLICT", "One or more unit codes already exist in this Project.", { code: "UNIT_CODE_COLLISION" });
      if (input.action === "unit.bulk" && input.dryRun) return { action: input.action, ids: [], preview: { count: units.length, labels: units.map((unit) => unit.unitCode) } };
      const last = await tx.projectUnit.aggregate({ where: { floorId: floor.id }, _max: { sortOrder: true } });
      const rows = await tx.projectUnit.createManyAndReturn({ data: units.map((unit, index) => ({ companyId: project.companyId, projectId, floorId: floor.id, unitCode: unit.unitCode, unitCodeKey: structureKey(unit.unitCode), name: unit.name, unitTypeId: type.id, internalArea: decimal(input.internalArea), saleableArea: decimal(input.saleableArea), rooms: input.rooms, bedrooms: input.bedrooms, bathrooms: input.bathrooms, description: input.description, sortOrder: (last._max.sortOrder ?? 0) + index + 1, createdBy: context.userId })), select: { id: true } });
      await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectFloor", id: floor.id, label: floor.name }, input.action, null, { floorId: floor.id, count: rows.length }, input.reason);
      return { action: input.action, ids: rows.map((row) => row.id) };
    });
  } catch (error) { return knownWriteConflict(error); }
}

export async function updatePlatformProjectStructure(context: PlatformContext, projectId: string, recordId: string, input: Project3DStructureUpdate) {
  const project = await requireStructureProject(context, projectId);
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.kind === "building") {
        const row = assertFound(await tx.projectBuilding.findFirst({ where: { id: recordId, projectId, companyId: project.companyId } }));
        const changed = await tx.projectBuilding.updateMany({ where: { id: row.id, version: input.expectedVersion }, data: { name: input.name, nameKey: structureKey(input.name), code: input.code, codeKey: input.code ? structureKey(input.code) : null, description: input.description, isActive: input.isActive, updatedBy: context.userId, version: { increment: 1 } } });
        if (!changed.count) throw new AccessError("CONFLICT", "The building changed while you were editing it.", { code: "STRUCTURE_STALE" });
        await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectBuilding", id: row.id, label: input.name }, "building.update", { buildingId: row.id, name: row.name, code: row.code, isActive: row.isActive, version: row.version }, { buildingId: row.id, name: input.name, code: input.code, isActive: input.isActive, version: row.version + 1 }, input.reason);
        return { version: row.version + 1 };
      }
      if (input.kind === "floor") {
        const row = assertFound(await tx.projectFloor.findFirst({ where: { id: recordId, projectId, companyId: project.companyId } }));
        const target = assertFound(await tx.projectBuilding.findFirst({ where: { id: input.buildingId, projectId, companyId: project.companyId }, select: { id: true } }));
        const changed = await tx.projectFloor.updateMany({ where: { id: row.id, version: input.expectedVersion }, data: { buildingId: target.id, number: input.number, name: input.name, levelType: input.levelType, floorKey: floorKeyOf(input.levelType, input.number, input.name), elevation: decimal(input.elevation), description: input.description, isActive: input.isActive, updatedBy: context.userId, version: { increment: 1 } } });
        if (!changed.count) throw new AccessError("CONFLICT", "The floor changed while you were editing it.", { code: "STRUCTURE_STALE" });
        await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectFloor", id: row.id, label: input.name }, "floor.update", { floorId: row.id, buildingId: row.buildingId, name: row.name, isActive: row.isActive, version: row.version }, { floorId: row.id, buildingId: target.id, name: input.name, isActive: input.isActive, version: row.version + 1 }, input.reason);
        return { version: row.version + 1 };
      }
      const row = assertFound(await tx.projectUnit.findFirst({ where: { id: recordId, projectId, companyId: project.companyId } }));
      const [floor, type] = await Promise.all([tx.projectFloor.findFirst({ where: { id: input.floorId, projectId, companyId: project.companyId }, select: { id: true } }), tx.projectUnitType.findFirst({ where: { id: input.unitTypeId, companyId: project.companyId, isActive: true }, select: { id: true } })]);
      const targetFloor = assertFound(floor);
      const unitType = assertFound(type);
      const changed = await tx.projectUnit.updateMany({ where: { id: row.id, version: input.expectedVersion }, data: { floorId: targetFloor.id, unitCode: input.unitCode, unitCodeKey: structureKey(input.unitCode), name: input.name, unitTypeId: unitType.id, internalArea: decimal(input.internalArea), saleableArea: decimal(input.saleableArea), rooms: input.rooms, bedrooms: input.bedrooms, bathrooms: input.bathrooms, description: input.description, isActive: input.isActive, updatedBy: context.userId, version: { increment: 1 } } });
      if (!changed.count) throw new AccessError("CONFLICT", "The unit changed while you were editing it.", { code: "STRUCTURE_STALE" });
      await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectUnit", id: row.id, label: input.unitCode }, "unit.update", { unitId: row.id, floorId: row.floorId, unitCode: row.unitCode, isActive: row.isActive, version: row.version }, { unitId: row.id, floorId: targetFloor.id, unitCode: input.unitCode, isActive: input.isActive, version: row.version + 1 }, input.reason);
      return { version: row.version + 1 };
    });
  } catch (error) { return knownWriteConflict(error); }
}

export async function deletePlatformProjectStructure(context: PlatformContext, projectId: string, kind: "building" | "floor" | "unit", recordId: string, reason: string | null = null) {
  const project = await requireStructureProject(context, projectId);
  return prisma.$transaction(async (tx) => {
    if (kind === "building") {
      const row = assertFound(await tx.projectBuilding.findFirst({ where: { id: recordId, projectId, companyId: project.companyId }, select: { id: true, name: true, code: true, _count: { select: { floors: true } } } }));
      if (row._count.floors) throw new AccessError("CONFLICT", "Move or delete this building's floors first.", { code: "BUILDING_HAS_FLOORS" });
      await tx.projectBuilding.delete({ where: { id: row.id } });
      await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectBuilding", id: row.id, label: row.name }, "building.delete", { buildingId: row.id, name: row.name, code: row.code }, null, reason);
      return { deleted: true };
    }
    if (kind === "floor") {
      const row = assertFound(await tx.projectFloor.findFirst({ where: { id: recordId, projectId, companyId: project.companyId }, select: { id: true, name: true, buildingId: true, _count: { select: { units: true } } } }));
      if (row._count.units) throw new AccessError("CONFLICT", "Move or delete this floor's Units first.", { code: "FLOOR_HAS_UNITS" });
      await tx.projectFloor.delete({ where: { id: row.id } });
      await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectFloor", id: row.id, label: row.name }, "floor.delete", { floorId: row.id, buildingId: row.buildingId, name: row.name }, null, reason);
      return { deleted: true };
    }
    const row = assertFound(await tx.projectUnit.findFirst({ where: { id: recordId, projectId, companyId: project.companyId }, select: { id: true, unitCode: true, floorId: true, salesPlanDocumentId: true } }));
    const counts = await Promise.all([
      tx.project3DUnitMeshBinding.count({ where: { projectUnitId: row.id } }), tx.unitPublication.count({ where: { unitId: row.id } }), tx.unitMedia.count({ where: { unitId: row.id } }), tx.unitDocumentLink.count({ where: { unitId: row.id } }), tx.unitCommercialProfile.count({ where: { unitId: row.id } }), tx.unitReservation.count({ where: { unitId: row.id } }), tx.opportunityUnit.count({ where: { unitId: row.id } }), tx.contractUnit.count({ where: { unitId: row.id } }),
    ]);
    if (row.salesPlanDocumentId || counts.some(Boolean)) throw new AccessError("CONFLICT", "This Unit is used by 3D, publishing, media, documents, or Sales. Deactivate it instead.", { code: "UNIT_REFERENCED" });
    await tx.projectUnit.delete({ where: { id: row.id } });
    await audit(context, project.company.parentGroupId, tx, projectId, { type: "ProjectUnit", id: row.id, label: row.unitCode }, "unit.delete", { unitId: row.id, floorId: row.floorId, unitCode: row.unitCode }, null, reason);
    return { deleted: true };
  });
}
