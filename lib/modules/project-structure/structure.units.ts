import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import type { UnitTypeCategory } from "@/config/unit-types";
import { AccessError, assertPermission, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { runInTransaction } from "@/lib/core/transactions/transaction";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { assertSameSet, uniqueTarget } from "./structure.buildings";
import { conflictMessage, findReadableFloor } from "./structure.floors";
import { MODULE, UNIT_ENTITY } from "./structure.permissions";
import { attributesFor, findCodeConflicts, structureKey, unitWarnings } from "./structure.rules";
import type { BulkUnitsInput, CopyUnitsInput, CreateUnitInput, TechnicalInput, UpdateUnitInput } from "./structure.schema";
import { fail, findReadableUnit } from "./structure.service";
import { AREA_FIELDS, type BatchPreview, type UnitAttributes } from "./structure.types";

/**
 * Units (E-05B §16-§30, §40-§45, §51-§56, §83, §98, §117-§120).
 *
 * One row per physical unit, and its id is its identity for good: a new code,
 * a new name, another floor — the id, the page and every future Sales, Finance,
 * Documents or 3D reference stay (§83). The code is unique per project on its
 * normalised key, checked before writing and held by the database while
 * writing (§44, §96). A move stays inside the project (§118) and never changes
 * the code on its own (§119).
 */

type Tx = Prisma.TransactionClient;

async function lockFloor(tx: Tx, floorId: string) {
  await tx.$queryRaw`SELECT "id" FROM "project_floors" WHERE "id" = ${floorId} FOR UPDATE`;
}

const codeTaken = (code: string) => fail("UNIT_CODE_TAKEN", `${code} is already used on this project.`, "CONFLICT", { field: "unitCode" });

type ChosenType = { id: string; name: string; category: UnitTypeCategory };

/**
 * A type of this company that is in use — or the one the unit already has,
 * retired or not, so saving other details never strips it (§116).
 */
async function requireUnitType(context: UserContext, unitTypeId: string, currentTypeId?: string): Promise<ChosenType> {
  const type = await prisma.projectUnitType.findFirst({ where: { companyId: context.companyId, id: unitTypeId }, select: { id: true, name: true, category: true, isActive: true } });
  if (!type) throw invalidRecordLink("unitTypeId", "CROSS_COMPANY_REFERENCE", "Choose one of this company's unit types in use.");
  // One's own retired type is an ordinary mistake, not a reach across companies.
  if (!type.isActive && type.id !== currentTypeId) throw new AccessError("VALIDATION_ERROR", `${type.name} is retired. Choose a unit type in use.`, { unitTypeId: [`${type.name} is retired. Choose a unit type in use.`] });
  return { id: type.id, name: type.name, category: type.category };
}

/** Only the attributes the type's category shows are kept (§22, §71). */
function keptAttributes(category: UnitTypeCategory, attributes: TechnicalInput["attributes"]): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!attributes) return Prisma.DbNull;
  const allowed = new Set<string>(attributesFor(category));
  const kept = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => allowed.has(key) && value !== null && value !== undefined)) as UnitAttributes;
  return Object.keys(kept).length ? (kept as Prisma.InputJsonValue) : Prisma.DbNull;
}

function technicalData(input: TechnicalInput, type: ChosenType) {
  const areas = Object.fromEntries(AREA_FIELDS.map((field) => [field, input[field] === null ? null : new Prisma.Decimal(input[field]!)]));
  return {
    unitTypeId: type.id,
    position: input.position,
    orientation: input.orientation,
    ...areas,
    rooms: input.rooms,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    attributes: keptAttributes(type.category, input.attributes),
    description: input.description,
  };
}

/** What an audit snapshot keeps of a unit: exact strings for areas, never floats. */
function snapshot(values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) out[key] = value instanceof Prisma.Decimal ? value.toFixed(2) : value;
  return out;
}

export async function createUnit(context: UserContext, floorId: string, input: CreateUnitInput): Promise<{ id: string; version: number; warnings: string[] }> {
  const floor = await findReadableFloor(context, floorId);
  assertPermission(context, "project.unit.create");
  const type = await requireUnitType(context, input.unitTypeId);
  const unitCodeKey = structureKey(input.unitCode);

  return runInTransaction("structure.unit.create", async (tx) => {
    await lockFloor(tx, floor.id);
    const clash = await tx.projectUnit.findFirst({ where: { companyId: context.companyId, projectId: floor.projectId, unitCodeKey }, select: { id: true } });
    if (clash) throw codeTaken(input.unitCode);
    const last = await tx.projectUnit.aggregate({ where: { companyId: context.companyId, floorId: floor.id }, _max: { sortOrder: true } });
    const data = technicalData(input, type);
    const unit = await tx.projectUnit.create({
      data: {
        companyId: context.companyId,
        projectId: floor.projectId,
        floorId: floor.id,
        unitCode: input.unitCode,
        unitCodeKey,
        name: input.name,
        ...data,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdBy: context.userId,
      },
      select: { id: true, version: true },
    });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_CREATED", message: `added unit ${input.unitCode} to ${floor.building.name} / ${floor.name}`, metadata: { projectId: floor.projectId, floorId: floor.id } });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_UNIT_CREATED,
        entity: { type: UNIT_ENTITY, id: unit.id, label: input.unitCode },
        projectId: floor.projectId,
        after: snapshot({ floorId: floor.id, unitCode: input.unitCode, name: input.name, ...data, attributes: data.attributes === Prisma.DbNull ? null : data.attributes }),
      },
      { tx },
    );
    return { id: unit.id, version: unit.version, warnings: unitWarnings(type.category, input) };
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw codeTaken(input.unitCode);
    throw error;
  });
}

async function takenKeys(client: Tx | typeof prisma, context: UserContext, projectId: string, codes: string[]): Promise<Set<string>> {
  const keys = [...new Set(codes.map(structureKey))];
  const rows = await client.projectUnit.findMany({ where: { companyId: context.companyId, projectId, unitCodeKey: { in: keys } }, select: { unitCodeKey: true } });
  return new Set(rows.map((row) => row.unitCodeKey));
}

async function writeBatch(
  tx: Tx,
  context: UserContext,
  floor: Awaited<ReturnType<typeof findReadableFloor>>,
  rows: Array<Record<string, unknown> & { unitCode: string; name: string | null }>,
  audit: { batchId: string; unitTypeId: string | null; sourceFloorId?: string },
): Promise<string[]> {
  await lockFloor(tx, floor.id);
  const conflicts = findCodeConflicts(
    rows.map((row) => row.unitCode),
    await takenKeys(tx, context, floor.projectId, rows.map((row) => row.unitCode)),
  );
  if (conflicts.length) throw fail("UNITS_CONFLICT", conflictMessage(conflicts, "This project already has"), "CONFLICT", { conflicts });

  const last = await tx.projectUnit.aggregate({ where: { companyId: context.companyId, floorId: floor.id }, _max: { sortOrder: true } });
  const start = (last._max.sortOrder ?? 0) + 1;
  const created = await tx.projectUnit.createManyAndReturn({
    data: rows.map((row, index) => ({
      ...(row as Omit<Prisma.ProjectUnitCreateManyInput, "companyId" | "projectId" | "floorId" | "unitCodeKey" | "sortOrder" | "createdBy">),
      companyId: context.companyId,
      projectId: floor.projectId,
      floorId: floor.id,
      unitCodeKey: structureKey(row.unitCode),
      sortOrder: start + index,
      createdBy: context.userId,
    })),
    select: { id: true },
  });
  const codes = rows.map((row) => row.unitCode);
  await recordActivity(tx, context, {
    module: MODULE,
    entityType: UNIT_ENTITY,
    entityId: floor.id,
    action: audit.sourceFloorId ? "UNITS_COPIED" : "UNITS_BULK_CREATED",
    message: `added ${created.length} ${created.length === 1 ? "unit" : "units"} to ${floor.building.name} / ${floor.name}`,
    metadata: { projectId: floor.projectId, floorId: floor.id, batchId: audit.batchId },
  });
  // One event for the batch, its codes and ids in metadata — not a hundred copies of the same payload (§77).
  await recordUserAction(
    context,
    {
      actionKey: AuditAction.PROJECT_UNITS_BULK_CREATED,
      entity: { type: "ProjectFloor", id: floor.id, label: `${floor.building.name} / ${floor.name}` },
      projectId: floor.projectId,
      after: { floorId: floor.id, count: created.length, unitTypeId: audit.unitTypeId },
      metadata: { batchId: audit.batchId, floorId: floor.id, buildingId: floor.buildingId, codes, unitIds: created.map((unit) => unit.id), ...(audit.sourceFloorId ? { copiedFromFloorId: audit.sourceFloorId } : {}) },
    },
    { tx },
  );
  return created.map((unit) => unit.id);
}

/**
 * Units by code pattern with shared defaults (§41-§45). The browser generates
 * the codes; the server checks the whole batch — repeats inside it and codes
 * the project already has — and creates all or none. `dryRun` is the preview.
 */
export async function bulkCreateUnits(context: UserContext, floorId: string, input: BulkUnitsInput): Promise<BatchPreview & { created: string[]; warnings: string[] }> {
  const floor = await findReadableFloor(context, floorId);
  assertPermission(context, "project.unit.create");
  const type = await requireUnitType(context, input.defaults.unitTypeId);
  const codes = input.units.map((unit) => unit.unitCode);
  const warnings = unitWarnings(type.category, input.defaults);

  if (input.dryRun) {
    return { count: codes.length, conflicts: findCodeConflicts(codes, await takenKeys(prisma, context, floor.projectId, codes)), created: [], warnings };
  }

  const data = technicalData(input.defaults, type);
  const batchId = randomUUID();
  return runInTransaction("structure.units.bulk", async (tx) => {
    const created = await writeBatch(tx, context, floor, input.units.map((unit) => ({ ...data, unitCode: unit.unitCode, name: unit.name })), { batchId, unitTypeId: type.id });
    return { count: created.length, conflicts: [], created, warnings };
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw fail("UNITS_CONFLICT", "Another change took one of these codes a moment ago. Refresh the preview and try again.", "CONFLICT", { conflicts: [] });
    throw error;
  });
}

/** What a copy takes from its original: the layout, never the identity, the code or the name. */
const COPIED_FIELDS = ["unitTypeId", "position", "orientation", ...AREA_FIELDS, "rooms", "bedrooms", "bathrooms", "description"] as const;

/**
 * Copy a floor's units to another floor (§98). The copies are new units with
 * new ids — physically different units that happen to share a layout — and
 * take the codes the person confirmed, never the originals'.
 */
export async function copyUnits(context: UserContext, floorId: string, input: CopyUnitsInput): Promise<BatchPreview & { created: string[] }> {
  const floor = await findReadableFloor(context, floorId);
  assertPermission(context, "project.unit.create");
  if (input.sourceFloorId === floor.id) throw invalidRecordLink("sourceFloorId", "CROSS_PROJECT_REFERENCE", "Choose another floor to copy from.");
  const source = await prisma.projectFloor.findFirst({ where: { companyId: context.companyId, projectId: floor.projectId, id: input.sourceFloorId }, select: { id: true } });
  if (!source) throw invalidRecordLink("sourceFloorId", "CROSS_PROJECT_REFERENCE", "Choose a floor of this project.");

  const originals = await prisma.projectUnit.findMany({
    where: { companyId: context.companyId, floorId: source.id, id: { in: input.units.map((unit) => unit.sourceUnitId) } },
    select: { id: true, unitCode: true, unitTypeId: true, position: true, orientation: true, internalArea: true, grossArea: true, saleableArea: true, outdoorArea: true, balconyArea: true, terraceArea: true, gardenArea: true, commonAreaAllocation: true, rooms: true, bedrooms: true, bathrooms: true, attributes: true, description: true, unitType: { select: { name: true, isActive: true } } },
  });
  const byId = new Map(originals.map((unit) => [unit.id, unit]));
  if (byId.size !== new Set(input.units.map((unit) => unit.sourceUnitId)).size) throw fail("COPY_SOURCE_CHANGED", "Some of those units are no longer on that floor. Refresh and try again.", "CONFLICT");
  const retired = originals.find((unit) => !unit.unitType.isActive);
  if (retired) throw fail("COPY_TYPE_RETIRED", `${retired.unitCode} has the retired type ${retired.unitType.name}. Change its type or leave it out.`, "VALIDATION_ERROR");

  const codes = input.units.map((unit) => unit.unitCode);
  if (input.dryRun) {
    return { count: codes.length, conflicts: findCodeConflicts(codes, await takenKeys(prisma, context, floor.projectId, codes)), created: [] };
  }

  const batchId = randomUUID();
  return runInTransaction("structure.units.copy", async (tx) => {
    const rows = input.units.map((unit) => {
      const original = byId.get(unit.sourceUnitId)!;
      const technical = Object.fromEntries(COPIED_FIELDS.map((field) => [field, original[field]]));
      return { ...technical, attributes: original.attributes ?? Prisma.DbNull, unitCode: unit.unitCode, name: unit.name };
    });
    const created = await writeBatch(tx, context, floor, rows, { batchId, unitTypeId: null, sourceFloorId: source.id });
    return { count: created.length, conflicts: [], created };
  }).catch((error: unknown) => {
    if (uniqueTarget(error)) throw fail("UNITS_CONFLICT", "Another change took one of these codes a moment ago. Refresh the preview and try again.", "CONFLICT", { conflicts: [] });
    throw error;
  });
}

export async function updateUnit(context: UserContext, unitId: string, input: UpdateUnitInput): Promise<{ version: number; warnings: string[] }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.update");
  const type = await requireUnitType(context, input.unitTypeId, unit.unitType.id);
  const { expectedVersion, ...values } = input;
  const unitCodeKey = structureKey(values.unitCode);
  const codeChanged = values.unitCode !== unit.unitCode;

  return prisma
    .$transaction(async (tx) => {
      if (codeChanged) {
        const clash = await tx.projectUnit.findFirst({ where: { companyId: context.companyId, projectId: unit.projectId, unitCodeKey, id: { not: unit.id } }, select: { id: true } });
        if (clash) throw codeTaken(values.unitCode);
      }
      const data = technicalData(values, type);
      const moved = await tx.projectUnit.updateMany({
        where: { companyId: context.companyId, id: unit.id, version: expectedVersion },
        data: { unitCode: values.unitCode, unitCodeKey, name: values.name, ...data, isActive: values.isActive, updatedBy: context.userId, version: { increment: 1 } },
      });
      if (!moved.count) throw fail("STRUCTURE_STALE", "This unit was updated by another user. Refresh before saving.", "CONFLICT");

      const before = snapshot({
        unitCode: unit.unitCode,
        name: unit.name,
        unitTypeId: unit.unitType.id,
        position: unit.position,
        orientation: unit.orientation,
        ...Object.fromEntries(AREA_FIELDS.map((field) => [field, unit[field]])),
        rooms: unit.rooms,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        attributes: unit.attributes,
        description: unit.description,
        isActive: unit.isActive,
      });
      const after = snapshot({ unitCode: values.unitCode, name: values.name, ...data, attributes: data.attributes === Prisma.DbNull ? null : data.attributes, isActive: values.isActive });
      await recordUserAction(context, { actionKey: AuditAction.PROJECT_UNIT_UPDATED, entity: { type: UNIT_ENTITY, id: unit.id, label: values.unitCode }, projectId: unit.projectId, before, after }, { tx });
      // The id is the identity; a new code is a change to an attribute, and it is evidence of its own (§55).
      if (codeChanged) {
        await recordUserAction(context, { actionKey: AuditAction.UNIT_CODE_CHANGED, entity: { type: UNIT_ENTITY, id: unit.id, label: values.unitCode }, projectId: unit.projectId, before: { unitCode: unit.unitCode }, after: { unitCode: values.unitCode } }, { tx });
      }
      return { version: expectedVersion + 1, warnings: unitWarnings(type.category, values) };
    })
    .catch((error: unknown) => {
      if (uniqueTarget(error)) throw codeTaken(values.unitCode);
      throw error;
    });
}

/**
 * Nothing references a unit yet, so it may be deleted with the grant (§56).
 * When Sales, Finance or 3D first point at units, this is where a referenced
 * unit starts being deactivated instead.
 */
export async function deleteUnit(context: UserContext, unitId: string): Promise<void> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.delete");

  await prisma.$transaction(async (tx) => {
    await tx.projectUnit.delete({ where: { companyId: context.companyId, id: unit.id } });
    await recordActivity(tx, context, { module: MODULE, entityType: UNIT_ENTITY, entityId: unit.id, action: "UNIT_DELETED", message: `removed unit ${unit.unitCode}`, metadata: { projectId: unit.projectId, floorId: unit.floorId } });
    await recordUserAction(
      context,
      { actionKey: AuditAction.PROJECT_UNIT_DELETED, entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode }, projectId: unit.projectId, before: { floorId: unit.floorId, unitCode: unit.unitCode, name: unit.name, unitTypeId: unit.unitType.id } },
      { tx },
    );
  });
}

/** Another floor of the same project; the id, the code and the page stay (§52, §64, §118, §119). */
export async function moveUnit(context: UserContext, unitId: string, input: { floorId: string; expectedVersion: number }): Promise<{ version: number }> {
  const unit = await findReadableUnit(context, unitId);
  assertPermission(context, "project.unit.move");
  if (input.floorId === unit.floorId) return { version: unit.version };

  const target = await prisma.projectFloor.findFirst({
    where: { companyId: context.companyId, projectId: unit.projectId, id: input.floorId },
    select: { id: true, name: true, building: { select: { id: true, name: true } } },
  });
  if (!target) throw invalidRecordLink("floorId", "CROSS_PROJECT_REFERENCE", "Choose a floor of this project.");

  return runInTransaction("structure.unit.move", async (tx) => {
    await lockFloor(tx, target.id);
    const last = await tx.projectUnit.aggregate({ where: { companyId: context.companyId, floorId: target.id }, _max: { sortOrder: true } });
    const moved = await tx.projectUnit.updateMany({
      where: { companyId: context.companyId, id: unit.id, version: input.expectedVersion },
      data: { floorId: target.id, sortOrder: (last._max.sortOrder ?? 0) + 1, updatedBy: context.userId, version: { increment: 1 } },
    });
    if (!moved.count) throw fail("STRUCTURE_STALE", "This unit was updated by another user. Refresh before moving it.", "CONFLICT");
    await recordActivity(tx, context, {
      module: MODULE,
      entityType: UNIT_ENTITY,
      entityId: unit.id,
      action: "UNIT_MOVED",
      message: `moved unit ${unit.unitCode} from ${unit.floor.building.name} / ${unit.floor.name} to ${target.building.name} / ${target.name}`,
      metadata: { projectId: unit.projectId, floorId: target.id },
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_UNIT_MOVED,
        entity: { type: UNIT_ENTITY, id: unit.id, label: unit.unitCode },
        projectId: unit.projectId,
        before: { floorId: unit.floorId, floorName: unit.floor.name, buildingId: unit.floor.building.id, buildingName: unit.floor.building.name },
        after: { floorId: target.id, floorName: target.name, buildingId: target.building.id, buildingName: target.building.name },
      },
      { tx },
    );
    return { version: input.expectedVersion + 1 };
  });
}

/** The order units are shown in on their floor, when it is not the order of their codes (§51). */
export async function reorderUnits(context: UserContext, floorId: string, ids: string[]): Promise<void> {
  const floor = await findReadableFloor(context, floorId);
  assertPermission(context, "project.structure.manage");

  await runInTransaction("structure.units.reorder", async (tx) => {
    await lockFloor(tx, floor.id);
    const rows = await tx.projectUnit.findMany({ where: { companyId: context.companyId, floorId: floor.id }, orderBy: { sortOrder: "asc" }, select: { id: true, unitCode: true, sortOrder: true } });
    assertSameSet(rows.map((row) => row.id), ids);
    const current = new Map(rows.map((row) => [row.id, row]));
    for (const [index, id] of ids.entries()) {
      if (current.get(id)!.sortOrder === index + 1) continue;
      await tx.projectUnit.update({ where: { companyId: context.companyId, id }, data: { sortOrder: index + 1 } });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_STRUCTURE_REORDERED,
        entity: { type: "ProjectFloor", id: floor.id, label: `${floor.building.name} / ${floor.name}` },
        projectId: floor.projectId,
        before: { order: rows.map((row) => row.unitCode) },
        after: { order: ids.map((id) => current.get(id)!.unitCode) },
        metadata: { level: "UNIT", floorId: floor.id },
      },
      { tx },
    );
  });
}
