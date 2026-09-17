import { Prisma } from "@prisma/client";

import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import type { CreateUnitTypeInput, UpdateUnitTypeInput } from "./structure.schema";
import type { UnitTypeOption } from "./structure.types";

/**
 * A company's unit types (E-05B §20, §21, §116).
 *
 * The same shape as the project types beside it: the company keeps its own
 * list, starting from `config/unit-types.ts`, under `project.unit_type.manage`
 * — company configuration that no module ladder reaches. A type units use is
 * retired rather than deleted; its units keep it and new units cannot choose it.
 */

const MODULE = "projects" as const;

export type UnitTypeDTO = UnitTypeOption & { sortOrder: number; unitCount: number };

/** `APARTMENT` from "Apartment", `SHOP_UNIT` from "Shop unit" — when nobody typed a code. */
export function codeFromName(name: string): string {
  const code = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return code || "TYPE";
}

function taken(field: "name" | "code", value: string): AccessError {
  const message = field === "name" ? `There is already a unit type called "${value}".` : `Another unit type uses the code ${value}.`;
  return new AccessError("CONFLICT", message, { field, code: field === "name" ? "UNIT_TYPE_NAME_TAKEN" : "UNIT_TYPE_CODE_TAKEN" });
}

async function assertFree(companyId: string, values: { name: string; code: string }, exceptId?: string) {
  const clash = await prisma.projectUnitType.findFirst({
    where: {
      companyId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [{ name: { equals: values.name, mode: "insensitive" } }, { code: values.code }],
    },
    select: { name: true },
  });
  if (!clash) return;
  throw clash.name.toLowerCase() === values.name.toLowerCase() ? taken("name", values.name) : taken("code", values.code);
}

function translateWriteError(values: { name: string; code: string } | undefined) {
  return (error: unknown): never => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && values) {
      const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]) : [];
      throw target.includes("code") ? taken("code", values.code) : taken("name", values.name);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AccessError("CONFLICT", "Units use this type. Retire it instead.");
    }
    throw error;
  };
}

const SELECT = { id: true, name: true, code: true, category: true, isActive: true, sortOrder: true, _count: { select: { units: true } } } satisfies Prisma.ProjectUnitTypeSelect;

function toDTO(row: Prisma.ProjectUnitTypeGetPayload<{ select: typeof SELECT }>): UnitTypeDTO {
  return { id: row.id, name: row.name, code: row.code, category: row.category, isActive: row.isActive, sortOrder: row.sortOrder, unitCount: row._count.units };
}

export async function listUnitTypes(context: UserContext): Promise<UnitTypeDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "project.unit_type.manage");
  const rows = await prisma.projectUnitType.findMany({ where: { companyId: context.companyId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: SELECT });
  return rows.map(toDTO);
}

export async function createUnitType(context: UserContext, input: CreateUnitTypeInput): Promise<UnitTypeDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project.unit_type.manage");
  const values = { name: input.name, code: input.code || codeFromName(input.name) };
  await assertFree(context.companyId, values);

  return prisma
    .$transaction(async (tx) => {
      const last = await tx.projectUnitType.aggregate({ where: { companyId: context.companyId }, _max: { sortOrder: true } });
      const row = await tx.projectUnitType.create({
        data: { companyId: context.companyId, name: values.name, code: values.code, category: input.category, sortOrder: (last._max.sortOrder ?? 0) + 1, createdBy: context.userId },
        select: SELECT,
      });
      await recordUserAction(
        context,
        { actionKey: AuditAction.PROJECT_UNIT_TYPE_CREATED, entity: { type: "ProjectUnitType", id: row.id, label: row.name }, after: { name: row.name, code: row.code, category: row.category, isActive: row.isActive } },
        { tx },
      );
      return toDTO(row);
    })
    .catch(translateWriteError(values));
}

export async function updateUnitType(context: UserContext, typeId: string, input: UpdateUnitTypeInput): Promise<UnitTypeDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project.unit_type.manage");
  const existing = await prisma.projectUnitType.findFirst({ where: { companyId: context.companyId, id: typeId }, select: { id: true, name: true, code: true, category: true, isActive: true } });
  if (!existing) throw new AccessError("NOT_FOUND");

  const next = { name: input.name ?? existing.name, code: input.code || existing.code, category: input.category ?? existing.category, isActive: input.isActive ?? existing.isActive };
  if (next.name.toLowerCase() !== existing.name.toLowerCase() || next.code !== existing.code) await assertFree(context.companyId, next, existing.id);

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of ["name", "code", "category", "isActive"] as const) {
    if (next[key] !== existing[key]) {
      before[key] = existing[key];
      after[key] = next[key];
    }
  }

  return prisma
    .$transaction(async (tx) => {
      const row = await tx.projectUnitType.update({ where: { companyId: context.companyId, id: existing.id }, data: { ...next, updatedBy: context.userId }, select: SELECT });
      if (Object.keys(after).length) {
        await recordUserAction(context, { actionKey: AuditAction.PROJECT_UNIT_TYPE_UPDATED, entity: { type: "ProjectUnitType", id: row.id, label: row.name }, before, after }, { tx });
      }
      return toDTO(row);
    })
    .catch(translateWriteError(next));
}

export async function reorderUnitTypes(context: UserContext, ids: string[]): Promise<UnitTypeDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "project.unit_type.manage");
  const rows = await prisma.projectUnitType.findMany({ where: { companyId: context.companyId }, select: { id: true, name: true, sortOrder: true } });
  const known = new Set(rows.map((row) => row.id));
  if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new AccessError("VALIDATION_ERROR", "The list has changed since it was loaded. Reload it and try again.");
  }
  const names = new Map(rows.map((row) => [row.id, row.name]));
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.projectUnitType.update({ where: { companyId: context.companyId, id }, data: { sortOrder: index + 1, updatedBy: context.userId } });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_UNIT_TYPES_REORDERED,
        entity: { type: "company", id: context.companyId, label: "Unit types" },
        before: { order: [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.name) },
        after: { order: ids.map((id) => names.get(id)) },
      },
      { tx },
    );
  });
  return listUnitTypes(context);
}

/** Only a type no unit has; anything else is retired instead (§116). */
export async function deleteUnitType(context: UserContext, typeId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "project.unit_type.manage");
  await prisma
    .$transaction(async (tx) => {
      const existing = await tx.projectUnitType.findFirst({ where: { companyId: context.companyId, id: typeId }, select: { id: true, name: true, code: true, _count: { select: { units: true } } } });
      if (!existing) throw new AccessError("NOT_FOUND");
      const used = existing._count.units;
      if (used > 0) throw new AccessError("CONFLICT", `${used} ${used === 1 ? "unit uses" : "units use"} this type. Retire it instead.`);
      await tx.projectUnitType.delete({ where: { companyId: context.companyId, id: existing.id } });
      await recordUserAction(context, { actionKey: AuditAction.PROJECT_UNIT_TYPE_DELETED, entity: { type: "ProjectUnitType", id: existing.id, label: existing.name }, before: { name: existing.name, code: existing.code } }, { tx });
    })
    .catch(translateWriteError(undefined));
}
