import { Prisma } from "@prisma/client";

import { CUSTOM_DEPARTMENT_KEY_PREFIX } from "@/config/group-departments";
import { AccessError } from "@/lib/access/guards";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { prisma } from "@/lib/database/prisma";
import { closeBranch, openBranch, renameBranches } from "@/lib/modules/team/departments/branch.doors";

import { actorUserId, auditDepartment, authorizeConfiguration, groupOf, type DepartmentActor } from "./department.actor";
import { assertOpen, loadCompany, loadGroupDepartment } from "./department.lookup";
import type { CreateDepartmentInput, UpdateDepartmentInput } from "./department.schema";

/**
 * The group's departments as configuration (E-13 §8-§19, §40-§42, §77, §78,
 * §140, §141): defined once for the group, activated per company, deactivated
 * and reactivated without losing anything.
 *
 * The Owner and Group IT configure (§53), and the Platform Admin while the group
 * is being implemented (§50). Nobody deletes a department or a branch: history
 * stays (§9, §18).
 */

const ENTITY = "GroupDepartment";

function conflictOnDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = String(error.meta?.target ?? "");
    if (target.includes("code")) throw new AccessError("CONFLICT", "Department code already exists.", { field: "code", code: "CODE_TAKEN" });
    if (target.includes("name")) throw new AccessError("CONFLICT", "A department with that name already exists.", { field: "name", code: "NAME_TAKEN" });
    throw new AccessError("CONFLICT", "That department changed at the same moment. Refresh and try again.");
  }
  throw error;
}

async function assertUnique(tx: Prisma.TransactionClient, parentGroupId: string, input: { code?: string; name?: string }, exceptId?: string): Promise<void> {
  const not = exceptId ? { id: { not: exceptId } } : {};
  if (input.code && (await tx.groupDepartment.count({ where: { parentGroupId, code: input.code, ...not } })) > 0) {
    throw new AccessError("CONFLICT", "Department code already exists.", { field: "code", code: "CODE_TAKEN" });
  }
  if (input.name && (await tx.groupDepartment.count({ where: { parentGroupId, name: { equals: input.name, mode: "insensitive" }, ...not } })) > 0) {
    throw new AccessError("CONFLICT", "A department with that name already exists.", { field: "name", code: "NAME_TAKEN" });
  }
}

/** A key nobody else in the group has, and never one of the chart's (ADR 0003). */
async function customKey(tx: Prisma.TransactionClient, parentGroupId: string, code: string): Promise<string> {
  const base = `${CUSTOM_DEPARTMENT_KEY_PREFIX}${code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  for (let suffix = 1; ; suffix += 1) {
    const key = suffix === 1 ? base : `${base}-${suffix}`;
    if ((await tx.groupDepartment.count({ where: { parentGroupId, key } })) === 0) return key;
  }
}

/** A new group department (E-13 §40, §77, §113). */
export async function createGroupDepartment(actor: DepartmentActor, input: CreateDepartmentInput): Promise<{ id: string }> {
  const acting = await authorizeConfiguration(actor);
  const parentGroupId = groupOf(actor);
  return prisma
    .$transaction(async (tx) => {
      await assertUnique(tx, parentGroupId, { code: input.code, name: input.name });
      const department = await tx.groupDepartment.create({
        data: {
          parentGroupId,
          key: await customKey(tx, parentGroupId, input.code),
          code: input.code,
          name: input.name,
          description: input.description,
          status: input.status,
          createdByUserId: actorUserId(actor),
        },
        select: { id: true },
      });
      await auditDepartment(tx, actor, acting, {
        actionKey: AuditAction.ORGANIZATION_GROUP_DEPARTMENT_CREATED,
        entity: { type: ENTITY, id: department.id, label: input.name },
        after: { groupDepartmentId: department.id, code: input.code, name: input.name, description: input.description, status: input.status },
      });
      return department;
    })
    .catch(conflictOnDuplicate);
}

/**
 * Renaming, recoding or describing a department (E-13 §34). A rename reaches
 * every company's branch, which carries the group's name.
 */
export async function updateGroupDepartment(actor: DepartmentActor, groupDepartmentId: string, input: UpdateDepartmentInput): Promise<void> {
  const acting = await authorizeConfiguration(actor);
  const parentGroupId = groupOf(actor);
  const existing = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  const next = {
    code: input.code ?? existing.code,
    name: input.name ?? existing.name,
    description: input.description === undefined ? existing.description : input.description,
  };
  if (next.code === existing.code && next.name === existing.name && next.description === existing.description) return;

  await prisma
    .$transaction(async (tx) => {
      await assertUnique(tx, parentGroupId, { code: next.code !== existing.code ? next.code : undefined, name: next.name !== existing.name ? next.name : undefined }, existing.id);
      await tx.groupDepartment.updateMany({ where: { id: existing.id, parentGroupId }, data: { code: next.code, name: next.name, description: next.description } });
      if (next.name !== existing.name) await renameBranches(tx, { groupDepartmentId: existing.id, name: next.name, actorUserId: actorUserId(actor) });
      await auditDepartment(tx, actor, acting, {
        actionKey: AuditAction.ORGANIZATION_GROUP_DEPARTMENT_UPDATED,
        entity: { type: ENTITY, id: existing.id, label: next.name },
        before: { groupDepartmentId: existing.id, code: existing.code, name: existing.name, description: existing.description },
        after: { groupDepartmentId: existing.id, ...next },
      });
    })
    .catch(conflictOnDuplicate);
}

/**
 * Deactivating or reactivating a group department (E-13 §90, §140). Inactive,
 * it takes no new company, member or head, and its positions widen nothing;
 * its branches, people and history stay exactly as they were, so reactivating
 * brings them back.
 */
export async function setGroupDepartmentStatus(actor: DepartmentActor, groupDepartmentId: string, status: "ACTIVE" | "INACTIVE"): Promise<void> {
  const acting = await authorizeConfiguration(actor);
  const parentGroupId = groupOf(actor);
  const existing = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  const current = existing.status === "ACTIVE" ? "ACTIVE" : "INACTIVE";
  if (current === status) {
    throw new AccessError("CONFLICT", status === "ACTIVE" ? `${existing.name} is already active.` : `${existing.name} is already inactive.`, { code: "STATE_UNCHANGED" });
  }
  await prisma.$transaction(async (tx) => {
    const moved = await tx.groupDepartment.updateMany({ where: { id: existing.id, parentGroupId, status: existing.status }, data: { status } });
    if (moved.count === 0) throw new AccessError("CONFLICT", "That department changed at the same moment. Refresh and try again.");
    await auditDepartment(tx, actor, acting, {
      actionKey: status === "ACTIVE" ? AuditAction.ORGANIZATION_GROUP_DEPARTMENT_REACTIVATED : AuditAction.ORGANIZATION_GROUP_DEPARTMENT_DEACTIVATED,
      entity: { type: ENTITY, id: existing.id, label: existing.name },
      before: { groupDepartmentId: existing.id, status: current },
      after: { groupDepartmentId: existing.id, status },
    });
  });
}

export type BranchResultDTO = { companyDepartmentId: string; companyId: string; changed: boolean };

/**
 * Activates a department in companies of the group (E-13 §17, §41, §42, §78,
 * §114, §137): each company's branch is created, or reopened as the same
 * branch. A company where it is already active is left as it is. All or
 * nothing: one company out of reach refuses the whole request.
 */
export async function activateInCompanies(actor: DepartmentActor, groupDepartmentId: string, companyIds: readonly string[], options: { requireExisting?: boolean } = {}): Promise<BranchResultDTO[]> {
  const parentGroupId = groupOf(actor);
  const unique = [...new Set(companyIds)];
  const department = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  const targets: Array<{ company: Awaited<ReturnType<typeof loadCompany>>; acting: Awaited<ReturnType<typeof authorizeConfiguration>> }> = [];
  for (const companyId of unique) {
    // The company first: one outside the group is not found, whoever asks (§81, §107).
    const company = await loadCompany(prisma, parentGroupId, companyId);
    targets.push({ company, acting: await authorizeConfiguration(actor, company.id) });
  }
  assertOpen(department);
  for (const { company } of targets) {
    if (company.status !== "ACTIVE") throw new AccessError("CONFLICT", `${company.name} is not an active company.`, { code: "COMPANY_INACTIVE" });
  }

  return prisma.$transaction(async (tx) => {
    const results: BranchResultDTO[] = [];
    for (const { company, acting } of targets) {
      if (options.requireExisting && (await tx.department.count({ where: { companyId: company.id, groupDepartmentId: department.id } })) === 0) {
        throw new AccessError("NOT_FOUND", `${department.name} has never been active in ${company.name}. Activate it instead.`);
      }
      const branch = await openBranch(tx, { companyId: company.id, groupDepartment: department, actorUserId: actorUserId(actor) });
      const changed = branch.previousStatus !== "ACTIVE";
      if (changed) {
        await auditDepartment(tx, actor, acting, {
          actionKey: branch.created ? AuditAction.ORGANIZATION_COMPANY_DEPARTMENT_ACTIVATED : AuditAction.ORGANIZATION_COMPANY_DEPARTMENT_REACTIVATED,
          entity: { type: ENTITY, id: department.id, label: department.name },
          before: branch.created ? undefined : { groupDepartmentId: department.id, companyId: company.id, companyDepartmentId: branch.id, status: "INACTIVE" },
          after: { groupDepartmentId: department.id, companyId: company.id, companyName: company.name, companyDepartmentId: branch.id, status: "ACTIVE" },
        });
      }
      results.push({ companyDepartmentId: branch.id, companyId: company.id, changed });
    }
    return results;
  });
}

/**
 * Deactivates a department in one company (E-13 §18): the branch stays, with
 * its members, its manager and every reference to it; it takes nobody new until
 * it is reactivated.
 */
export async function deactivateInCompany(actor: DepartmentActor, groupDepartmentId: string, companyId: string): Promise<BranchResultDTO> {
  const parentGroupId = groupOf(actor);
  const department = await loadGroupDepartment(prisma, parentGroupId, groupDepartmentId);
  const company = await loadCompany(prisma, parentGroupId, companyId);
  const acting = await authorizeConfiguration(actor, company.id);
  const branch = await prisma.department.findFirst({ where: { companyId: company.id, groupDepartmentId: department.id }, select: { id: true, status: true } });
  if (!branch || branch.status !== "ACTIVE") {
    throw new AccessError("CONFLICT", `${department.name} is not active in ${company.name}.`, { code: "BRANCH_INACTIVE" });
  }

  return prisma.$transaction(async (tx) => {
    const closed = await closeBranch(tx, { departmentId: branch.id, companyId: company.id, actorUserId: actorUserId(actor) });
    if (!closed) throw new AccessError("CONFLICT", "That branch changed at the same moment. Refresh and try again.");
    const memberCount = await tx.departmentAssignment.count({ where: { companyDepartmentId: branch.id, status: "ACTIVE" } });
    await auditDepartment(tx, actor, acting, {
      actionKey: AuditAction.ORGANIZATION_COMPANY_DEPARTMENT_DEACTIVATED,
      entity: { type: ENTITY, id: department.id, label: department.name },
      before: { groupDepartmentId: department.id, companyId: company.id, companyDepartmentId: branch.id, status: "ACTIVE" },
      after: { groupDepartmentId: department.id, companyId: company.id, companyName: company.name, companyDepartmentId: branch.id, status: "INACTIVE", memberCount },
    });
    return { companyDepartmentId: branch.id, companyId: company.id, changed: true };
  });
}
