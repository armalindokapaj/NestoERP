import { Prisma } from "@prisma/client";

import { AccessError, assertModule, assertPermission, invalidRecordLink } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { prisma } from "@/lib/database/prisma";
import type { CreateProjectTypeInput, UpdateProjectTypeInput } from "./project.schema";
import type { ProjectTypeDTO } from "./project.types";

/**
 * A company's project types (E-05A §30, §62).
 *
 * Each company keeps its own list — the defaults in `config/project-types.ts`
 * are only where it starts — so a type is always read and written inside the
 * company it belongs to. Keeping the list is `project.type.manage`, which no
 * role reaches through the module ladder: it is company configuration, not
 * project work, and the Owner and Admin hold it explicitly.
 *
 * A type a project uses is retired rather than deleted. Retired types are not
 * offered for new projects, but a project that has one keeps it, and its edit
 * form keeps offering it, so saving other details never strips the type.
 */

const MODULE = "projects" as const;

function nameTaken(name: string): AccessError {
  const message = `There is already a project type called "${name}".`;
  return new AccessError("CONFLICT", message, { name: [message] });
}

/** Names are unique per company whatever their case: "hotel" and "Hotel" are one type. */
async function assertNameFree(companyId: string, name: string, exceptId?: string) {
  const clash = await prisma.projectType.findFirst({
    where: { companyId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw nameTaken(name);
}

function translateWriteError(name: string | undefined) {
  return (error: unknown): never => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && name) throw nameTaken(name);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AccessError("CONFLICT", "Projects use this type. Retire it instead.");
    }
    throw error;
  };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The whole list with how many projects use each type, for the people who keep it. */
export async function listProjectTypes(context: UserContext): Promise<ProjectTypeDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "project.type.manage");

  const rows = await prisma.projectType.findMany({
    where: { companyId: context.companyId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true, sortOrder: true, _count: { select: { projects: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive, sortOrder: row.sortOrder, projectCount: row._count.projects }));
}

/**
 * The types a project form may offer in this company: those in use, plus the
 * project's own type when it has since been retired (E-05A §13).
 */
export async function projectTypeChoices(context: UserContext, currentTypeId?: string | null): Promise<Array<{ value: string; label: string }>> {
  const rows = await prisma.projectType.findMany({
    where: { companyId: context.companyId, OR: [{ isActive: true }, ...(currentTypeId ? [{ id: currentTypeId }] : [])] },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true },
  });
  return rows.map((row) => ({ value: row.id, label: row.isActive ? row.name : `${row.name} (retired)` }));
}

/**
 * The type a project may be given: one of this company's, and in use — or the
 * one the project already has. Anything else answers like any other link the
 * person cannot use, naming the field and nothing about the record.
 */
export async function requireProjectTypeChoice(
  context: UserContext,
  typeId: string | null | undefined,
  currentTypeId: string | null = null,
): Promise<string | null> {
  if (!typeId) return null;
  if (typeId === currentTypeId) return typeId;
  const type = await prisma.projectType.findFirst({
    where: { id: typeId, companyId: context.companyId, isActive: true },
    select: { id: true },
  });
  if (!type) throw invalidRecordLink("projectTypeId", "CROSS_COMPANY_REFERENCE", "Choose one of this company's project types.");
  return type.id;
}

/* -------------------------------------------------------------------------- */
/* Keeping the list                                                            */
/* -------------------------------------------------------------------------- */

export async function createProjectType(context: UserContext, input: CreateProjectTypeInput): Promise<ProjectTypeDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project.type.manage");
  await assertNameFree(context.companyId, input.name);

  const created = await prisma
    .$transaction(async (tx) => {
      const last = await tx.projectType.aggregate({ where: { companyId: context.companyId }, _max: { sortOrder: true } });
      const row = await tx.projectType.create({
        data: { companyId: context.companyId, name: input.name, sortOrder: (last._max.sortOrder ?? 0) + 1, createdBy: context.userId },
        select: { id: true, name: true, isActive: true, sortOrder: true },
      });
      await recordUserAction(
        context,
        { actionKey: AuditAction.PROJECT_TYPE_CREATED, entity: { type: "ProjectType", id: row.id, label: row.name }, after: { name: row.name, isActive: row.isActive } },
        { tx },
      );
      return row;
    })
    .catch(translateWriteError(input.name));

  return { ...created, projectCount: 0 };
}

export async function updateProjectType(context: UserContext, typeId: string, input: UpdateProjectTypeInput): Promise<ProjectTypeDTO> {
  assertModule(context, MODULE);
  assertPermission(context, "project.type.manage");

  const existing = await prisma.projectType.findFirst({
    where: { id: typeId, companyId: context.companyId },
    select: { id: true, name: true, isActive: true },
  });
  if (!existing) throw new AccessError("NOT_FOUND");

  const name = input.name ?? existing.name;
  const isActive = input.isActive ?? existing.isActive;
  if (name.toLowerCase() !== existing.name.toLowerCase()) await assertNameFree(context.companyId, name, typeId);

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (name !== existing.name) {
    before.name = existing.name;
    after.name = name;
  }
  if (isActive !== existing.isActive) {
    before.isActive = existing.isActive;
    after.isActive = isActive;
  }

  const updated = await prisma
    .$transaction(async (tx) => {
      const row = await tx.projectType.update({
        where: { companyId: context.companyId, id: typeId },
        data: { name, isActive, updatedBy: context.userId },
        select: { id: true, name: true, isActive: true, sortOrder: true, _count: { select: { projects: true } } },
      });
      if (Object.keys(after).length > 0) {
        await recordUserAction(
          context,
          { actionKey: AuditAction.PROJECT_TYPE_UPDATED, entity: { type: "ProjectType", id: row.id, label: row.name }, before, after },
          { tx },
        );
      }
      return row;
    })
    .catch(translateWriteError(name));

  return { id: updated.id, name: updated.name, isActive: updated.isActive, sortOrder: updated.sortOrder, projectCount: updated._count.projects };
}

/**
 * The order the list and every project form show the types in. The request
 * names every type the company has, once — a partial or foreign list is
 * refused rather than guessed at.
 */
export async function reorderProjectTypes(context: UserContext, ids: string[]): Promise<ProjectTypeDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "project.type.manage");

  const rows = await prisma.projectType.findMany({ where: { companyId: context.companyId }, select: { id: true, name: true, sortOrder: true } });
  const known = new Set(rows.map((row) => row.id));
  if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new AccessError("VALIDATION_ERROR", "The list has changed since it was loaded. Reload it and try again.");
  }

  const names = new Map(rows.map((row) => [row.id, row.name]));
  await prisma.$transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.projectType.update({ where: { companyId: context.companyId, id }, data: { sortOrder: index + 1, updatedBy: context.userId } });
    }
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.PROJECT_TYPES_REORDERED,
        entity: { type: "company", id: context.companyId, label: "Project types" },
        before: { order: [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.name) },
        after: { order: ids.map((id) => names.get(id)) },
      },
      { tx },
    );
  });

  return listProjectTypes(context);
}

/** Only a type no project has ever been given; anything else is retired instead. */
export async function deleteProjectType(context: UserContext, typeId: string): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "project.type.manage");

  await prisma
    .$transaction(async (tx) => {
      const existing = await tx.projectType.findFirst({
        where: { id: typeId, companyId: context.companyId },
        select: { id: true, name: true, _count: { select: { projects: true } } },
      });
      if (!existing) throw new AccessError("NOT_FOUND");
      const used = existing._count.projects;
      if (used > 0) {
        throw new AccessError("CONFLICT", `${used} ${used === 1 ? "project uses" : "projects use"} this type. Retire it instead.`);
      }
      await tx.projectType.delete({ where: { companyId: context.companyId, id: typeId } });
      await recordUserAction(
        context,
        { actionKey: AuditAction.PROJECT_TYPE_DELETED, entity: { type: "ProjectType", id: existing.id, label: existing.name }, before: { name: existing.name } },
        { tx },
      );
    })
    .catch(translateWriteError(undefined));
}
