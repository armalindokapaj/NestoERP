import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { AccessError, assertModule, assertPermission, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { assertSameSet, findReadableBuilding, uniqueTarget } from "./structure.buildings";
import { FLOOR_ENTITY, MODULE, readableFloorWhere, structureProjectDoor } from "./structure.permissions";
import { floorKeyOf, placeFloors, type FloorDraft } from "./structure.rules";
import type { BulkFloorsInput, CreateFloorInput, UpdateFloorInput } from "./structure.schema";
import { fail, STRUCTURE_PROJECT_SELECT } from "./structure.service";
import { CONFIRM_FLOORS_ABOVE, type BatchConflict, type BatchPreview } from "./structure.types";

/**
 * Floors (E-05B §11-§15, §36-§39, §45, §53, §57, §62).
 *
 * A floor belongs to one building; its number is unique only inside that
 * building (§14), so Building 1 / Floor 9 and Building 2 / Floor 9 both exist.
 * New floors take their place in the default order — basements, ground,
 * mezzanine, the numbered floors, roof — beside whatever order somebody set by
 * hand (§15). A batch is checked whole and written whole, or not at all (§45).
 * Moving a floor to another building is its own action, never an inline edit,
 * and takes its units with it, ids unchanged (§53).
 */

type Tx = Prisma.TransactionClient;

const FLOOR_SELECT = { id: true, number: true, name: true, levelType: true, floorKey: true, sortOrder: true } satisfies Prisma.ProjectFloorSelect;

/** Holds the building while its floors are counted and ordered, so two batches do not interleave. */
async function lockBuilding(tx: Tx, buildingId: string) {
  await tx.$queryRaw`SELECT "id" FROM "project_buildings" WHERE "id" = ${buildingId} FOR UPDATE`;
}

async function renumber(tx: Tx, companyId: string, ordered: Array<{ id: string; sortOrder?: number }>) {
  for (const [index, floor] of ordered.entries()) {
    if (floor.sortOrder === index + 1) continue;
    await tx.projectFloor.update({ where: { companyId, id: floor.id }, data: { sortOrder: index + 1 } });
  }
}

function floorTaken(buildingName: string, existing: { name: string }, field: "number" | "name") {
  return fail("FLOOR_TAKEN", `${buildingName} already has ${existing.name}.`, "CONFLICT", { field });
}

export async function findReadableFloor(context: UserContext, floorId: string) {
  assertModule(context, MODULE);
  if (!structureProjectDoor(context)) throw new AccessError("FORBIDDEN", "You cannot open project structures.");
  const floor = await prisma.projectFloor.findFirst({
    where: { AND: [readableFloorWhere(context), { id: floorId }] },
    include: { building: { select: { id: true, name: true } }, project: { select: STRUCTURE_PROJECT_SELECT } },
  });
  if (!floor) throw fail("FLOOR_NOT_FOUND", "That floor could not be found.", "NOT_FOUND");
  return floor;
}

export async function createFloor(context: UserContext, buildingId: string, input: CreateFloorInput): Promise<{ id: string; version: number }> {
  const building = await findReadableBuilding(context, buildingId);
  assertPermission(context, "project.floor.create");
  const floorKey = floorKeyOf(input.levelType, input.number, input.name);

  return runInTransaction("structure.floor.create", async (tx) => {
    await lockBuilding(tx, building.id);
    const existing = await tx.projectFloor.findMany({ where: { companyId: context.companyId, buildingId: building.id }, orderBy: { sortOrder: "asc" }, select: FLOOR_SELECT });
    const clash = existing.find((floor) => floor.floorKey === floorKey);
    if (clash) throw floorTaken(building.name, clash, input.number === null ? "name" : "number");

    const floor = await tx.projectFloor.create({
      data: {
        companyId: context.companyId,
        projectId: building.projectId,
        buildingId: building.id,
        number: input.number,
        name: input.name,
        levelType: input.levelType,
        floorKey,
        sortOrder: existing.length + 1,
        elevation: input.elevation === null ? null : new Prisma.Decimal(input.elevation),
        description: input.description,
        createdBy: context.userId,
      },
      select: { id: true, version: true, number: true, levelType: true, sortOrder: true },
    });
    await renumber(tx, context.companyId, placeFloors(existing, [floor]));
    await recordActivity(tx, context, { module: MODULE, entityType: FLOOR_ENTITY, entityId: floor.id, action: "FLOOR_CREATED", message: `added ${input.name} to ${building.name}`, metadata: { projectId: building.projectId, buildingId: building.id } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_FLOOR_CREATED,
        entity: { type: FLOOR_ENTITY, id: floor.id, label: `${building.name} / ${input.name}` },
        projectId: building.projectId,
        after: { buildingId: building.id, floorId: floor.id, number: input.number, name: input.name, levelType: input.levelType, elevation: input.elevation },
      },
      { tx },
    );
    return { id: floor.id, version: floor.version };
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw fail("FLOOR_TAKEN", `${building.name} already has that floor.`, "CONFLICT", { field: input.number === null ? "name" : "number" });
    throw error;
  });
}

function floorConflicts(drafts: FloorDraft[], existingKeys: Set<string>): BatchConflict[] {
  const seen = new Set<string>();
  const conflicts: BatchConflict[] = [];
  drafts.forEach((draft, index) => {
    const key = floorKeyOf(draft.levelType, draft.number, draft.name);
    if (existingKeys.has(key)) conflicts.push({ index, value: draft.name, reason: "EXISTS" });
    else if (seen.has(key)) conflicts.push({ index, value: draft.name, reason: "REPEATED" });
    seen.add(key);
  });
  return conflicts;
}

/**
 * Floors by range, previewed and then written (§37-§39, §45). `dryRun` answers
 * what would clash without writing; the real run checks again inside the
 * transaction and writes all or nothing. More than fifty floors must be
 * confirmed, because that many is more often a typo than a tower.
 */
export async function bulkCreateFloors(context: UserContext, buildingId: string, input: BulkFloorsInput): Promise<BatchPreview & { created: string[] }> {
  const building = await findReadableBuilding(context, buildingId);
  assertPermission(context, "project.floor.create");

  const keysNow = async (client: Tx | typeof prisma) =>
    new Set((await client.projectFloor.findMany({ where: { companyId: context.companyId, buildingId: building.id }, select: { floorKey: true } })).map((row) => row.floorKey));

  if (input.dryRun) {
    const conflicts = floorConflicts(input.floors, await keysNow(prisma));
    return { count: input.floors.length, conflicts, created: [] };
  }
  if (input.floors.length > CONFIRM_FLOORS_ABOVE && !input.confirmLarge) {
    throw fail("FLOORS_CONFIRM_REQUIRED", `Confirm that you want to create ${input.floors.length} floors.`, "VALIDATION_ERROR", { count: input.floors.length });
  }

  const batchId = randomUUID();
  return runInTransaction("structure.floors.bulk", async (tx) => {
    await lockBuilding(tx, building.id);
    const conflicts = floorConflicts(input.floors, await keysNow(tx));
    if (conflicts.length) throw fail("FLOORS_CONFLICT", conflictMessage(conflicts, `${building.name} already has`), "CONFLICT", { conflicts });

    const existing = await tx.projectFloor.findMany({ where: { companyId: context.companyId, buildingId: building.id }, orderBy: { sortOrder: "asc" }, select: FLOOR_SELECT });
    const created = await tx.projectFloor.createManyAndReturn({
      data: input.floors.map((draft, index) => ({
        companyId: context.companyId,
        projectId: building.projectId,
        buildingId: building.id,
        number: draft.number,
        name: draft.name,
        levelType: draft.levelType,
        floorKey: floorKeyOf(draft.levelType, draft.number, draft.name),
        sortOrder: existing.length + index + 1,
        createdBy: context.userId,
      })),
      select: { id: true, number: true, levelType: true, sortOrder: true },
    });
    await renumber(tx, context.companyId, placeFloors(existing, created));
    await recordActivity(tx, context, { module: MODULE, entityType: FLOOR_ENTITY, entityId: building.id, action: "FLOORS_BULK_CREATED", message: `added ${created.length} floors to ${building.name}`, metadata: { projectId: building.projectId, buildingId: building.id, batchId } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_FLOORS_BULK_CREATED,
        entity: { type: "ProjectBuilding", id: building.id, label: building.name },
        projectId: building.projectId,
        after: { buildingId: building.id, count: created.length },
        metadata: { batchId, buildingId: building.id, floorIds: created.map((floor) => floor.id), names: input.floors.map((draft) => draft.name) },
      },
      { tx },
    );
    return { count: created.length, conflicts: [], created: created.map((floor) => floor.id) };
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw fail("FLOORS_CONFLICT", "Another change added one of these floors a moment ago. Refresh and try again.", "CONFLICT", { conflicts: [] });
    throw error;
  });
}

export function conflictMessage(conflicts: BatchConflict[], existsPrefix: string): string {
  const exists = conflicts.filter((conflict) => conflict.reason === "EXISTS").map((conflict) => conflict.value);
  const repeated = conflicts.filter((conflict) => conflict.reason === "REPEATED").map((conflict) => conflict.value);
  const list = (values: string[]) => (values.length > 3 ? `${values.slice(0, 3).join(", ")} and ${values.length - 3} more` : values.join(", "));
  const parts = [...(exists.length ? [`${existsPrefix} ${list(exists)}`] : []), ...(repeated.length ? [`${list(repeated)} ${repeated.length === 1 ? "appears" : "appear"} twice in this batch`] : [])];
  return `${parts.join("; ")}. Nothing was created.`;
}

export async function updateFloor(context: UserContext, floorId: string, input: UpdateFloorInput): Promise<{ version: number }> {
  const floor = await findReadableFloor(context, floorId);
  assertPermission(context, "project.floor.update");
  const { expectedVersion, ...values } = input;
  const floorKey = floorKeyOf(values.levelType, values.number, values.name);

  return prisma
    .$transaction(async (tx) => {
      if (floorKey !== floor.floorKey) {
        const clash = await tx.projectFloor.findFirst({ where: { companyId: context.companyId, buildingId: floor.buildingId, floorKey, id: { not: floor.id } }, select: { name: true } });
        if (clash) throw floorTaken(floor.building.name, clash, values.number === null ? "name" : "number");
      }
      const moved = await tx.projectFloor.updateMany({
        where: { companyId: context.companyId, id: floor.id, version: expectedVersion },
        data: {
          number: values.number,
          name: values.name,
          levelType: values.levelType,
          floorKey,
          elevation: values.elevation === null ? null : new Prisma.Decimal(values.elevation),
          description: values.description,
          isActive: values.isActive,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });
      if (!moved.count) throw fail("STRUCTURE_STALE", "This floor was updated by another user. Refresh before saving.", "CONFLICT");
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.PROJECT_FLOOR_UPDATED,
          entity: { type: FLOOR_ENTITY, id: floor.id, label: `${floor.building.name} / ${values.name}` },
          projectId: floor.projectId,
          before: { number: floor.number, name: floor.name, levelType: floor.levelType, elevation: floor.elevation, description: floor.description, isActive: floor.isActive },
          after: { number: values.number, name: values.name, levelType: values.levelType, elevation: values.elevation, description: values.description, isActive: values.isActive },
        },
        { tx },
      );
      return { version: expectedVersion + 1 };
    })
    .catch((error: unknown) => {
      if (uniqueTarget(error)) throw fail("FLOOR_TAKEN", `${floor.building.name} already has that floor.`, "CONFLICT", { field: values.number === null ? "name" : "number" });
      throw error;
    });
}

/** Only an empty floor (§57): its units are moved or removed first. */
export async function deleteFloor(context: UserContext, floorId: string): Promise<void> {
  const floor = await findReadableFloor(context, floorId);
  assertPermission(context, "project.floor.delete");

  await runInTransaction("structure.floor.delete", async (tx) => {
    await lockBuilding(tx, floor.buildingId);
    // A unit being added holds the floor; wait for it rather than fail on its foreign key.
    await tx.$queryRaw`SELECT "id" FROM "project_floors" WHERE "id" = ${floor.id} FOR UPDATE`;
    const units = await tx.projectUnit.count({ where: { companyId: context.companyId, floorId: floor.id } });
    if (units) throw fail("FLOOR_HAS_UNITS", `Move or remove this floor's ${units} ${units === 1 ? "unit" : "units"} first.`, "CONFLICT", { units });
    await tx.projectFloor.delete({ where: { companyId: context.companyId, id: floor.id } });
    const rest = await tx.projectFloor.findMany({ where: { companyId: context.companyId, buildingId: floor.buildingId }, orderBy: { sortOrder: "asc" }, select: { id: true, sortOrder: true } });
    await renumber(tx, context.companyId, rest);
    await recordActivity(tx, context, { module: MODULE, entityType: FLOOR_ENTITY, entityId: floor.id, action: "FLOOR_DELETED", message: `removed ${floor.name} from ${floor.building.name}`, metadata: { projectId: floor.projectId, buildingId: floor.buildingId } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_FLOOR_DELETED,
        entity: { type: FLOOR_ENTITY, id: floor.id, label: `${floor.building.name} / ${floor.name}` },
        projectId: floor.projectId,
        before: { buildingId: floor.buildingId, floorId: floor.id, number: floor.number, name: floor.name, levelType: floor.levelType },
      },
      { tx },
    );
  });
}

export async function reorderFloors(context: UserContext, buildingId: string, ids: string[]): Promise<void> {
  const building = await findReadableBuilding(context, buildingId);
  assertPermission(context, "project.structure.manage");

  await runInTransaction("structure.floors.reorder", async (tx) => {
    await lockBuilding(tx, building.id);
    const rows = await tx.projectFloor.findMany({ where: { companyId: context.companyId, buildingId: building.id }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
    assertSameSet(rows.map((row) => row.id), ids);
    await renumber(tx, context.companyId, ids.map((id) => ({ id })));
    const names = new Map(rows.map((row) => [row.id, row.name]));
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_STRUCTURE_REORDERED,
        entity: { type: "ProjectBuilding", id: building.id, label: building.name },
        projectId: building.projectId,
        before: { order: rows.map((row) => row.name) },
        after: { order: ids.map((id) => names.get(id)) },
        metadata: { level: "FLOOR", buildingId: building.id },
      },
      { tx },
    );
  });
}

/**
 * A floor to another building of the same project (§53). Explicit, warned in
 * the interface, and the floor's units go with it: their ids, pages and every
 * future reference stay as they are, because they point at the floor.
 */
export async function moveFloor(context: UserContext, floorId: string, input: { buildingId: string; expectedVersion: number }): Promise<{ version: number }> {
  const floor = await findReadableFloor(context, floorId);
  assertPermission(context, "project.structure.manage");
  if (input.buildingId === floor.buildingId) return { version: floor.version };

  const target = await prisma.projectBuilding.findFirst({ where: { companyId: context.companyId, projectId: floor.projectId, id: input.buildingId }, select: { id: true, name: true } });
  if (!target) throw invalidRecordLink("buildingId", "CROSS_PROJECT_REFERENCE", "Choose a building of this project.");

  return runInTransaction("structure.floor.move", async (tx) => {
    // Both buildings, in a fixed order, so two opposite moves cannot deadlock.
    for (const id of [floor.buildingId, target.id].sort()) await lockBuilding(tx, id);
    // The version the mover read comes first: a floor changed since is stale, whatever else is true.
    const current = await tx.projectFloor.findFirst({ where: { companyId: context.companyId, id: floor.id }, select: { version: true } });
    if (current?.version !== input.expectedVersion) throw fail("STRUCTURE_STALE", "This floor was updated by another user. Refresh before moving it.", "CONFLICT");
    const clash = await tx.projectFloor.findFirst({ where: { companyId: context.companyId, buildingId: target.id, floorKey: floor.floorKey }, select: { name: true } });
    if (clash) throw floorTaken(target.name, clash, "number");

    const existing = await tx.projectFloor.findMany({ where: { companyId: context.companyId, buildingId: target.id }, orderBy: { sortOrder: "asc" }, select: FLOOR_SELECT });
    const moved = await tx.projectFloor.updateMany({
      where: { companyId: context.companyId, id: floor.id, version: input.expectedVersion },
      data: { buildingId: target.id, sortOrder: existing.length + 1, updatedBy: context.userId, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("STRUCTURE_STALE", "This floor was updated by another user. Refresh before moving it.", "CONFLICT");
    await renumber(tx, context.companyId, placeFloors(existing, [{ id: floor.id, number: floor.number, levelType: floor.levelType, sortOrder: existing.length + 1 }]));
    const left = await tx.projectFloor.findMany({ where: { companyId: context.companyId, buildingId: floor.buildingId }, orderBy: { sortOrder: "asc" }, select: { id: true, sortOrder: true } });
    await renumber(tx, context.companyId, left);

    await recordActivity(tx, context, { module: MODULE, entityType: FLOOR_ENTITY, entityId: floor.id, action: "FLOOR_MOVED", message: `moved ${floor.name} from ${floor.building.name} to ${target.name}`, metadata: { projectId: floor.projectId, buildingId: target.id } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_FLOOR_MOVED,
        entity: { type: FLOOR_ENTITY, id: floor.id, label: floor.name },
        projectId: floor.projectId,
        before: { buildingId: floor.buildingId, buildingName: floor.building.name },
        after: { buildingId: target.id, buildingName: target.name },
      },
      { tx },
    );
    return { version: input.expectedVersion + 1 };
  });
}

/** A building's floors in order, with their unit counts (§62, §89). */
export async function listBuildingFloors(context: UserContext, buildingId: string) {
  const building = await findReadableBuilding(context, buildingId);
  const [floors, counts] = await Promise.all([
    prisma.projectFloor.findMany({
      where: { companyId: context.companyId, buildingId: building.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, buildingId: true, number: true, name: true, levelType: true, sortOrder: true, elevation: true, description: true, isActive: true, version: true },
    }),
    prisma.projectUnit.groupBy({ by: ["floorId"], where: { companyId: context.companyId, floor: { is: { buildingId: building.id } } }, _count: { _all: true } }),
  ]);
  const units = new Map(counts.map((row) => [row.floorId, row._count._all]));
  return floors.map((floor) => ({ ...floor, elevation: floor.elevation?.toFixed(2) ?? null, unitCount: units.get(floor.id) ?? 0 }));
}
