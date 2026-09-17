import { Prisma } from "@prisma/client";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { BUILDING_ENTITY, MODULE, readableBuildingWhere, structureProjectDoor } from "./structure.permissions";
import { structureKey } from "./structure.rules";
import type { CreateBuildingInput, UpdateBuildingInput } from "./structure.schema";
import { fail, loadStructureProject, STRUCTURE_PROJECT_SELECT } from "./structure.service";

/**
 * Buildings (E-05B §7-§10, §35, §54, §57, §61).
 *
 * Every unit sits in a building, a single-building project included (§7).
 * Names are unique per project whatever their case, codes too when given
 * (§9). Renaming changes display only: floor and unit ids never move (§54).
 * A building with floors is not deleted — its floors go first (§57).
 */

export function uniqueTarget(error: unknown): string[] | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
}

/** `field` names the input the message belongs to; `code` is the error's own code, so it cannot carry a field error of that name. */
const nameTaken = (name: string) => fail("BUILDING_NAME_TAKEN", `There is already a building called "${name}" on this project.`, "CONFLICT", { field: "name" });
const codeTaken = (code: string) => fail("BUILDING_CODE_TAKEN", `Another building on this project uses the code "${code}".`, "CONFLICT", { field: "code" });

function translate(input: { name: string; code: string | null }) {
  return (error: unknown): never => {
    const target = uniqueTarget(error);
    if (target?.some((column) => column.includes("codeKey")) && input.code) throw codeTaken(input.code);
    if (target) throw nameTaken(input.name);
    throw error;
  };
}

async function assertBuildingFree(projectId: string, input: { name: string; code: string | null }, exceptId?: string) {
  const clash = await prisma.projectBuilding.findFirst({
    where: {
      projectId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [{ nameKey: structureKey(input.name) }, ...(input.code ? [{ codeKey: structureKey(input.code) }] : [])],
    },
    select: { nameKey: true },
  });
  if (!clash) return;
  throw clash.nameKey === structureKey(input.name) ? nameTaken(input.name) : codeTaken(input.code!);
}

export async function findReadableBuilding(context: UserContext, buildingId: string) {
  assertModule(context, MODULE);
  if (!structureProjectDoor(context)) throw new AccessError("FORBIDDEN", "You cannot open project structures.");
  const building = await prisma.projectBuilding.findFirst({
    where: { AND: [readableBuildingWhere(context), { id: buildingId }] },
    include: { project: { select: STRUCTURE_PROJECT_SELECT } },
  });
  if (!building) throw fail("BUILDING_NOT_FOUND", "That building could not be found.", "NOT_FOUND");
  return building;
}

export async function createBuilding(context: UserContext, projectId: string, input: CreateBuildingInput): Promise<{ id: string; version: number }> {
  const project = await loadStructureProject(context, projectId);
  assertPermission(context, "project.building.create");
  await assertBuildingFree(project.id, input);

  return prisma
    .$transaction(async (tx) => {
      const last = await tx.projectBuilding.aggregate({ where: { companyId: context.companyId, projectId: project.id }, _max: { sortOrder: true } });
      const building = await tx.projectBuilding.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          name: input.name,
          nameKey: structureKey(input.name),
          code: input.code,
          codeKey: input.code ? structureKey(input.code) : null,
          description: input.description,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
          createdBy: context.userId,
        },
        select: { id: true, version: true },
      });
      await recordActivity(tx, context, { module: MODULE, entityType: BUILDING_ENTITY, entityId: building.id, action: "BUILDING_CREATED", message: `added the building ${input.name}`, metadata: { projectId: project.id } });
      await recordUserAction(
        context,
        { actionKey: AuditAction.PROJECT_BUILDING_CREATED, entity: { type: BUILDING_ENTITY, id: building.id, label: input.name }, projectId: project.id, after: { buildingId: building.id, name: input.name, code: input.code, description: input.description } },
        { tx },
      );
      return building;
    })
    .catch(translate(input));
}

export async function updateBuilding(context: UserContext, buildingId: string, input: UpdateBuildingInput): Promise<{ version: number }> {
  const building = await findReadableBuilding(context, buildingId);
  assertPermission(context, "project.building.update");
  await assertBuildingFree(building.projectId, input, building.id);

  const { expectedVersion, ...values } = input;
  return prisma
    .$transaction(async (tx) => {
      const moved = await tx.projectBuilding.updateMany({
        where: { companyId: context.companyId, id: building.id, version: expectedVersion },
        data: {
          name: values.name,
          nameKey: structureKey(values.name),
          code: values.code,
          codeKey: values.code ? structureKey(values.code) : null,
          description: values.description,
          isActive: values.isActive,
          updatedBy: context.userId,
          version: { increment: 1 },
        },
      });
      if (!moved.count) throw fail("STRUCTURE_STALE", "This building was updated by another user. Refresh before saving.", "CONFLICT");
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.PROJECT_BUILDING_UPDATED,
          entity: { type: BUILDING_ENTITY, id: building.id, label: values.name },
          projectId: building.projectId,
          before: { name: building.name, code: building.code, description: building.description, isActive: building.isActive },
          after: { name: values.name, code: values.code, description: values.description, isActive: values.isActive },
        },
        { tx },
      );
      return { version: expectedVersion + 1 };
    })
    .catch(translate(values));
}

/** Only an empty building (§57): its floors are removed or moved first. */
export async function deleteBuilding(context: UserContext, buildingId: string): Promise<void> {
  const building = await findReadableBuilding(context, buildingId);
  assertPermission(context, "project.building.delete");

  await prisma.$transaction(async (tx) => {
    // A floor being added holds the building; wait for it rather than fail on its foreign key.
    await tx.$queryRaw`SELECT "id" FROM "project_buildings" WHERE "id" = ${building.id} FOR UPDATE`;
    const floors = await tx.projectFloor.count({ where: { companyId: context.companyId, buildingId: building.id } });
    if (floors) throw fail("BUILDING_HAS_FLOORS", `Remove or move this building's ${floors} ${floors === 1 ? "floor" : "floors"} first.`, "CONFLICT", { floors });
    await tx.projectBuilding.delete({ where: { companyId: context.companyId, id: building.id } });
    await recordActivity(tx, context, { module: MODULE, entityType: BUILDING_ENTITY, entityId: building.id, action: "BUILDING_DELETED", message: `removed the building ${building.name}`, metadata: { projectId: building.projectId } });
    await recordUserAction(
      context,
      { actionKey: AuditAction.PROJECT_BUILDING_DELETED, entity: { type: BUILDING_ENTITY, id: building.id, label: building.name }, projectId: building.projectId, before: { buildingId: building.id, name: building.name, code: building.code } },
      { tx },
    );
  });
}

/** The whole order at once, naming every building once (§10). */
export async function reorderBuildings(context: UserContext, projectId: string, ids: string[]): Promise<void> {
  const project = await loadStructureProject(context, projectId);
  assertPermission(context, "project.structure.manage");

  await prisma.$transaction(async (tx) => {
    const rows = await tx.projectBuilding.findMany({ where: { companyId: context.companyId, projectId: project.id }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
    assertSameSet(rows.map((row) => row.id), ids);
    for (const [index, id] of ids.entries()) {
      await tx.projectBuilding.update({ where: { companyId: context.companyId, id }, data: { sortOrder: index + 1 } });
    }
    const names = new Map(rows.map((row) => [row.id, row.name]));
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_STRUCTURE_REORDERED,
        entity: { type: "project", id: project.id, label: project.name },
        projectId: project.id,
        before: { order: rows.map((row) => row.name) },
        after: { order: ids.map((id) => names.get(id)) },
        metadata: { level: "BUILDING" },
      },
      { tx },
    );
  });
}

export function assertSameSet(current: string[], ids: string[]) {
  const known = new Set(current);
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw fail("STRUCTURE_REORDER_MISMATCH", "The structure changed since you opened it. Refresh and try again.", "CONFLICT");
  }
}
