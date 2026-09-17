import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { createBuilding, deleteBuilding, reorderBuildings, updateBuilding } from "@/lib/modules/project-structure/structure.buildings";
import { bulkCreateFloors, createFloor, deleteFloor, listBuildingFloors, moveFloor, reorderFloors, updateFloor } from "@/lib/modules/project-structure/structure.floors";
import { defaultFloorName, generateUnitCodes, levelTypeForNumber, planFloorRange, suggestCopiedCode } from "@/lib/modules/project-structure/structure.rules";
import {
  bulkFloorsSchema,
  bulkUnitsSchema,
  copyUnitsSchema,
  createBuildingSchema,
  createFloorSchema,
  createUnitSchema,
  parseUnitListQuery,
  updateBuildingSchema,
  updateFloorSchema,
  updateUnitSchema,
} from "@/lib/modules/project-structure/structure.schema";
import { getProjectStructure, getUnitDetail, listProjectUnits, projectStructureSummary } from "@/lib/modules/project-structure/structure.service";
import type { FloorLevelType, UnitDTO } from "@/lib/modules/project-structure/structure.types";
import { bulkCreateUnits, copyUnits, createUnit, deleteUnit, moveUnit, reorderUnits, updateUnit } from "@/lib/modules/project-structure/structure.units";
import { STRUCTURE_SEED } from "../../../prisma/seed/structure";
import { cleanupSessions, COMPANY, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * Buildings, floors and units against the real database (E-05B §135-§140,
 * §146-§150).
 *
 * Riverside Residences (project_a) carries the seeded structure — three
 * blocks, 126 units — and is only read, apart from a probe building a test
 * adds and removes again. Each demo company runs one project, so this file
 * builds two more in Aurelia and removes them at the end: the Project Manager
 * builds on the first, which starts empty and on whose team the Architect is
 * not; the Architect and the Owner build on the second, which the Project
 * Manager is not on. The fixture tenant's Munich Workspace Fitout is the other
 * side of the company wall. Everything a test creates is removed after it,
 * audit and activity included.
 */

const COMPANY_A = COMPANY.a;
const COMPANY_B = COMPANY.tenant;
const RIVERSIDE = PROJECT.a;
const SITE = "t05b_office_tower";
const ASSIGNED = "t05b_marina";
const MUNICH = PROJECT.companyB;
const S = STRUCTURE_SEED;
/** Every building a test names starts with this, so a write that wrongly succeeded is still swept up. */
const T = "E05B";

let pm: UserContext;
let owner: UserContext;
let ceo: UserContext;
let architect: UserContext;
let engineer: UserContext;
let sales: UserContext;
let finance: UserContext;
let viewer: UserContext;
let ownerB: UserContext;
let types: Record<string, string>;
let typesB: Record<string, string>;
let startedAt: Date;
let activityMarks: Array<{ id: string; lastActivityAt: Date | null }> = [];

const made = { buildings: new Set<string>(), floors: new Set<string>(), units: new Set<string>(), unitTypes: new Set<string>() };

async function cleanup() {
  const swept = await prisma.projectBuilding.findMany({ where: { projectId: { in: [RIVERSIDE, SITE, ASSIGNED] }, nameKey: { startsWith: T } }, select: { id: true } });
  const buildingIds = [...new Set([...made.buildings, ...swept.map((row) => row.id)])];
  const floors = await prisma.projectFloor.findMany({ where: { OR: [{ id: { in: [...made.floors] } }, { buildingId: { in: buildingIds } }] }, select: { id: true } });
  const floorIds = [...new Set([...made.floors, ...floors.map((row) => row.id)])];
  const units = await prisma.projectUnit.findMany({
    where: { OR: [{ id: { in: [...made.units] } }, { floorId: { in: floorIds } }, { projectId: RIVERSIDE, unitCodeKey: { startsWith: T } }] },
    select: { id: true },
  });
  const unitIds = [...new Set([...made.units, ...units.map((row) => row.id)])];

  await prisma.projectUnit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.projectFloor.deleteMany({ where: { id: { in: floorIds } } });
  await prisma.projectBuilding.deleteMany({ where: { id: { in: buildingIds } } });
  const trail = [...buildingIds, ...floorIds, ...unitIds, ...made.unitTypes];
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: trail } } });
  // Reordering a project's buildings is evidence about the project itself.
  await prisma.auditEvent.deleteMany({ where: { actionKey: "PROJECT_STRUCTURE_REORDERED", entityId: { in: [RIVERSIDE, SITE, ASSIGNED] }, occurredAt: { gte: startedAt } } });
  await prisma.projectUnitType.deleteMany({ where: { id: { in: [...made.unitTypes] } } });
  for (const set of Object.values(made)) set.clear();
}

async function removeSites() {
  const sites = [SITE, ASSIGNED];
  const trail = (await Promise.all([
    prisma.projectUnit.findMany({ where: { projectId: { in: sites } }, select: { id: true } }),
    prisma.projectFloor.findMany({ where: { projectId: { in: sites } }, select: { id: true } }),
    prisma.projectBuilding.findMany({ where: { projectId: { in: sites } }, select: { id: true } }),
  ])).flat().map((row) => row.id);
  await prisma.projectUnit.deleteMany({ where: { projectId: { in: sites } } });
  await prisma.projectFloor.deleteMany({ where: { projectId: { in: sites } } });
  await prisma.projectBuilding.deleteMany({ where: { projectId: { in: sites } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...trail, ...sites] } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [...trail, ...sites] } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: sites } } });
  await prisma.project.deleteMany({ where: { id: { in: sites } } });
}

async function makeSites() {
  await prisma.project.create({ data: { id: SITE, companyId: COMPANY_A, code: "T05B-TOWER", name: "Harbour Office Tower", status: "ACTIVE", projectManagerMemberId: "member_pm", createdBy: "test" } });
  await prisma.project.create({ data: { id: ASSIGNED, companyId: COMPANY_A, code: "T05B-MARINA", name: "Harbour Marina Apartments", status: "ACTIVE", createdBy: "test" } });
  await prisma.projectMember.createMany({
    data: [
      ...["member_pm", "member_qaqc", "member_hse"].map((companyMemberId) => ({ companyId: COMPANY_A, projectId: SITE, companyMemberId, status: "ACTIVE" as const })),
      { companyId: COMPANY_A, projectId: ASSIGNED, companyMemberId: "member_architect", status: "ACTIVE" as const },
    ],
  });
}

beforeAll(async () => {
  startedAt = new Date();
  [pm, owner, ceo, architect, engineer, sales, finance, viewer] = await Promise.all(
    (["PROJECT_MANAGER", "OWNER", "CEO", "ARCHITECT", "ENGINEER", "SALES", "FINANCE", "VIEWER"] as const).map((role) => loginAs(role)),
  );
  ownerB = await loginAsMembership("member_owner_b");
  const typeMap = async (companyId: string) => Object.fromEntries((await prisma.projectUnitType.findMany({ where: { companyId }, select: { id: true, code: true } })).map((row) => [row.code, row.id]));
  types = await typeMap(COMPANY_A);
  typesB = await typeMap(COMPANY_B);
  activityMarks = await prisma.project.findMany({ where: { id: { in: [RIVERSIDE, MUNICH, PROJECT.d] } }, select: { id: true, lastActivityAt: true } });
  await removeSites();
  await makeSites();
  await cleanup();
});
afterEach(cleanup);
afterAll(async () => {
  // Structure writes move a project's "recently active" marker; put it back.
  for (const mark of activityMarks) await prisma.$executeRaw`UPDATE "projects" SET "lastActivityAt" = ${mark.lastActivityAt} WHERE "id" = ${mark.id}`;
  await removeSites();
  await cleanupSessions();
  await prisma.$disconnect();
});

/* Helpers ------------------------------------------------------------------- */

async function refused(promise: Promise<unknown>, code: string, detail?: string): Promise<AccessError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `expected ${code}${detail ? ` / ${detail}` : ""}, but it succeeded`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code, (error as Error).message).toBe(code);
  if (detail) expect((error as AccessError).details).toMatchObject({ code: detail });
  return error as AccessError;
}

async function building(name: string, context = pm, projectId: string = SITE, code: string | null = null): Promise<string> {
  const { id } = await createBuilding(context, projectId, createBuildingSchema.parse({ name, code }));
  made.buildings.add(id);
  return id;
}

async function floor(buildingId: string, number: number | null, context = pm, levelType: FloorLevelType = number === null ? "ROOF" : levelTypeForNumber(number), name = defaultFloorName(levelType, number)): Promise<string> {
  const { id } = await createFloor(context, buildingId, createFloorSchema.parse({ number, name, levelType }));
  made.floors.add(id);
  return id;
}

async function unit(floorId: string, unitCode: string, extra: Record<string, unknown> = {}, context = pm) {
  const result = await createUnit(context, floorId, createUnitSchema.parse({ unitCode, unitTypeId: types.APARTMENT, ...extra }));
  made.units.add(result.id);
  return result;
}

async function bulkUnits(floorId: string, codes: string[], defaults: Record<string, unknown> = {}, context = pm, dryRun = false) {
  const result = await bulkCreateUnits(context, floorId, bulkUnitsSchema.parse({ units: codes.map((unitCode) => ({ unitCode })), defaults: { unitTypeId: types.APARTMENT, ...defaults }, dryRun }));
  for (const id of result.created) made.units.add(id);
  return result;
}

const editable = (row: UnitDTO) => ({
  unitCode: row.unitCode,
  name: row.name,
  unitTypeId: row.unitType.id,
  position: row.position,
  orientation: row.orientation,
  ...row.areas,
  rooms: row.rooms,
  bedrooms: row.bedrooms,
  bathrooms: row.bathrooms,
  attributes: row.attributes,
  description: row.description,
  isActive: row.isActive,
  expectedVersion: row.version,
});

async function edit(unitId: string, changes: Record<string, unknown>, context = pm) {
  const current = await getUnitDetail(context, unitId);
  return updateUnit(context, unitId, updateUnitSchema.parse({ ...editable(current), ...changes }));
}

async function editBuilding(buildingId: string, changes: Record<string, unknown>, context = pm) {
  const row = await prisma.projectBuilding.findUniqueOrThrow({ where: { id: buildingId } });
  return updateBuilding(context, buildingId, updateBuildingSchema.parse({ name: row.name, code: row.code, description: row.description, isActive: row.isActive, expectedVersion: row.version, ...changes }));
}

async function editFloor(floorId: string, changes: Record<string, unknown>, context = pm) {
  const row = await prisma.projectFloor.findUniqueOrThrow({ where: { id: floorId } });
  return updateFloor(
    context,
    floorId,
    updateFloorSchema.parse({ number: row.number, name: row.name, levelType: row.levelType, elevation: row.elevation?.toFixed(2) ?? null, description: row.description, isActive: row.isActive, expectedVersion: row.version, ...changes }),
  );
}

const floorNames = async (buildingId: string, context = pm) => (await listBuildingFloors(context, buildingId)).map((row) => row.name);
const units = (context: UserContext, projectId: string, query: Record<string, string> = {}) => listProjectUnits(context, projectId, parseUnitListQuery(query));
const audits = (entityId: string, actionKey: string) => prisma.auditEvent.findMany({ where: { entityId, actionKey }, orderBy: { occurredAt: "asc" } });
const floorVersion = async (id: string) => (await prisma.projectFloor.findUniqueOrThrow({ where: { id }, select: { version: true } })).version;

/* Buildings ------------------------------------------------------------------ */

describe("buildings (§7-§10, §54, §57, §146)", () => {
  it("creates a building and edits it with the version it read, refusing a stale edit", async () => {
    const id = await building(`${T} Tower 1`, pm, SITE, "T1");
    let tree = await getProjectStructure(pm, SITE);
    expect(tree.buildings.find((row) => row.id === id)).toMatchObject({ name: `${T} Tower 1`, code: "T1", version: 1, floorCount: 0, unitCount: 0, isActive: true });

    expect(await editBuilding(id, { name: `${T} Tower One`, description: "The north tower" })).toEqual({ version: 2 });
    await refused(updateBuilding(pm, id, updateBuildingSchema.parse({ name: `${T} Tower Uno`, code: "T1", description: null, isActive: true, expectedVersion: 1 })), "CONFLICT", "STRUCTURE_STALE");

    tree = await getProjectStructure(pm, SITE);
    expect(tree.buildings.find((row) => row.id === id)).toMatchObject({ name: `${T} Tower One`, description: "The north tower", version: 2 });
    expect((await audits(id, "PROJECT_BUILDING_CREATED")).length).toBe(1);
    const [updated] = await audits(id, "PROJECT_BUILDING_UPDATED");
    expect(updated.changesJson).toMatchObject({ name: { before: `${T} Tower 1`, after: `${T} Tower One` } });
  });

  it("orders buildings from the whole list, once each", async () => {
    const first = await building(`${T} North`);
    const second = await building(`${T} South`);
    const third = await building(`${T} East`);
    const mine = async () => (await getProjectStructure(pm, SITE)).buildings.map((row) => row.id).filter((id) => [first, second, third].includes(id));
    expect(await mine()).toEqual([first, second, third]);

    await reorderBuildings(pm, SITE, [third, first, second]);
    expect(await mine()).toEqual([third, first, second]);
    await refused(reorderBuildings(pm, SITE, [third, first]), "CONFLICT", "STRUCTURE_REORDER_MISMATCH");
    await refused(reorderBuildings(pm, SITE, [third, first, first]), "CONFLICT", "STRUCTURE_REORDER_MISMATCH");
    await refused(reorderBuildings(pm, SITE, [third, first, S.buildings.a]), "CONFLICT", "STRUCTURE_REORDER_MISMATCH");
    expect(await mine()).toEqual([third, first, second]);
    expect(await prisma.auditEvent.count({ where: { entityId: SITE, actionKey: "PROJECT_STRUCTURE_REORDERED", occurredAt: { gte: startedAt } } })).toBe(1);
  });

  it("keeps names and codes unique on a project whatever their case, and free on another project", async () => {
    const tower = await building(`${T} Tower 1`, pm, SITE, "T1");
    await refused(createBuilding(pm, SITE, createBuildingSchema.parse({ name: `  ${T.toLowerCase()}   tower 1 ` })), "CONFLICT", "BUILDING_NAME_TAKEN");
    await refused(createBuilding(pm, SITE, createBuildingSchema.parse({ name: `${T} Tower 2`, code: "t1" })), "CONFLICT", "BUILDING_CODE_TAKEN");
    const other = await building(`${T} Tower 2`, pm, SITE, "T2");
    await refused(editBuilding(other, { name: `${T} TOWER 1` }), "CONFLICT", "BUILDING_NAME_TAKEN");
    await refused(editBuilding(other, { code: "T1" }), "CONFLICT", "BUILDING_CODE_TAKEN");
    // Changing only the case of its own name is not a clash.
    await editBuilding(tower, { name: `${T} TOWER 1` });

    // Riverside has a Block A with the code A; Central Office Tower may have one too.
    const blockA = await building("Block A", pm, SITE, "A");
    expect(blockA).not.toBe(S.buildings.a);
    // And Marina may have its own Tower 1.
    await building(`${T} Tower 1`, owner, ASSIGNED, "T1");
    expect(await prisma.projectBuilding.count({ where: { nameKey: `${T} TOWER 1` } })).toBe(2);
  });

  it("deletes a building only once its floors are gone", async () => {
    const id = await building(`${T} Annex`);
    const ground = await floor(id, 0);
    await refused(deleteBuilding(pm, id), "CONFLICT", "BUILDING_HAS_FLOORS");
    expect(await prisma.projectBuilding.count({ where: { id } })).toBe(1);

    await deleteFloor(pm, ground);
    await deleteBuilding(pm, id);
    expect(await prisma.projectBuilding.count({ where: { id } })).toBe(0);
    expect((await audits(id, "PROJECT_BUILDING_DELETED")).length).toBe(1);
    await refused(deleteBuilding(pm, id), "NOT_FOUND");
  });

  it("reaches only projects the reader can open", async () => {
    // The Project Manager is on Central Office Tower's team, not Marina's.
    await refused(createBuilding(pm, ASSIGNED, createBuildingSchema.parse({ name: `${T} Nope` })), "NOT_FOUND");
    await refused(createBuilding(pm, MUNICH, createBuildingSchema.parse({ name: `${T} Nope` })), "NOT_FOUND");
    await refused(updateBuilding(pm, S.buildings.munich, updateBuildingSchema.parse({ name: `${T} Taken`, code: null, description: null, isActive: true, expectedVersion: 999 })), "NOT_FOUND");
    await refused(reorderBuildings(pm, MUNICH, [S.buildings.munich]), "NOT_FOUND");
    expect(await prisma.projectBuilding.count({ where: { projectId: { in: [ASSIGNED, MUNICH] }, nameKey: { startsWith: T } } })).toBe(0);
  });
});

/* Floors --------------------------------------------------------------------- */

describe("floors (§11-§15, §53, §57, §147)", () => {
  it("allows Floor 9 once in each building and never twice in one", async () => {
    const one = await building(`${T} Tower 1`);
    const two = await building(`${T} Tower 2`);
    const nineInOne = await floor(one, 9);
    const nineInTwo = await floor(two, 9);
    expect(nineInTwo).not.toBe(nineInOne);

    await refused(createFloor(pm, one, createFloorSchema.parse({ number: 9, name: "Floor 9", levelType: "STANDARD" })), "CONFLICT", "FLOOR_TAKEN");
    // Another name does not make it another floor.
    await refused(createFloor(pm, one, createFloorSchema.parse({ number: 9, name: "Ninth", levelType: "STANDARD" })), "CONFLICT", "FLOOR_TAKEN");
    // A mezzanine at level 0 sits beside the ground floor; one roof per building, whatever its case.
    await floor(one, 0);
    const mezzanine = await floor(one, 0, pm, "MEZZANINE", "Mezzanine");
    await floor(one, null);
    await refused(createFloor(pm, one, createFloorSchema.parse({ number: null, name: " ROOF ", levelType: "ROOF" })), "CONFLICT", "FLOOR_TAKEN");
    // Editing a floor into another's identity is refused too.
    await refused(editFloor(mezzanine, { number: 9, name: "Floor 9", levelType: "STANDARD" }), "CONFLICT", "FLOOR_TAKEN");

    expect(await prisma.projectFloor.count({ where: { buildingId: one, number: 9 } })).toBe(1);
    expect(await floorNames(one)).toEqual(["Ground Floor", "Mezzanine", "Floor 9", "Roof"]);
  });

  it("puts basements below ground, deepest first, and slots new floors into the default order", async () => {
    const id = await building(`${T} Tower`);
    for (const number of [1, 2, 3]) await floor(id, number);
    const basement = await floor(id, -1);
    await floor(id, 0);
    expect(await floorNames(id)).toEqual(["Basement 1", "Ground Floor", "Floor 1", "Floor 2", "Floor 3"]);
    expect((await listBuildingFloors(pm, id)).map((row) => row.sortOrder)).toEqual([1, 2, 3, 4, 5]);

    await floor(id, -2);
    await floor(id, null);
    expect(await floorNames(id)).toEqual(["Basement 2", "Basement 1", "Ground Floor", "Floor 1", "Floor 2", "Floor 3", "Roof"]);
    expect(createFloorSchema.safeParse({ number: 1, name: "Basement 1", levelType: "BASEMENT" }).success).toBe(false);

    await editFloor(basement, { elevation: "-3.2", description: "Parking" });
    const row = (await listBuildingFloors(pm, id)).find((entry) => entry.id === basement)!;
    expect(row).toMatchObject({ levelType: "BASEMENT", number: -1, elevation: "-3.20", description: "Parking", version: 2 });

    // An order set by hand is kept; a new floor goes beside it.
    const ids = (await listBuildingFloors(pm, id)).map((entry) => entry.id);
    const swapped = [ids[0], ids[1], ids[2], ids[4], ids[3], ids[5], ids[6]];
    await reorderFloors(pm, id, swapped);
    expect(await floorNames(id)).toEqual(["Basement 2", "Basement 1", "Ground Floor", "Floor 2", "Floor 1", "Floor 3", "Roof"]);
    await floor(id, 4);
    expect(await floorNames(id)).toEqual(["Basement 2", "Basement 1", "Ground Floor", "Floor 2", "Floor 1", "Floor 3", "Floor 4", "Roof"]);
    await refused(reorderFloors(pm, id, swapped), "CONFLICT", "STRUCTURE_REORDER_MISMATCH");
    expect((await audits(id, "PROJECT_STRUCTURE_REORDERED")).length).toBe(1);
  });

  it("creates floors by range in one transaction with one batch audit event", async () => {
    const id = await building(`${T} Tower`);
    const drafts = planFloorRange(-2, 12);
    const preview = await bulkCreateFloors(pm, id, bulkFloorsSchema.parse({ floors: drafts, dryRun: true }));
    expect(preview).toEqual({ count: 15, conflicts: [], created: [] });
    expect(await prisma.projectFloor.count({ where: { buildingId: id } })).toBe(0);

    const result = await bulkCreateFloors(pm, id, bulkFloorsSchema.parse({ floors: drafts }));
    for (const floorId of result.created) made.floors.add(floorId);
    expect(result).toMatchObject({ count: 15, conflicts: [] });
    expect(result.created).toHaveLength(15);
    expect(await floorNames(id)).toEqual(["Basement 2", "Basement 1", "Ground Floor", ...Array.from({ length: 12 }, (_, index) => `Floor ${index + 1}`)]);

    const events = await audits(id, "PROJECT_FLOORS_BULK_CREATED");
    expect(events).toHaveLength(1);
    expect(events[0].metadataJson).toMatchObject({ batchId: expect.any(String), buildingId: id, floorIds: result.created });
    expect(await prisma.auditEvent.count({ where: { entityId: { in: result.created }, actionKey: "PROJECT_FLOOR_CREATED" } })).toBe(0);
  });

  it("previews clashes without writing, and a batch with one clash creates nothing", async () => {
    const id = await building(`${T} Tower`);
    await floor(id, 1);
    const drafts = [...planFloorRange(0, 2), { number: 2, levelType: "STANDARD" as const, name: "Floor 2" }];

    const preview = await bulkCreateFloors(pm, id, bulkFloorsSchema.parse({ floors: drafts, dryRun: true }));
    expect(preview).toEqual({
      count: 4,
      created: [],
      conflicts: [
        { index: 1, value: "Floor 1", reason: "EXISTS" },
        { index: 3, value: "Floor 2", reason: "REPEATED" },
      ],
    });
    expect(await prisma.projectFloor.count({ where: { buildingId: id } })).toBe(1);

    const error = await refused(bulkCreateFloors(pm, id, bulkFloorsSchema.parse({ floors: planFloorRange(0, 3) })), "CONFLICT", "FLOORS_CONFLICT");
    expect(error.details).toMatchObject({ conflicts: [{ index: 1, value: "Floor 1", reason: "EXISTS" }] });
    expect(await floorNames(id)).toEqual(["Floor 1"]);
    expect((await audits(id, "PROJECT_FLOORS_BULK_CREATED")).length).toBe(0);
  });

  it("asks to confirm more than fifty floors", async () => {
    const id = await building(`${T} Skyscraper`);
    const drafts = planFloorRange(1, 60);
    await refused(bulkCreateFloors(pm, id, bulkFloorsSchema.parse({ floors: drafts })), "VALIDATION_ERROR", "FLOORS_CONFIRM_REQUIRED");
    expect(await prisma.projectFloor.count({ where: { buildingId: id } })).toBe(0);

    const result = await bulkCreateFloors(pm, id, bulkFloorsSchema.parse({ floors: drafts, confirmLarge: true }));
    for (const floorId of result.created) made.floors.add(floorId);
    expect(result.count).toBe(60);
    expect((await getProjectStructure(pm, SITE)).buildings.find((row) => row.id === id)?.floorCount).toBe(60);
  });

  it("deletes a floor only once its units are gone, and closes the gap in the order", async () => {
    const id = await building(`${T} Tower`);
    const first = await floor(id, 1);
    const second = await floor(id, 2);
    const { id: unitId } = await unit(first, "A-101");

    const error = await refused(deleteFloor(pm, first), "CONFLICT", "FLOOR_HAS_UNITS");
    expect(error.details).toMatchObject({ units: 1 });
    expect(await prisma.projectFloor.count({ where: { id: first } })).toBe(1);

    await deleteUnit(pm, unitId);
    await deleteFloor(pm, first);
    expect(await listBuildingFloors(pm, id)).toMatchObject([{ id: second, sortOrder: 1 }]);
    expect((await audits(first, "PROJECT_FLOOR_DELETED")).length).toBe(1);
  });

  it("moves a floor to another building of the project, keeping the floor's and its units' ids", async () => {
    const west = await building(`${T} West`);
    const east = await building(`${T} East`);
    const fifth = await floor(west, 5);
    const sixth = await floor(west, 6);
    await floor(east, 1);
    await floor(east, 7);
    const first = await unit(fifth, "W-501");
    const second = await unit(fifth, "W-502");

    await moveFloor(pm, fifth, { buildingId: east, expectedVersion: 1 });
    const moved = await prisma.projectFloor.findUniqueOrThrow({ where: { id: fifth } });
    expect(moved).toMatchObject({ buildingId: east, projectId: SITE, number: 5, version: 2 });
    expect(await floorNames(east)).toEqual(["Floor 1", "Floor 5", "Floor 7"]);
    expect(await listBuildingFloors(pm, west)).toMatchObject([{ id: sixth, sortOrder: 1 }]);

    for (const { id } of [first, second]) {
      const detail = await getUnitDetail(pm, id, SITE);
      expect(detail).toMatchObject({ id, floor: { id: fifth }, building: { id: east } });
    }
    expect((await getProjectStructure(pm, SITE)).buildings.find((row) => row.id === east)).toMatchObject({ floorCount: 3, unitCount: 2 });
    expect((await audits(fifth, "PROJECT_FLOOR_MOVED")).length).toBe(1);

    await refused(moveFloor(pm, fifth, { buildingId: west, expectedVersion: 1 }), "CONFLICT", "STRUCTURE_STALE");
    // East already has a Floor 6 once one is added.
    await floor(east, 6);
    await refused(moveFloor(pm, sixth, { buildingId: east, expectedVersion: 1 }), "CONFLICT", "FLOOR_TAKEN");
    // A stale version is answered first, even into a building that has the floor.
    await refused(moveFloor(pm, sixth, { buildingId: east, expectedVersion: 7 }), "CONFLICT", "STRUCTURE_STALE");
    expect((await prisma.projectFloor.findUniqueOrThrow({ where: { id: sixth } })).buildingId).toBe(west);
  });

  it("refuses a move to another project's or company's building, naming the field", async () => {
    const west = await building(`${T} West`);
    const fifth = await floor(west, 5);
    for (const target of [S.buildings.a, S.buildings.munich]) {
      const error = await refused(moveFloor(pm, fifth, { buildingId: target, expectedVersion: 1 }), "VALIDATION_ERROR");
      expect(error.details).toHaveProperty("buildingId");
    }
    expect(await prisma.projectFloor.findUniqueOrThrow({ where: { id: fifth } })).toMatchObject({ buildingId: west, version: 1 });
    expect(await prisma.projectFloor.count({ where: { buildingId: S.buildings.a } })).toBe(11);
  });
});

/* Units ---------------------------------------------------------------------- */

describe("units (§16-§30, §52, §55, §56, §83, §148)", () => {
  it("creates a unit with exact areas and updates it with the version it read", async () => {
    const id = await building(`${T} Tower`);
    const ninth = await floor(id, 9);
    const created = await unit(ninth, "A-901", { name: "Apartment 901", position: "CORNER", orientation: "NE", internalArea: "92.40", saleableArea: 113, balconyArea: "12", rooms: 3, bedrooms: 2, bathrooms: 2, description: "Corner flat" });
    expect(created).toMatchObject({ version: 1, warnings: [] });

    const detail = await getUnitDetail(pm, created.id, SITE);
    expect(detail).toMatchObject({
      id: created.id,
      projectId: SITE,
      project: { id: SITE },
      unitCode: "A-901",
      name: "Apartment 901",
      unitType: { id: types.APARTMENT, code: "APARTMENT", category: "RESIDENTIAL" },
      building: { id, name: `${T} Tower` },
      floor: { id: ninth, number: 9, levelType: "STANDARD" },
      position: "CORNER",
      orientation: "NE",
      rooms: 3,
      bedrooms: 2,
      bathrooms: 2,
      attributes: {},
      sortOrder: 1,
      version: 1,
      capabilities: { canUpdateUnit: true, canDeleteUnit: true, canMoveUnit: true },
    });
    expect(detail.areas).toEqual({ internalArea: "92.40", grossArea: null, saleableArea: "113.00", outdoorArea: null, balconyArea: "12.00", terraceArea: null, gardenArea: null, commonAreaAllocation: null });
    const [event] = await audits(created.id, "PROJECT_UNIT_CREATED");
    expect(event.afterJson).toMatchObject({ unitCode: "A-901", internalArea: "92.40", saleableArea: "113.00", floorId: ninth });

    expect(await edit(created.id, { name: "Apartment 901 (combined)", saleableArea: "120.5", bedrooms: 3, orientation: "E" })).toEqual({ version: 2, warnings: [] });
    const after = await getUnitDetail(pm, created.id, SITE);
    expect(after).toMatchObject({ id: created.id, name: "Apartment 901 (combined)", bedrooms: 3, orientation: "E", version: 2, areas: { saleableArea: "120.50", internalArea: "92.40" } });
    await refused(updateUnit(pm, created.id, updateUnitSchema.parse({ ...editable(detail), name: "Lost edit" })), "CONFLICT", "STRUCTURE_STALE");

    const [updated] = await audits(created.id, "PROJECT_UNIT_UPDATED");
    expect(updated.changesJson).toMatchObject({ saleableArea: { before: "113.00", after: "120.50" }, bedrooms: { before: 2, after: 3 } });
    expect((await audits(created.id, "UNIT_CODE_CHANGED")).length).toBe(0);
  });

  it("keeps a unit code unique on its project whatever its case, and free on another project", async () => {
    const tower = await building(`${T} Tower`);
    const first = await floor(tower, 1);
    const second = await floor(tower, 2);
    const annex = await building(`${T} Annex`);
    const annexFirst = await floor(annex, 1);
    await unit(first, "A-901");

    // Another floor, another building: still the same project.
    for (const code of ["A-901", "a-901", " a-901 ", "Ａ-９０１"]) {
      await refused(createUnit(pm, annexFirst, createUnitSchema.parse({ unitCode: code, unitTypeId: types.APARTMENT })), "CONFLICT", "UNIT_CODE_TAKEN");
    }
    const other = await unit(second, "A-902");
    await refused(edit(other.id, { unitCode: "a-901" }), "CONFLICT", "UNIT_CODE_TAKEN");
    expect(await prisma.projectUnit.count({ where: { projectId: SITE, unitCodeKey: "A-901" } })).toBe(1);

    // Riverside has an A-101; Central Office Tower and Marina may have theirs.
    await unit(second, "A-101");
    const marina = await floor(await building(`${T} Marina`, owner, ASSIGNED), 9, owner);
    await unit(marina, "A-901", {}, owner);
    expect(await prisma.projectUnit.count({ where: { unitCodeKey: "A-101", projectId: { in: [RIVERSIDE, SITE] } } })).toBe(2);
    expect(await prisma.projectUnit.count({ where: { unitCodeKey: "A-901", projectId: { in: [SITE, ASSIGNED] } } })).toBe(2);
  });

  it("changes a unit's code without changing its id, and records the change on its own", async () => {
    const ninth = await floor(await building(`${T} Tower`), 9);
    const { id } = await unit(ninth, "A-901");
    await edit(id, { unitCode: "A-911" });

    expect(await prisma.projectUnit.findUniqueOrThrow({ where: { id } })).toMatchObject({ id, unitCode: "A-911", unitCodeKey: "A-911", floorId: ninth, version: 2 });
    const [changed] = await audits(id, "UNIT_CODE_CHANGED");
    expect(changed.changesJson).toEqual({ unitCode: { before: "A-901", after: "A-911" } });
    expect(changed.entityLabelSnapshot).toBe("A-911");
    // The old code is free again.
    await unit(ninth, "A-901");
  });

  it("moves a unit to another floor with its id and code, and audits the move", async () => {
    const tower = await building(`${T} Tower`);
    const first = await floor(tower, 1);
    const second = await floor(tower, 2);
    const annexFloor = await floor(await building(`${T} Annex`), 3);
    const moving = await unit(first, "A-901");
    await unit(second, "A-201");

    expect(await moveUnit(pm, moving.id, { floorId: second, expectedVersion: 1 })).toEqual({ version: 2 });
    expect(await prisma.projectUnit.findUniqueOrThrow({ where: { id: moving.id } })).toMatchObject({ id: moving.id, unitCode: "A-901", floorId: second, projectId: SITE, sortOrder: 2, version: 2 });
    const [event] = await audits(moving.id, "PROJECT_UNIT_MOVED");
    expect(event.changesJson).toMatchObject({ floorId: { before: first, after: second } });

    // To another building of the same project.
    await moveUnit(pm, moving.id, { floorId: annexFloor, expectedVersion: 2 });
    expect(await getUnitDetail(pm, moving.id, SITE)).toMatchObject({ id: moving.id, unitCode: "A-901", floor: { id: annexFloor } });
    await refused(moveUnit(pm, moving.id, { floorId: first, expectedVersion: 2 }), "CONFLICT", "STRUCTURE_STALE");
    // Moving to the floor it is on is nothing.
    expect(await moveUnit(pm, moving.id, { floorId: annexFloor, expectedVersion: 3 })).toEqual({ version: 3 });
    expect((await audits(moving.id, "PROJECT_UNIT_MOVED")).length).toBe(2);
  });

  it("refuses a move to another project's floor, and nothing changes", async () => {
    const first = await floor(await building(`${T} Tower`), 1);
    const { id } = await unit(first, "A-901");
    const before = await prisma.projectUnit.findUniqueOrThrow({ where: { id } });

    for (const target of [S.floors.a1, S.floors.munichGround]) {
      const error = await refused(moveUnit(pm, id, { floorId: target, expectedVersion: 1 }), "VALIDATION_ERROR");
      expect(error.details).toHaveProperty("floorId");
    }
    expect(await prisma.projectUnit.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect((await audits(id, "PROJECT_UNIT_MOVED")).length).toBe(0);
    expect((await units(pm, RIVERSIDE, { floorId: S.floors.a1 })).total).toBe(4);
  });

  it("offers only this company's types in use, while a unit keeps the retired type it has", async () => {
    const first = await floor(await building(`${T} Tower`), 1);
    const loft = await prisma.projectUnitType.create({ data: { companyId: COMPANY_A, name: `${T} Loft`, code: `${T}_LOFT`, category: "RESIDENTIAL", sortOrder: 99, createdBy: "test" } });
    made.unitTypes.add(loft.id);
    const { id } = await unit(first, "L-101", { unitTypeId: loft.id });
    await prisma.projectUnitType.update({ where: { id: loft.id }, data: { isActive: false } });

    const error = await refused(createUnit(pm, first, createUnitSchema.parse({ unitCode: "L-102", unitTypeId: loft.id })), "VALIDATION_ERROR");
    expect(error.details).toHaveProperty("unitTypeId");
    // Our own retired type is a mistake, not a reach across companies: no security reason is logged.
    expect(error.reason).toBeUndefined();
    await refused(bulkUnits(first, ["L-103"], { unitTypeId: loft.id }), "VALIDATION_ERROR");

    // Saving the unit's other details does not strip the type it has.
    expect(await edit(id, { name: "Loft 101" })).toMatchObject({ version: 2 });
    expect(await getUnitDetail(pm, id)).toMatchObject({ name: "Loft 101", unitType: { id: loft.id, isActive: false } });
    // Once changed away, it cannot be chosen back.
    await edit(id, { unitTypeId: types.APARTMENT });
    await refused(edit(id, { unitTypeId: loft.id }), "VALIDATION_ERROR");

    // Company B's Apartment type is not one of ours, whatever it is called.
    const foreign = await refused(createUnit(pm, first, createUnitSchema.parse({ unitCode: "L-104", unitTypeId: typesB.APARTMENT })), "VALIDATION_ERROR");
    expect(foreign.details).toHaveProperty("unitTypeId");
    expect(foreign.reason).toBe("CROSS_COMPANY_REFERENCE");
    await refused(edit(id, { unitTypeId: typesB.APARTMENT }), "VALIDATION_ERROR");
    expect(await prisma.projectUnit.count({ where: { floorId: first } })).toBe(1);
  });

  it("keeps only the attributes the unit's type shows", async () => {
    const first = await floor(await building(`${T} Tower`), 1);
    const parking = await unit(first, "P-001", { unitTypeId: types.PARKING, attributes: { covered: true, evReady: false, frontage: "5.00" } });
    const shop = await unit(first, "SH-01", { unitTypeId: types.SHOP, attributes: { frontage: "9.40", ceilingHeight: "4.2", covered: true } });
    const flat = await unit(first, "A-101", { attributes: { covered: true, ceilingHeight: "3" } });

    expect((await getUnitDetail(pm, parking.id)).attributes).toEqual({ covered: true, evReady: false });
    expect((await getUnitDetail(pm, shop.id)).attributes).toEqual({ frontage: "9.40", ceilingHeight: "4.2" });
    expect((await getUnitDetail(pm, flat.id)).attributes).toEqual({});
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: flat.id } })).attributes).toBeNull();

    // A shop turned into an apartment drops what an apartment does not show.
    await edit(shop.id, { unitTypeId: types.APARTMENT });
    expect((await getUnitDetail(pm, shop.id)).attributes).toEqual({});
  });

  it("returns warnings for unusual values and saves anyway", async () => {
    const first = await floor(await building(`${T} Tower`), 1);
    const parking = await unit(first, "P-002", { unitTypeId: types.PARKING, bedrooms: 2 });
    expect(parking.warnings).toEqual(["A parking unit does not usually have bedrooms."]);
    expect((await prisma.projectUnit.findUniqueOrThrow({ where: { id: parking.id } })).bedrooms).toBe(2);

    const flat = await unit(first, "A-102", { internalArea: "90", saleableArea: "85" });
    expect(flat.warnings).toEqual(["The saleable area is smaller than the internal area."]);
    expect((await edit(flat.id, { saleableArea: "95" })).warnings).toEqual([]);
    expect((await edit(flat.id, { saleableArea: "80" })).warnings).toEqual(["The saleable area is smaller than the internal area."]);
  });

  it("deletes a unit, and its code is free again", async () => {
    const first = await floor(await building(`${T} Tower`), 1);
    const { id } = await unit(first, "A-901");
    await deleteUnit(pm, id);
    expect(await prisma.projectUnit.count({ where: { id } })).toBe(0);
    const [event] = await audits(id, "PROJECT_UNIT_DELETED");
    expect(event.beforeJson).toMatchObject({ unitCode: "A-901", floorId: first });
    await refused(deleteUnit(pm, id), "NOT_FOUND");
    await refused(getUnitDetail(pm, id), "NOT_FOUND");
    await unit(first, "A-901");
  });

  it("orders a floor's units from the whole list, once each", async () => {
    const ninth = await floor(await building(`${T} Tower`), 9);
    const { created } = await bulkUnits(ninth, ["A-901", "A-902", "A-903", "A-904"]);
    const reversed = [...created].reverse();

    await reorderUnits(pm, ninth, reversed);
    expect((await units(pm, SITE, { floorId: ninth })).items.map((row) => row.unitCode)).toEqual(["A-904", "A-903", "A-902", "A-901"]);
    await refused(reorderUnits(pm, ninth, reversed.slice(1)), "CONFLICT", "STRUCTURE_REORDER_MISMATCH");
    await refused(reorderUnits(pm, ninth, [...reversed.slice(1), S.units.a101]), "CONFLICT", "STRUCTURE_REORDER_MISMATCH");
    const [event] = await audits(ninth, "PROJECT_STRUCTURE_REORDERED");
    expect(event.afterJson).toEqual({ order: ["A-904", "A-903", "A-902", "A-901"] });
    expect(event.metadataJson).toMatchObject({ level: "UNIT", floorId: ninth });
  });
});

/* Bulk ----------------------------------------------------------------------- */

describe("bulk units and copying a floor (§41-§45, §77, §96, §98, §149)", () => {
  it("creates A-901 … A-908 in one batch with one audit event carrying the codes", async () => {
    const tower = await building(`${T} Tower`);
    const ninth = await floor(tower, 9);
    const codes = generateUnitCodes({ prefix: "A-", start: 901, end: 908, padding: 0, suffix: "" });
    const defaults = { internalArea: "80", saleableArea: "95.5", bedrooms: 2, orientation: "S" };

    expect(await bulkUnits(ninth, codes, defaults, pm, true)).toEqual({ count: 8, conflicts: [], created: [], warnings: [] });
    expect(await prisma.projectUnit.count({ where: { floorId: ninth } })).toBe(0);

    const result = await bulkUnits(ninth, codes, defaults);
    expect(result).toMatchObject({ count: 8, conflicts: [], warnings: [] });
    expect(result.created).toHaveLength(8);

    const rows = await prisma.projectUnit.findMany({ where: { floorId: ninth }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((row) => row.unitCode)).toEqual(codes);
    expect(rows.map((row) => row.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const row of rows) {
      expect(row).toMatchObject({ projectId: SITE, unitTypeId: types.APARTMENT, bedrooms: 2, orientation: "S" });
      expect([row.internalArea?.toFixed(2), row.saleableArea?.toFixed(2)]).toEqual(["80.00", "95.50"]);
    }

    const events = await audits(ninth, "PROJECT_UNITS_BULK_CREATED");
    expect(events).toHaveLength(1);
    expect(events[0].metadataJson).toEqual({ batchId: expect.any(String), floorId: ninth, buildingId: tower, codes, unitIds: result.created });
    expect(await prisma.auditEvent.count({ where: { entityId: { in: result.created }, actionKey: "PROJECT_UNIT_CREATED" } })).toBe(0);
    expect((await getProjectStructure(pm, SITE)).buildings.find((row) => row.id === tower)?.floors[0]).toMatchObject({ id: ninth, unitCount: 8 });
  });

  it("detects a duplicate before creating, and a batch with one creates nothing", async () => {
    const ninth = await floor(await building(`${T} Tower`), 9);
    await unit(ninth, "A-905");
    const codes = ["A-903", "A-904", "a-905", "A-906", "A-906"];
    const expected = [
      { index: 2, value: "a-905", reason: "EXISTS" },
      { index: 4, value: "A-906", reason: "REPEATED" },
    ];

    expect((await bulkUnits(ninth, codes, {}, pm, true)).conflicts).toEqual(expected);
    const error = await refused(bulkUnits(ninth, codes), "CONFLICT", "UNITS_CONFLICT");
    expect((error.details as { conflicts: unknown }).conflicts).toEqual(expected);
    expect(await prisma.projectUnit.findMany({ where: { floorId: ninth }, select: { unitCode: true } })).toEqual([{ unitCode: "A-905" }]);
    expect((await audits(ninth, "PROJECT_UNITS_BULK_CREATED")).length).toBe(0);
  });

  it("copies a floor's units as new units with new ids and the confirmed codes", async () => {
    const tower = await building(`${T} Tower`);
    const eighth = await floor(tower, 8);
    const ninth = await floor(tower, 9);
    await unit(eighth, "A-801", { name: "Apartment 801", orientation: "NE", position: "CORNER", internalArea: "92.40", saleableArea: "113.00", rooms: 3, bedrooms: 2, bathrooms: 2 });
    await unit(eighth, "A-802", { name: "Shop 802", unitTypeId: types.SHOP, internalArea: "60", attributes: { frontage: "7.80" } });

    const sources = (await units(pm, SITE, { floorId: eighth })).items;
    const plan = sources.map((source) => ({ sourceUnitId: source.id, unitCode: suggestCopiedCode(source.unitCode, 8, 9), name: source.name }));
    expect(plan.map((entry) => entry.unitCode)).toEqual(["A-901", "A-902"]);

    expect((await copyUnits(pm, ninth, copyUnitsSchema.parse({ sourceFloorId: eighth, units: plan, dryRun: true }))).conflicts).toEqual([]);
    const result = await copyUnits(pm, ninth, copyUnitsSchema.parse({ sourceFloorId: eighth, units: plan }));
    for (const id of result.created) made.units.add(id);
    expect(result.created).toHaveLength(2);
    expect(result.created.filter((id) => sources.some((source) => source.id === id))).toEqual([]);

    const copies = (await units(pm, SITE, { floorId: ninth })).items;
    expect(copies.map((copy) => copy.id).sort()).toEqual([...result.created].sort());
    copies.forEach((copy, index) => {
      const source = sources[index]!;
      expect(copy.unitCode).toBe(plan[index]!.unitCode);
      expect(copy).toMatchObject({ name: source.name, unitType: source.unitType, orientation: source.orientation, position: source.position, areas: source.areas, rooms: source.rooms, bedrooms: source.bedrooms, bathrooms: source.bathrooms, attributes: source.attributes });
    });
    // The originals stay where they were, as they were.
    expect((await units(pm, SITE, { floorId: eighth })).items.map((row) => [row.id, row.unitCode, row.version])).toEqual(sources.map((row) => [row.id, row.unitCode, 1]));

    const [event] = await audits(ninth, "PROJECT_UNITS_BULK_CREATED");
    expect(event.metadataJson).toMatchObject({ copiedFromFloorId: eighth, codes: ["A-901", "A-902"], unitIds: result.created });

    // Copying again would take codes the project now has.
    expect((await copyUnits(pm, ninth, copyUnitsSchema.parse({ sourceFloorId: eighth, units: plan, dryRun: true }))).conflicts.map((conflict) => conflict.reason)).toEqual(["EXISTS", "EXISTS"]);
    await refused(copyUnits(pm, ninth, copyUnitsSchema.parse({ sourceFloorId: eighth, units: plan })), "CONFLICT", "UNITS_CONFLICT");
    // And nothing is copied from another project's floor.
    const foreign = await refused(copyUnits(pm, ninth, copyUnitsSchema.parse({ sourceFloorId: S.floors.a1, units: [{ sourceUnitId: S.units.a101, unitCode: "Z-101" }] })), "VALIDATION_ERROR");
    expect(foreign.details).toHaveProperty("sourceFloorId");
    expect(await prisma.projectUnit.count({ where: { floorId: ninth } })).toBe(2);
  });

  it("creates five hundred units in one batch quickly, and pages through them", async () => {
    const tower = await building(`${T} Tower`);
    const basement = await floor(tower, -1);
    const codes = generateUnitCodes({ prefix: "P-", start: 1, end: 500, padding: 3, suffix: "" });
    const started = Date.now();
    const result = await bulkUnits(basement, codes, { unitTypeId: types.PARKING, internalArea: "12.50", attributes: { covered: true } });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.count).toBe(500);

    const page = await units(pm, SITE, { buildingId: tower, sort: "code", page: "10" });
    expect(page).toMatchObject({ page: 10, pageSize: 50, total: 500 });
    expect(page.items.map((row) => row.unitCode)).toEqual(codes.slice(450, 500));
    expect((await audits(basement, "PROJECT_UNITS_BULK_CREATED")).length).toBe(1);
  });

  it("lets exactly one of two overlapping batches win, with no partial rows (§95, §96)", async () => {
    const tower = await building(`${T} Tower`);
    const first = await floor(tower, 1);
    const second = await floor(tower, 2);

    const sameFloor = [generateUnitCodes({ prefix: "C-", start: 101, end: 105, padding: 0, suffix: "" }), generateUnitCodes({ prefix: "C-", start: 105, end: 109, padding: 0, suffix: "" })];
    // On one floor the floor lock serialises them; on two floors the unique index decides.
    const cases = [
      { floors: [first, first], batches: sameFloor },
      { floors: [first, second], batches: sameFloor.map((codes) => codes.map((code) => code.replace("C-", "D-"))) },
    ];

    for (const { floors, batches } of cases) {
      const settled = await Promise.allSettled(batches.map((codes, index) => bulkCreateUnits(pm, floors[index]!, bulkUnitsSchema.parse({ units: codes.map((unitCode) => ({ unitCode })), defaults: { unitTypeId: types.APARTMENT } }))));
      const won = settled.flatMap((outcome, index) => (outcome.status === "fulfilled" ? [{ index, value: outcome.value }] : []));
      const lost = settled.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason as unknown] : []));
      for (const winner of won) for (const id of winner.value.created) made.units.add(id);

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toBeInstanceOf(AccessError);
      expect(lost[0]).toMatchObject({ code: "CONFLICT", details: expect.objectContaining({ code: "UNITS_CONFLICT" }) });

      const prefix = batches[0]![0]!.slice(0, 2);
      const rows = await prisma.projectUnit.findMany({ where: { projectId: SITE, unitCodeKey: { startsWith: prefix } }, orderBy: { unitCodeKey: "asc" }, select: { unitCode: true, floorId: true } });
      const winner = won[0]!;
      expect(rows.map((row) => row.unitCode)).toEqual(batches[winner.index]);
      expect(new Set(rows.map((row) => row.floorId))).toEqual(new Set([floors[winner.index]]));
    }
  });
});

/* Reads ---------------------------------------------------------------------- */

describe("reading the structure (§46-§50, §65, §66, §82, §88-§90, §107-§109)", () => {
  it("returns the tree with counts and no unit payload", async () => {
    const tree = await getProjectStructure(pm, RIVERSIDE);
    expect(tree.project).toMatchObject({ id: RIVERSIDE, companyId: COMPANY_A });
    expect(tree.totals).toEqual({ buildings: 3, floors: 31, units: 126 });
    expect(tree.buildings.map((row) => [row.name, row.floorCount, row.unitCount])).toEqual([
      ["Block A", 11, 42],
      ["Block B", 10, 42],
      ["Block C", 10, 42],
    ]);
    const blockA = tree.buildings[0]!;
    expect(blockA.floors.map((row) => row.name)).toEqual(["Basement 1", "Ground Floor", ...Array.from({ length: 8 }, (_, index) => `Floor ${index + 1}`), "Roof"]);
    expect(blockA.floors.map((row) => row.unitCount)).toEqual([8, 2, 4, 4, 4, 4, 4, 4, 4, 4, 0]);
    expect(blockA.floors[0]).toMatchObject({ id: S.floors.aBasement, levelType: "BASEMENT", number: -1, elevation: "-3.20" });
    for (const node of tree.buildings.flatMap((row) => row.floors)) expect(node).not.toHaveProperty("units");
    expect(JSON.stringify(tree)).not.toContain("A-101");
    expect(tree.unitTypes.map((type) => type.code)).toEqual(expect.arrayContaining(["APARTMENT", "PENTHOUSE", "VILLA", "OFFICE", "SHOP", "PARKING", "GARAGE", "STORAGE", "LAND", "OTHER"]));
    expect(Object.values(tree.capabilities).every(Boolean)).toBe(true);
    expect(await projectStructureSummary(pm, RIVERSIDE)).toEqual({ buildings: 3, floors: 31, units: 126 });
  });

  it("filters units in the database", async () => {
    const codes = async (query: Record<string, string>) => (await units(pm, RIVERSIDE, query)).items.map((row) => row.unitCode);
    const total = async (query: Record<string, string>) => (await units(pm, RIVERSIDE, query)).total;

    expect(await codes({ floorId: S.floors.a1 })).toEqual(["A-101", "A-102", "A-103", "A-104"]);
    expect(await total({ buildingId: S.buildings.b })).toBe(42);
    expect(await total({ unitTypeId: types.APARTMENT })).toBe(96);
    expect(await total({ unitTypeId: types.PARKING })).toBe(18);
    expect(await total({ orientation: "NE" })).toBe(24);
    expect(await total({ bedrooms: "3" })).toBe(24);
    expect(await total({ buildingId: S.buildings.a, bedrooms: "2" })).toBe(8);
    expect(await total({ saleableAreaMin: "100", saleableAreaMax: "120" })).toBe(24);
    expect(await total({ internalAreaMin: "100" })).toBe(24);
    expect(await total({ saleableAreaMax: "12.50" })).toBe(24);
    // Search looks at the code, the name and the type's name, whatever the case.
    expect(await codes({ q: "a-10" })).toEqual(["A-101", "A-102", "A-103", "A-104"]);
    expect(await total({ q: "shop" })).toBe(6);
    expect(await total({ q: "PARKING" })).toBe(18);
    expect(await total({ q: "Apartment 80" })).toBe(12);
    // Nothing of another company answers a filter or a search.
    expect(await total({ floorId: S.floors.munichGround })).toBe(0);
    expect(await total({ buildingId: S.buildings.munich })).toBe(0);
    expect(await total({ unitTypeId: typesB.OFFICE })).toBe(0);
    expect(await total({ q: "OF-00" })).toBe(0);
  });

  it("sorts by saleable area and pages fifty at a time with the total", async () => {
    const first = await units(pm, RIVERSIDE, { sort: "-saleableArea" });
    expect(first).toMatchObject({ page: 1, pageSize: 50, total: 126 });
    expect(first.items).toHaveLength(50);
    const areas = first.items.map((row) => Number(row.areas.saleableArea));
    expect(areas[0]).toBe(142.3);
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);

    const last = await units(pm, RIVERSIDE, { sort: "-saleableArea", page: "3" });
    expect(last.items).toHaveLength(26);
    expect(last.items.at(-1)?.areas.saleableArea).toBe("6.00");
    const seen = new Set([...first.items, ...(await units(pm, RIVERSIDE, { sort: "-saleableArea", page: "2" })).items, ...last.items].map((row) => row.id));
    expect(seen.size).toBe(126);
    expect((await units(pm, RIVERSIDE, { sort: "code" })).items[0]?.unitCode).toBe("A-101");
  });

  it("opens a unit only under its own project", async () => {
    expect(await getUnitDetail(pm, S.units.a101, RIVERSIDE)).toMatchObject({ unitCode: "A-101", building: { id: S.buildings.a }, floor: { id: S.floors.a1 }, areas: { internalArea: "92.40", saleableArea: "113.00" } });
    await refused(getUnitDetail(pm, S.units.a101, SITE), "NOT_FOUND", "UNIT_NOT_FOUND");
    await refused(getUnitDetail(pm, S.units.munichOffice1, MUNICH), "NOT_FOUND");
  });
});

/* Permissions ---------------------------------------------------------------- */

/** A throwaway building on Riverside, set up by its Project Manager, for other people to try to change. */
async function riversideProbe() {
  const buildingId = await building(`${T} Probe`, pm, RIVERSIDE);
  const first = await floor(buildingId, 1);
  const second = await floor(buildingId, 2);
  const { id: unitId } = await unit(first, `${T}-P1`);
  return { buildingId, first, second, unitId };
}

/** Everything a structure keeper does, start to finish, on one project. */
async function keepStructure(context: UserContext, projectId: string, label: string) {
  const buildingId = await building(`${T} Works ${label}`, context, projectId);
  const first = await floor(buildingId, 1, context);
  const second = await floor(buildingId, 2, context);
  await editBuilding(buildingId, { description: `Set up by ${label}` }, context);
  await editFloor(first, { elevation: "3.10" }, context);
  const { id } = await unit(first, `${T}-W1`, {}, context);
  const { created } = await bulkUnits(second, [`${T}-W2`, `${T}-W3`], {}, context);
  await edit(id, { name: "Worked" }, context);
  await moveUnit(context, id, { floorId: second, expectedVersion: 2 });
  await reorderUnits(context, second, [id, ...created]);
  await reorderFloors(context, buildingId, [second, first]);
  expect(Object.values((await getProjectStructure(context, projectId)).capabilities).every(Boolean), label).toBe(true);
  for (const unitId of [id, ...created]) await deleteUnit(context, unitId);
  await deleteFloor(context, first);
  await deleteFloor(context, second);
  await deleteBuilding(context, buildingId);
  expect(await prisma.projectBuilding.count({ where: { id: buildingId } })).toBe(0);
}

describe("permissions (§58, §59, §78-§82, §117, §138, §140, §150)", () => {
  it("lets the Project Manager, the Owner and the CEO keep a project's structure", async () => {
    await keepStructure(pm, SITE, "PM");
    await keepStructure(owner, SITE, "Owner");
    await keepStructure(ceo, SITE, "CEO");
  });

  it("lets the Architect keep the structure of a project they are assigned to, and no other", async () => {
    await keepStructure(architect, ASSIGNED, "Architect");

    const siteBuilding = await building(`${T} Tower`);
    const siteFloor = await floor(siteBuilding, 1);
    const siteUnit = await unit(siteFloor, "A-101");
    await refused(getProjectStructure(architect, SITE), "NOT_FOUND");
    await refused(units(architect, SITE), "NOT_FOUND");
    await refused(createBuilding(architect, SITE, createBuildingSchema.parse({ name: `${T} Nope` })), "NOT_FOUND");
    await refused(editBuilding(siteBuilding, { name: `${T} Taken` }, architect), "NOT_FOUND");
    await refused(createFloor(architect, siteBuilding, createFloorSchema.parse({ number: 2, name: "Floor 2", levelType: "STANDARD" })), "NOT_FOUND");
    await refused(createUnit(architect, siteFloor, createUnitSchema.parse({ unitCode: "A-102", unitTypeId: types.APARTMENT })), "NOT_FOUND");
    await refused(getUnitDetail(architect, siteUnit.id), "NOT_FOUND");
    await refused(deleteUnit(architect, siteUnit.id), "NOT_FOUND");
    expect(await projectStructureSummary(architect, SITE)).toBeNull();
    expect(await prisma.projectUnit.count({ where: { floorId: siteFloor } })).toBe(1);
  });

  it("lets the Engineer, Sales, Finance and the Viewer read Riverside's structure and change none of it", async () => {
    const probe = await riversideProbe();
    const nope = `${T} Nope`;

    for (const [label, context] of [["Engineer", engineer], ["Sales", sales], ["Finance", finance], ["Viewer", viewer]] as const) {
      const tree = await getProjectStructure(context, RIVERSIDE);
      expect(tree.totals, label).toEqual({ buildings: 4, floors: 33, units: 127 });
      expect(Object.values(tree.capabilities).some(Boolean), label).toBe(false);
      expect((await units(context, RIVERSIDE, { floorId: S.floors.a1 })).total, label).toBe(4);
      expect(await getUnitDetail(context, S.units.a101, RIVERSIDE), label).toMatchObject({ unitCode: "A-101", capabilities: { canUpdateUnit: false, canDeleteUnit: false, canMoveUnit: false } });
      expect(await listBuildingFloors(context, S.buildings.a), label).toHaveLength(11);

      const writes: Array<[string, () => Promise<unknown>]> = [
        ["create building", () => createBuilding(context, RIVERSIDE, createBuildingSchema.parse({ name: nope }))],
        ["update building", () => editBuilding(probe.buildingId, { name: nope }, context)],
        ["delete building", () => deleteBuilding(context, probe.buildingId)],
        ["reorder buildings", () => reorderBuildings(context, RIVERSIDE, [S.buildings.a, S.buildings.b, S.buildings.c, probe.buildingId])],
        ["create floor", () => createFloor(context, probe.buildingId, createFloorSchema.parse({ number: 3, name: "Floor 3", levelType: "STANDARD" }))],
        ["bulk floors", () => bulkCreateFloors(context, probe.buildingId, bulkFloorsSchema.parse({ floors: planFloorRange(3, 4) }))],
        ["update floor", () => editFloor(probe.second, { name: "Renamed" }, context)],
        ["delete floor", () => deleteFloor(context, probe.second)],
        ["move floor", () => moveFloor(context, probe.second, { buildingId: S.buildings.a, expectedVersion: 1 })],
        ["reorder floors", () => reorderFloors(context, probe.buildingId, [probe.second, probe.first])],
        ["create unit", () => createUnit(context, probe.first, createUnitSchema.parse({ unitCode: `${T}-X1`, unitTypeId: types.APARTMENT }))],
        ["bulk units", () => bulkCreateUnits(context, probe.first, bulkUnitsSchema.parse({ units: [{ unitCode: `${T}-X2` }], defaults: { unitTypeId: types.APARTMENT } }))],
        ["copy units", () => copyUnits(context, probe.second, copyUnitsSchema.parse({ sourceFloorId: probe.first, units: [{ sourceUnitId: probe.unitId, unitCode: `${T}-X3` }] }))],
        ["update unit", () => edit(probe.unitId, { name: "Renamed" }, context)],
        ["move unit", () => moveUnit(context, probe.unitId, { floorId: probe.second, expectedVersion: 1 })],
        ["reorder units", () => reorderUnits(context, probe.first, [probe.unitId])],
        ["delete unit", () => deleteUnit(context, probe.unitId)],
      ];
      for (const [action, attempt] of writes) {
        const error = await attempt().then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(error, `${label}: ${action}`).toBeInstanceOf(AccessError);
        expect((error as AccessError).code, `${label}: ${action}`).toBe("FORBIDDEN");
      }
    }

    expect(await prisma.projectUnit.findUniqueOrThrow({ where: { id: probe.unitId } })).toMatchObject({ floorId: probe.first, name: null, version: 1 });
    expect(await floorNames(probe.buildingId)).toEqual(["Floor 1", "Floor 2"]);
    expect(await floorVersion(probe.second)).toBe(1);
    expect(await prisma.projectBuilding.findUniqueOrThrow({ where: { id: probe.buildingId } })).toMatchObject({ name: `${T} Probe`, version: 1 });
    expect(await prisma.projectBuilding.count({ where: { projectId: RIVERSIDE } })).toBe(4);
  });

  it("shows a project-scoped Viewer only the projects on their team", async () => {
    expect((await getProjectStructure(viewer, RIVERSIDE)).totals.units).toBe(126);
    for (const projectId of [SITE, ASSIGNED, MUNICH]) {
      await refused(getProjectStructure(viewer, projectId), "NOT_FOUND");
      await refused(units(viewer, projectId), "NOT_FOUND");
      expect(await projectStructureSummary(viewer, projectId)).toBeNull();
    }
    const siteUnit = await unit(await floor(await building(`${T} Tower`), 1), "A-101");
    await refused(getUnitDetail(viewer, siteUnit.id), "NOT_FOUND");
  });

  it("answers another company's forged ids as not found, both ways, and changes nothing", async () => {
    const probe = await riversideProbe();
    const a101 = await prisma.projectUnit.findUniqueOrThrow({ where: { id: S.units.a101 } });
    const blockA = await prisma.projectBuilding.findUniqueOrThrow({ where: { id: S.buildings.a } });
    const nope = `${T} Nope`;

    // Company B's Owner, with Company A's ids.
    await refused(getProjectStructure(ownerB, RIVERSIDE), "NOT_FOUND");
    await refused(units(ownerB, RIVERSIDE), "NOT_FOUND");
    expect(await projectStructureSummary(ownerB, RIVERSIDE)).toBeNull();
    await refused(getUnitDetail(ownerB, S.units.a101), "NOT_FOUND");
    await refused(listBuildingFloors(ownerB, S.buildings.a), "NOT_FOUND");
    await refused(createBuilding(ownerB, RIVERSIDE, createBuildingSchema.parse({ name: nope })), "NOT_FOUND");
    await refused(reorderBuildings(ownerB, RIVERSIDE, [S.buildings.c, S.buildings.b, S.buildings.a]), "NOT_FOUND");
    await refused(updateBuilding(ownerB, S.buildings.a, updateBuildingSchema.parse({ name: nope, code: null, description: null, isActive: false, expectedVersion: 1 })), "NOT_FOUND");
    await refused(deleteBuilding(ownerB, probe.buildingId), "NOT_FOUND");
    await refused(createFloor(ownerB, S.buildings.a, createFloorSchema.parse({ number: 9, name: "Floor 9", levelType: "STANDARD" })), "NOT_FOUND");
    await refused(bulkCreateFloors(ownerB, S.buildings.a, bulkFloorsSchema.parse({ floors: planFloorRange(9, 10) })), "NOT_FOUND");
    await refused(deleteFloor(ownerB, probe.second), "NOT_FOUND");
    await refused(moveFloor(ownerB, probe.second, { buildingId: S.buildings.munich, expectedVersion: 1 }), "NOT_FOUND");
    await refused(createUnit(ownerB, S.floors.a1, createUnitSchema.parse({ unitCode: `${T}-B1`, unitTypeId: typesB.APARTMENT })), "NOT_FOUND");
    await refused(bulkCreateUnits(ownerB, S.floors.a8, bulkUnitsSchema.parse({ units: [{ unitCode: `${T}-B2` }], defaults: { unitTypeId: typesB.APARTMENT } })), "NOT_FOUND");
    await refused(updateUnit(ownerB, S.units.a101, updateUnitSchema.parse({ unitCode: "HIJACKED", unitTypeId: typesB.APARTMENT, isActive: true, expectedVersion: a101.version })), "NOT_FOUND");
    await refused(moveUnit(ownerB, S.units.a101, { floorId: S.floors.munichGround, expectedVersion: a101.version }), "NOT_FOUND");
    await refused(deleteUnit(ownerB, probe.unitId), "NOT_FOUND");
    // Their own unit cannot be moved onto Company A's floor either.
    const office = await prisma.projectUnit.findUniqueOrThrow({ where: { id: S.units.munichOffice1 } });
    const error = await refused(moveUnit(ownerB, S.units.munichOffice1, { floorId: S.floors.a1, expectedVersion: office.version }), "VALIDATION_ERROR");
    expect(error.details).toHaveProperty("floorId");
    expect(await getUnitDetail(ownerB, S.units.munichOffice1, MUNICH)).toMatchObject({ unitCode: "OF-001" });

    // Company A's Project Manager, with Company B's ids.
    await refused(getProjectStructure(pm, MUNICH), "NOT_FOUND");
    await refused(getUnitDetail(pm, S.units.munichOffice1), "NOT_FOUND");
    await refused(listBuildingFloors(pm, S.buildings.munich), "NOT_FOUND");
    await refused(createUnit(pm, S.floors.munichGround, createUnitSchema.parse({ unitCode: `${T}-A1`, unitTypeId: types.OFFICE })), "NOT_FOUND");
    await refused(createFloor(pm, S.buildings.munich, createFloorSchema.parse({ number: 5, name: "Floor 5", levelType: "STANDARD" })), "NOT_FOUND");
    await refused(updateUnit(pm, S.units.munichOffice1, updateUnitSchema.parse({ unitCode: "HIJACKED", unitTypeId: types.OFFICE, isActive: true, expectedVersion: office.version })), "NOT_FOUND");
    await refused(deleteFloor(pm, "flr_munich_1"), "NOT_FOUND");
    await refused(moveUnit(pm, S.units.munichOffice1, { floorId: "flr_munich_1", expectedVersion: office.version }), "NOT_FOUND");

    // Nothing moved on either side.
    expect(await prisma.projectUnit.findUniqueOrThrow({ where: { id: S.units.a101 } })).toEqual(a101);
    expect(await prisma.projectUnit.findUniqueOrThrow({ where: { id: S.units.munichOffice1 } })).toEqual(office);
    expect(await prisma.projectFloor.count({ where: { id: "flr_munich_1" } })).toBe(1);
    expect(await prisma.projectBuilding.findUniqueOrThrow({ where: { id: S.buildings.a } })).toEqual(blockA);
    expect(await prisma.projectUnit.count({ where: { OR: [{ projectId: RIVERSIDE }, { projectId: MUNICH }], unitCodeKey: { startsWith: T } } })).toBe(1);
    expect(await prisma.projectFloor.count({ where: { buildingId: S.buildings.a } })).toBe(11);
  });

  it("gives a person in two companies each company's structure only through that company's session", async () => {
    const inD = await loginAsMembership("member_multicompany_d");
    const inA = await loginAsMembership("member_multicompany_a");
    expect([inA.companyId, inD.companyId]).toEqual([COMPANY_A, COMPANY.d]);
    // Marina Apartments carries no seeded structure; the Architect on it sets up a unit to reach for.
    const apartmentD = (await prisma.projectUnitType.findFirstOrThrow({ where: { companyId: COMPANY.d, code: "APARTMENT" } })).id;
    const marinaUnit = await unit(await floor(await building(`${T} Marina`, inD, PROJECT.d), 1, inD), "A-101", { unitTypeId: apartmentD }, inD);
    expect(await getUnitDetail(inD, marinaUnit.id, PROJECT.d)).toMatchObject({ unitCode: "A-101" });
    await refused(getUnitDetail(inD, S.units.a101), "NOT_FOUND");
    await refused(getProjectStructure(inD, RIVERSIDE), "NOT_FOUND");
    await refused(getUnitDetail(inA, marinaUnit.id), "NOT_FOUND");
    await refused(getProjectStructure(inA, PROJECT.d), "NOT_FOUND");
  });
});
