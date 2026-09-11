import { Prisma, type DepartmentStatus } from "@prisma/client";

import { AccessError, assertFound, assertModule, assertPermission } from "@/lib/access/guards";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { recordActivity } from "@/lib/modules/shared/activity";
import {
  canTransitionDepartmentStatus,
  isDepartmentArchived,
} from "../membership.status";
import type { CreateDepartmentInput, UpdateDepartmentInput } from "../team.schema";
import type { DepartmentSummaryDTO } from "../team.types";

/**
 * Departments (PRD #14 §112–§129, §324, §327).
 *
 * A department is organisational metadata. Managing one grants nothing: access
 * still comes from role, permission and scope, so naming somebody department
 * manager never silently elevates them (PRD #14 §120, §121).
 */

const MODULE = "team" as const;
const ENTITY = "Department";

export async function listDepartments(
  context: UserContext,
  options: { includeArchived?: boolean } = {},
): Promise<DepartmentSummaryDTO[]> {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.view");

  const rows = await prisma.department.findMany({
    where: {
      companyId: context.companyId,
      ...(options.includeArchived ? {} : { status: { not: "ARCHIVED" }, archivedAt: null }),
    },
    select: {
      id: true,
      name: true,
      key: true,
      description: true,
      status: true,
      updatedAt: true,
      managerMember: {
        select: {
          id: true,
          status: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
      // Counted in the query rather than per row (PRD #14 §235).
      _count: { select: { members: { where: { status: "ACTIVE" } } } },
    },
    orderBy: { name: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    manager: row.managerMember
      ? {
          memberId: row.managerMember.id,
          fullName: `${row.managerMember.user.firstName} ${row.managerMember.user.lastName}`,
          // Surfaced rather than hidden, so a departed manager is visible
          // (PRD #14 §248).
          active: row.managerMember.status === "ACTIVE",
        }
      : null,
    activeMembers: row._count.members,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getDepartment(context: UserContext, departmentId: string) {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.view");

  const department = assertFound(
    await prisma.department.findFirst({
      where: { id: departmentId, companyId: context.companyId },
      select: {
        id: true,
        name: true,
        key: true,
        description: true,
        status: true,
        preArchiveStatus: true,
        archivedAt: true,
        updatedAt: true,
        managerMemberId: true,
        managerMember: {
          select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
        },
        _count: { select: { members: { where: { status: "ACTIVE" } } } },
      },
    }),
  );

  return department;
}

export async function createDepartment(
  context: UserContext,
  input: CreateDepartmentInput,
): Promise<string> {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.create");

  const managerMemberId = await validateManager(context, input.managerMemberId);

  const created = await prisma
    .$transaction(async (tx) => {
      const department = await tx.department.create({
        data: {
          companyId: context.companyId,
          name: input.name,
          key: input.key ?? null,
          description: input.description ?? null,
          managerMemberId,
          status: input.status as DepartmentStatus,
          createdBy: context.userId,
        },
        select: { id: true },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: department.id,
        action: "DEPARTMENT_CREATED",
        message: `created the ${input.name} department`,
        metadata: { departmentId: department.id } as Prisma.InputJsonValue,
      });

      return department;
    })
    .catch(translateWriteError);

  return created.id;
}

export async function updateDepartment(
  context: UserContext,
  departmentId: string,
  input: UpdateDepartmentInput,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.update");

  const existing = await getDepartment(context, departmentId);

  if (isDepartmentArchived(existing)) {
    throw new AccessError("CONFLICT", "Restore this department before editing it.");
  }
  if (input.versionUpdatedAt && existing.updatedAt.getTime() !== input.versionUpdatedAt.getTime()) {
    throw new AccessError(
      "CONFLICT",
      "This department was updated by another user. Refresh and review the latest changes.",
    );
  }

  const nextStatus = input.status as DepartmentStatus;
  if (!canTransitionDepartmentStatus(existing.status, nextStatus)) {
    throw new AccessError(
      "VALIDATION_ERROR",
      `A department cannot move from ${existing.status} to ${nextStatus}.`,
    );
  }

  const managerMemberId = await validateManager(context, input.managerMemberId);
  const managerChanged = managerMemberId !== existing.managerMemberId;

  await prisma
    .$transaction(async (tx) => {
      await tx.department.update({
        where: { id: departmentId },
        data: {
          name: input.name,
          key: input.key ?? null,
          description: input.description ?? null,
          managerMemberId,
          status: nextStatus,
          updatedBy: context.userId,
        },
      });

      await recordActivity(tx, context, {
        module: MODULE,
        entityType: ENTITY,
        entityId: departmentId,
        action: "DEPARTMENT_UPDATED",
        message: `updated the ${input.name} department`,
        metadata: { departmentId } as Prisma.InputJsonValue,
      });

      if (managerChanged) {
        await recordActivity(tx, context, {
          module: MODULE,
          entityType: ENTITY,
          entityId: departmentId,
          action: "DEPARTMENT_MANAGER_CHANGED",
          message: "changed the department manager",
          metadata: { departmentId, managerMemberId } as Prisma.InputJsonValue,
        });
      }
    })
    .catch(translateWriteError);
}

export async function archiveDepartment(
  context: UserContext,
  departmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.archive");

  const existing = await getDepartment(context, departmentId);
  if (isDepartmentArchived(existing)) {
    throw new AccessError("CONFLICT", "This department is already archived.");
  }

  // Archiving a department that still holds people would leave them assigned
  // to something that no longer exists (PRD #14 §123, §124).
  if (existing._count.members > 0) {
    throw new AccessError(
      "CONFLICT",
      `This department still has ${existing._count.members} active member${
        existing._count.members === 1 ? "" : "s"
      }. Move them to another department before archiving it.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.department.update({
      where: { id: departmentId },
      data: {
        preArchiveStatus: existing.status,
        status: "ARCHIVED",
        archivedAt: new Date(),
        archivedBy: context.userId,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: departmentId,
      action: "DEPARTMENT_ARCHIVED",
      message: `archived the ${existing.name} department`,
      metadata: { departmentId } as Prisma.InputJsonValue,
    });
  });
}

export async function restoreDepartment(
  context: UserContext,
  departmentId: string,
): Promise<void> {
  assertModule(context, MODULE);
  assertPermission(context, "team.department.restore");

  const existing = await getDepartment(context, departmentId);
  if (!isDepartmentArchived(existing)) {
    throw new AccessError("CONFLICT", "This department is not archived.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.department.update({
      where: { id: departmentId },
      data: {
        status: existing.preArchiveStatus ?? "ACTIVE",
        preArchiveStatus: null,
        archivedAt: null,
        archivedBy: null,
        updatedBy: context.userId,
      },
    });

    await recordActivity(tx, context, {
      module: MODULE,
      entityType: ENTITY,
      entityId: departmentId,
      action: "DEPARTMENT_RESTORED",
      message: `restored the ${existing.name} department`,
      metadata: { departmentId } as Prisma.InputJsonValue,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

async function validateManager(
  context: UserContext,
  managerMemberId: string | undefined,
): Promise<string | null> {
  if (!managerMemberId) return null;

  const member = await prisma.companyMember.findFirst({
    where: { id: managerMemberId, companyId: context.companyId },
    select: { id: true, status: true },
  });
  if (!member) throw new AccessError("VALIDATION_ERROR", "That team member does not exist.");
  if (member.status !== "ACTIVE") {
    throw new AccessError("VALIDATION_ERROR", "That team member is not active.");
  }
  return member.id;
}

function translateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = String(error.meta?.target ?? "");
    throw new AccessError(
      "CONFLICT",
      target.includes("key")
        ? "That department key is already used in your company."
        : "That department name is already used in your company.",
    );
  }
  throw error;
}
