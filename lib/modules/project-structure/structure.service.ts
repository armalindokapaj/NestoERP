import { assignedCompanyId } from "@/lib/access/project-ownership";
import { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { readableUnitWhere, structureCapabilities, structureProjectDoor } from "./structure.permissions";
import { codeSearchKey, unitLabel } from "./structure.rules";
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
    project: { id: project.id, name: project.name, code: project.code, companyId: assignedCompanyId(project) },
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
  orientation: true,
  internalArea: true,
  balconyArea: true,
  terraceArea: true,
  netArea: true,
  commonAreaAllocation: true,
  grossArea: true,
  saleableArea: true,
  outdoorArea: true,
  gardenArea: true,
  bedrooms: true,
  bathrooms: true,
  storage: true,
  attributes: true,
  description: true,
  sortOrder: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publicationStatus: true,
  currentPublication: { select: { versionNumber: true } },
  // The commercial status and the asking price are the Sales facts everybody who reads the unit sees (E-05E §33, §39; the price since 2026-11).
  commercialProfile: { select: { status: true, askingPrice: true, currency: true } },
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
    label: unitLabel(building.code, row.unitCode),
    unitType: row.unitType,
    building,
    floor,
    orientation: row.orientation,
    areas,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    storage: row.storage,
    attributes: (row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes) ? row.attributes : {}) as UnitAttributes,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publication: { status: row.publicationStatus, versionNumber: row.currentPublication?.versionNumber ?? null },
    commercialStatus: row.commercialProfile?.status ?? "NOT_FOR_SALE",
    askingPrice: row.commercialProfile?.askingPrice ? { amount: row.commercialProfile.askingPrice.toFixed(2), currency: row.commercialProfile.currency } : null,
  };
}

/** `%text%` for ILIKE, with the pattern's own characters taken literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/**
 * A search for a unit by its code, as people write it (2026-11-09): "T-501",
 * "T501" and "501" all find the unit the lists call T-501. The unit's own code
 * matches as typed; the building's code and the unit's, folded to letters and
 * digits, match the folded search (`codeSearchKey`). Reads the aliases `u`
 * (project_units) and `b` (project_buildings).
 */
export function unitCodeMatch(q: string): Prisma.Sql {
  const matches = [Prisma.sql`u."unitCode" ILIKE ${containsPattern(q)}`];
  const key = codeSearchKey(q);
  if (key) matches.push(Prisma.sql`regexp_replace(upper(COALESCE(b."code", '') || u."unitCode"), '[^[:alnum:]]', '', 'g') LIKE ${`%${key}%`}`);
  return Prisma.sql`(${Prisma.join(matches, " OR ")})`;
}

/**
 * The area a unit is sold by, in SQL (2026-11-09): the saleable area when it
 * is above zero, else the gross area — null when neither is, so a division by
 * it is never by zero. Reads the alias `u`; the same rule as `saleArea`.
 */
export const SALE_AREA_SQL = Prisma.sql`COALESCE(NULLIF(u."saleableArea", 0), NULLIF(u."grossArea", 0))`;

function orderFor(sort: UnitListQuery["sort"]): Prisma.Sql {
  const structure = Prisma.sql`b."sortOrder" ASC, f."sortOrder" ASC, u."sortOrder" ASC, u."unitCode" ASC`;
  const id = Prisma.sql`u."id" ASC`;
  switch (sort) {
    case "code":
      return Prisma.sql`u."unitCodeKey" ASC, ${id}`;
    case "-code":
      return Prisma.sql`u."unitCodeKey" DESC, ${id}`;
    case "floor":
      return Prisma.sql`f."sortOrder" ASC, b."sortOrder" ASC, u."sortOrder" ASC, ${id}`;
    case "type":
      return Prisma.sql`t."sortOrder" ASC, ${structure}, ${id}`;
    case "gross":
      return Prisma.sql`u."grossArea" ASC NULLS LAST, ${structure}, ${id}`;
    case "-gross":
      return Prisma.sql`u."grossArea" DESC NULLS LAST, ${structure}, ${id}`;
    case "bedrooms":
      return Prisma.sql`u."bedrooms" ASC NULLS LAST, ${structure}, ${id}`;
    case "-bedrooms":
      return Prisma.sql`u."bedrooms" DESC NULLS LAST, ${structure}, ${id}`;
    case "price":
      return Prisma.sql`p."askingPrice" ASC NULLS LAST, ${structure}, ${id}`;
    case "-price":
      return Prisma.sql`p."askingPrice" DESC NULLS LAST, ${structure}, ${id}`;
    case "area":
      return Prisma.sql`${SALE_AREA_SQL} ASC NULLS LAST, ${structure}, ${id}`;
    case "-area":
      return Prisma.sql`${SALE_AREA_SQL} DESC NULLS LAST, ${structure}, ${id}`;
    case "internalArea":
      return Prisma.sql`u."internalArea" ASC NULLS LAST, ${structure}, ${id}`;
    case "-internalArea":
      return Prisma.sql`u."internalArea" DESC NULLS LAST, ${structure}, ${id}`;
    default:
      return Prisma.sql`${structure}, ${id}`;
  }
}

/**
 * One page of a project's units, filtered and sorted in the database (§47-§50,
 * §66, §107, §109). One SQL statement pages the ids — the sale area and the
 * price are sorted on there, which Prisma's ordering cannot express — and the
 * rows are then read by id. The project came through its door; every unit read
 * is that project's, in the reader's company.
 */
export async function listProjectUnits(context: UserContext, projectId: string, query: UnitListQuery & { page: number; limit: number }): Promise<UnitListDTO> {
  const project = await loadStructureProject(context, projectId);
  const q = query.q?.trim();
  const decimal = (value: string) => new Prisma.Decimal(value);
  const filters: Prisma.Sql[] = [Prisma.sql`u."companyId" = ${context.companyId}`, Prisma.sql`u."projectId" = ${project.id}`];
  if (query.floorId) filters.push(Prisma.sql`u."floorId" = ${query.floorId}`);
  if (query.buildingId) filters.push(Prisma.sql`f."buildingId" = ${query.buildingId}`);
  if (query.unitTypeId) filters.push(Prisma.sql`u."unitTypeId" = ${query.unitTypeId}`);
  if (query.orientation) filters.push(Prisma.sql`u."orientation" = ${query.orientation}::"UnitOrientation"`);
  if (query.bedrooms !== undefined) filters.push(Prisma.sql`u."bedrooms" = ${query.bedrooms}`);
  if (query.bathrooms !== undefined) filters.push(Prisma.sql`u."bathrooms" = ${query.bathrooms}`);
  if (query.publicationStatus) filters.push(Prisma.sql`u."publicationStatus" = ${query.publicationStatus}::"UnitPublicationStatus"`);
  if (query.internalAreaMin !== undefined) filters.push(Prisma.sql`u."internalArea" >= ${decimal(query.internalAreaMin)}`);
  if (query.internalAreaMax !== undefined) filters.push(Prisma.sql`u."internalArea" <= ${decimal(query.internalAreaMax)}`);
  if (query.areaMin !== undefined) filters.push(Prisma.sql`${SALE_AREA_SQL} >= ${decimal(query.areaMin)}`);
  if (query.areaMax !== undefined) filters.push(Prisma.sql`${SALE_AREA_SQL} <= ${decimal(query.areaMax)}`);
  if (q) filters.push(Prisma.sql`(${unitCodeMatch(q)} OR t."name" ILIKE ${containsPattern(q)})`);

  const from = Prisma.sql`FROM "project_units" u
    JOIN "project_floors" f ON f."id" = u."floorId"
    JOIN "project_buildings" b ON b."id" = f."buildingId"
    JOIN "project_unit_types" t ON t."id" = u."unitTypeId"
    LEFT JOIN "unit_commercial_profiles" p ON p."unitId" = u."id"`;
  const where = Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`;
  // Count and page from one snapshot (AUD-08 §4, DT-06); every order ends in the id (DT-04).
  const [counted, page] = await prisma.$transaction(
    [
      prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count ${from} ${where}`,
      prisma.$queryRaw<Array<{ id: string }>>`SELECT u."id" ${from} ${where} ORDER BY ${orderFor(query.sort)} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const ids = page.map((row) => row.id);
  const rows = ids.length ? await prisma.projectUnit.findMany({ where: { AND: [readableUnitWhere(context), { projectId: project.id, id: { in: ids } }] }, select: UNIT_SELECT }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  // A unit removed between the page and the read is left out rather than failing the page.
  const items = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toUnitDTO(row)] : [];
  });
  return { items, page: query.page, pageSize: query.limit, total: Number(counted[0]?.count ?? 0) };
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
    capabilities: { canUpdateUnit: capabilities.canUpdateUnit, canDeleteUnit: capabilities.canDeleteUnit, canMoveUnit: capabilities.canMoveUnit, canManagePrice: capabilities.canManagePrice },
  };
}

/* Activity (E-05D §48, §49) --------------------------------------------------- */

export type UnitActivityDTO = { id: string; action: string; message: string | null; actor: string | null; actorMemberId: string | null; createdAt: string };

/**
 * One unit's history, newest first (E-05D §48): created, edited, moved, its
 * files, its publishing. Read only after the unit's own door, and with the
 * project's activity grant — the same people who read the project's history.
 */
/**
 * Who last changed the unit, and when, for its header (user, 2026-09-29).
 *
 * The unit row keeps no editor of its own: every change it takes is written to
 * its activity with the member who made it, so the latest entry is the answer.
 * Read with the same grants as the Activity tab.
 */
export async function lastUnitChange(context: UserContext, unitId: string): Promise<{ actor: string; actorMemberId: string; at: string } | null> {
  if (!can(context, "project.activity.view")) return null;
  const modules = can(context, "project.unit.sales.view") ? ["projects", "sales"] : ["projects"];
  const row = await prisma.activity.findFirst({
    where: { companyId: context.companyId, module: { in: modules }, entityType: "ProjectUnit", entityId: unitId, actorMemberId: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, actorMemberId: true, actorMember: { select: { user: { select: { firstName: true, lastName: true } } } } },
  });
  if (!row?.actorMember || !row.actorMemberId) return null;
  return { actor: `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}`, actorMemberId: row.actorMemberId, at: row.createdAt.toISOString() };
}

export async function listUnitActivity(context: UserContext, unitId: string, options: { page?: number; limit?: number } = {}): Promise<{ items: UnitActivityDTO[]; page: number; pageSize: number; total: number }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.activity.view");
  const page = options.page ?? 1;
  const limit = Math.min(options.limit ?? 50, 100);
  // Sales entries name prices and deals, so they are read only with the unit's sales grant (E-05E §32, §53).
  const modules = can(context, "project.unit.sales.view") ? ["projects", "sales"] : ["projects"];
  const where: Prisma.ActivityWhereInput = { companyId: context.companyId, module: { in: modules }, entityType: "ProjectUnit", entityId: unit.id };
  const [total, rows] = await prisma.$transaction([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, action: true, message: true, createdAt: true, actorMemberId: true, actorMember: { select: { user: { select: { firstName: true, lastName: true } } } } },
    }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return {
    items: rows.map((row) => ({ id: row.id, action: row.action, message: row.message, actor: row.actorMember ? `${row.actorMember.user.firstName} ${row.actorMember.user.lastName}` : null, actorMemberId: row.actorMemberId, createdAt: row.createdAt.toISOString() })),
    page,
    pageSize: limit,
    total,
  };
}
