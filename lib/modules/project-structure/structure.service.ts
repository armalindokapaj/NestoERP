import { Prisma } from "@prisma/client";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { readableUnitWhere, structureCapabilities, structureProjectDoor } from "./structure.permissions";
import type { UnitListQuery } from "./structure.schema";
import { AREA_FIELDS, type AreaField, type ProjectStructureDTO, type UnitAttributes, type UnitDetailDTO, type UnitDTO, type UnitListDTO, type UnitTypeOption } from "./structure.types";

/**
 * Reading a project's structure (E-05B §31, §46-§50, §65, §66, §88-§90, §107-§111).
 *
 * The tree is buildings, floors and counts in three queries whatever the size
 * of the project; units load a page at a time, filtered and sorted in the
 * database. Every read goes through the project door, so nothing about a
 * project the reader cannot open — a unit code, a building name — leaves here.
 */

export function fail(code: string, message: string, status: "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN" = "VALIDATION_ERROR", details: Record<string, unknown> = {}): AccessError {
  return new AccessError(status, message, { code, ...details });
}

export const STRUCTURE_PROJECT_SELECT = { id: true, companyId: true, name: true, code: true } satisfies Prisma.ProjectSelect;
export type StructureProject = Prisma.ProjectGetPayload<{ select: typeof STRUCTURE_PROJECT_SELECT }>;

/** The project, through the door — or a 404 that names nothing (§82). */
export async function loadStructureProject(context: UserContext, projectId: string): Promise<StructureProject> {
  assertModule(context, "projects");
  const door = structureProjectDoor(context);
  if (!door) throw new AccessError("FORBIDDEN", "You cannot open project structures.");
  const project = await prisma.project.findFirst({ where: { AND: [door, { id: projectId }] }, select: STRUCTURE_PROJECT_SELECT });
  if (!project) throw fail("STRUCTURE_PROJECT_NOT_FOUND", "That project could not be found.", "NOT_FOUND");
  return project;
}

/** The unit types a company offers, for forms and filters. Retired ones stay listed for the units that keep them (§116). */
export async function unitTypeOptions(companyId: string): Promise<UnitTypeOption[]> {
  return prisma.projectUnitType.findMany({
    where: { companyId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, category: true, isActive: true },
  });
}

export async function getProjectStructure(context: UserContext, projectId: string): Promise<ProjectStructureDTO> {
  const project = await loadStructureProject(context, projectId);
  const where = { companyId: context.companyId, projectId: project.id };
  const [buildings, floors, counts, unitTypes] = await Promise.all([
    prisma.projectBuilding.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, description: true, sortOrder: true, isActive: true, version: true },
    }),
    prisma.projectFloor.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, buildingId: true, number: true, name: true, levelType: true, sortOrder: true, elevation: true, description: true, isActive: true, version: true },
    }),
    prisma.projectUnit.groupBy({ by: ["floorId"], where, _count: { _all: true } }),
    unitTypeOptions(context.companyId),
  ]);

  const unitsByFloor = new Map(counts.map((row) => [row.floorId, row._count._all]));
  const nodes = buildings.map((building) => {
    const own = floors
      .filter((floor) => floor.buildingId === building.id)
      .map((floor) => ({ ...floor, elevation: floor.elevation?.toFixed(2) ?? null, unitCount: unitsByFloor.get(floor.id) ?? 0 }));
    return { ...building, floorCount: own.length, unitCount: own.reduce((sum, floor) => sum + floor.unitCount, 0), floors: own };
  });

  return {
    project: { id: project.id, name: project.name, code: project.code, companyId: project.companyId },
    totals: { buildings: buildings.length, floors: floors.length, units: nodes.reduce((sum, building) => sum + building.unitCount, 0) },
    buildings: nodes,
    unitTypes,
    capabilities: structureCapabilities(context),
  };
}

/** Counts for the project overview card (§88): derived, never stored. */
export async function projectStructureSummary(context: UserContext, projectId: string): Promise<{ buildings: number; floors: number; units: number } | null> {
  const door = structureProjectDoor(context);
  if (!door) return null;
  const project = await prisma.project.findFirst({ where: { AND: [door, { id: projectId }] }, select: { id: true } });
  if (!project) return null;
  const where = { companyId: context.companyId, projectId: project.id };
  const [buildings, floors, units] = await Promise.all([prisma.projectBuilding.count({ where }), prisma.projectFloor.count({ where }), prisma.projectUnit.count({ where })]);
  return { buildings, floors, units };
}

/* Units --------------------------------------------------------------------- */

export const UNIT_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  floorId: true,
  unitCode: true,
  name: true,
  position: true,
  orientation: true,
  internalArea: true,
  grossArea: true,
  saleableArea: true,
  outdoorArea: true,
  balconyArea: true,
  terraceArea: true,
  gardenArea: true,
  commonAreaAllocation: true,
  rooms: true,
  bedrooms: true,
  bathrooms: true,
  attributes: true,
  description: true,
  sortOrder: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publicationStatus: true,
  hasUnpublishedChanges: true,
  currentPublication: { select: { versionNumber: true } },
  unitType: { select: { id: true, name: true, code: true, category: true, isActive: true } },
  floor: { select: { id: true, name: true, number: true, levelType: true, building: { select: { id: true, name: true, code: true } } } },
} satisfies Prisma.ProjectUnitSelect;

export type UnitRow = Prisma.ProjectUnitGetPayload<{ select: typeof UNIT_SELECT }>;

export function toUnitDTO(row: UnitRow): UnitDTO {
  const areas = Object.fromEntries(AREA_FIELDS.map((field) => [field, row[field]?.toFixed(2) ?? null])) as Record<AreaField, string | null>;
  const { building, ...floor } = row.floor;
  return {
    id: row.id,
    projectId: row.projectId,
    unitCode: row.unitCode,
    name: row.name,
    unitType: row.unitType,
    building,
    floor,
    position: row.position,
    orientation: row.orientation,
    areas,
    rooms: row.rooms,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    attributes: (row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes) ? row.attributes : {}) as UnitAttributes,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publication: { status: row.publicationStatus, versionNumber: row.currentPublication?.versionNumber ?? null, hasUnpublishedChanges: row.hasUnpublishedChanges },
  };
}

function orderFor(sort: UnitListQuery["sort"]): Prisma.ProjectUnitOrderByWithRelationInput[] {
  const structure: Prisma.ProjectUnitOrderByWithRelationInput[] = [
    { floor: { building: { sortOrder: "asc" } } },
    { floor: { sortOrder: "asc" } },
    { sortOrder: "asc" },
    { unitCode: "asc" },
  ];
  const tail: Prisma.ProjectUnitOrderByWithRelationInput[] = [{ id: "asc" }];
  switch (sort) {
    case "code":
      return [{ unitCodeKey: "asc" }, ...tail];
    case "-code":
      return [{ unitCodeKey: "desc" }, ...tail];
    case "floor":
      return [{ floor: { sortOrder: "asc" } }, { floor: { building: { sortOrder: "asc" } } }, { sortOrder: "asc" }, ...tail];
    case "type":
      return [{ unitType: { sortOrder: "asc" } }, ...structure, ...tail];
    case "saleableArea":
      return [{ saleableArea: { sort: "asc", nulls: "last" } }, ...structure, ...tail];
    case "-saleableArea":
      return [{ saleableArea: { sort: "desc", nulls: "last" } }, ...structure, ...tail];
    case "internalArea":
      return [{ internalArea: { sort: "asc", nulls: "last" } }, ...structure, ...tail];
    case "-internalArea":
      return [{ internalArea: { sort: "desc", nulls: "last" } }, ...structure, ...tail];
    default:
      return [...structure, ...tail];
  }
}

function range(min: string | undefined, max: string | undefined): Prisma.DecimalNullableFilter | undefined {
  if (min === undefined && max === undefined) return undefined;
  return { ...(min !== undefined ? { gte: new Prisma.Decimal(min) } : {}), ...(max !== undefined ? { lte: new Prisma.Decimal(max) } : {}) };
}

/** One page of a project's units, filtered in the database (§47-§50, §66, §107, §109). */
export async function listProjectUnits(context: UserContext, projectId: string, query: UnitListQuery & { page: number; limit: number }): Promise<UnitListDTO> {
  const project = await loadStructureProject(context, projectId);
  const q = query.q?.trim();
  const filters: Prisma.ProjectUnitWhereInput[] = [
    readableUnitWhere(context),
    { projectId: project.id },
    ...(query.floorId ? [{ floorId: query.floorId }] : []),
    ...(query.buildingId ? [{ floor: { is: { buildingId: query.buildingId } } }] : []),
    ...(query.unitTypeId ? [{ unitTypeId: query.unitTypeId }] : []),
    ...(query.orientation ? [{ orientation: query.orientation }] : []),
    ...(query.position ? [{ position: query.position }] : []),
    ...(query.bedrooms !== undefined ? [{ bedrooms: query.bedrooms }] : []),
    ...(query.bathrooms !== undefined ? [{ bathrooms: query.bathrooms }] : []),
    ...(query.publicationStatus ? [{ publicationStatus: query.publicationStatus }] : []),
    ...(query.unpublishedChanges ? [{ hasUnpublishedChanges: true }] : []),
  ];
  const internal = range(query.internalAreaMin, query.internalAreaMax);
  if (internal) filters.push({ internalArea: internal });
  const saleable = range(query.saleableAreaMin, query.saleableAreaMax);
  if (saleable) filters.push({ saleableArea: saleable });
  if (q) {
    filters.push({
      OR: [
        { unitCode: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { unitType: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }

  const where: Prisma.ProjectUnitWhereInput = { AND: filters };
  const [total, rows] = await Promise.all([
    prisma.projectUnit.count({ where }),
    prisma.projectUnit.findMany({ where, orderBy: orderFor(query.sort), skip: (query.page - 1) * query.limit, take: query.limit, select: UNIT_SELECT }),
  ]);
  return { items: rows.map(toUnitDTO), page: query.page, pageSize: query.limit, total };
}

/** A unit, through its project's door. */
export async function findReadableUnit(context: UserContext, unitId: string): Promise<UnitRow & { project: StructureProject }> {
  assertModule(context, "projects");
  if (!structureProjectDoor(context)) throw new AccessError("FORBIDDEN", "You cannot open project structures.");
  const row = await prisma.projectUnit.findFirst({
    where: { AND: [readableUnitWhere(context), { id: unitId }] },
    select: { ...UNIT_SELECT, project: { select: STRUCTURE_PROJECT_SELECT } },
  });
  if (!row) throw fail("UNIT_NOT_FOUND", "That unit could not be found.", "NOT_FOUND");
  return row;
}

/**
 * The one unit page (§29, §82). When the route names a project, the unit must
 * belong to it: a unit of project B opened under project A is not found.
 */
export async function getUnitDetail(context: UserContext, unitId: string, routeProjectId?: string): Promise<UnitDetailDTO> {
  const row = await findReadableUnit(context, unitId);
  if (routeProjectId !== undefined && row.projectId !== routeProjectId) throw fail("UNIT_NOT_FOUND", "That unit could not be found.", "NOT_FOUND");
  const capabilities = structureCapabilities(context);
  return {
    ...toUnitDTO(row),
    project: { id: row.project.id, name: row.project.name, code: row.project.code },
    capabilities: { canUpdateUnit: capabilities.canUpdateUnit, canDeleteUnit: capabilities.canDeleteUnit, canMoveUnit: capabilities.canMoveUnit },
  };
}

/* Activity (E-05D §48, §49) --------------------------------------------------- */

export type UnitActivityDTO = { id: string; action: string; message: string | null; actor: string | null; createdAt: string };

/**
 * One unit's history, newest first (E-05D §48): created, edited, moved, its
 * files, its publishing. Read only after the unit's own door, and with the
 * project's activity grant — the same people who read the project's history.
 */
export async function listUnitActivity(context: UserContext, unitId: string, options: { page?: number; limit?: number } = {}): Promise<{ items: UnitActivityDTO[]; page: number; pageSize: number; total: number }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.activity.view");
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 50, 100);
  const where: Prisma.ActivityWhereInput = { companyId: context.companyId, module: "projects", entityType: "ProjectUnit", entityId: unit.id };
  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, action: true, message: true, createdAt: true, actorMember: { select: { user: { select: { firstName: true, lastName: true } } } } },
    }),
  ]);
  return {
    items: rows.map((row) => ({ id: row.id, action: row.action, message: row.message, actor: row.actorMember ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}` : null, createdAt: row.createdAt.toISOString() })),
    page,
    pageSize: limit,
    total,
  };
}
