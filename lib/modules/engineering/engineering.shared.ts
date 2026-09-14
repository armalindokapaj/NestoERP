import { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { AccessError } from "@/lib/access/guards";
import { allocateNumber } from "@/lib/core/numbering/numbering.service";
import { prisma } from "@/lib/database/prisma";
import { daysBetween } from "@/lib/modules/calendar/calendar.time";
import { businessInstant, dateLabel, dateOf } from "@/lib/modules/project-planning/planning.dates";
import type { Option, PersonRef } from "./engineering.types";

/**
 * What contractors, work packages and engineering share (PRD #46 §38, §223,
 * §224, §242-§246, §281, §282): one error shape, one way to name people, the
 * project door, same-company and same-project checks for every link, and
 * human-readable numbers.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export { businessInstant, dateLabel, dateOf };

export type FailStatus = "VALIDATION_ERROR" | "CONFLICT" | "NOT_FOUND" | "FORBIDDEN";

export function fail(code: string, message: string, status: FailStatus = "VALIDATION_ERROR", extra: Record<string, unknown> = {}): AccessError {
  return new AccessError(status, message, { code, ...extra });
}

export const at = (date: string | null | undefined) => (date ? businessInstant(date) : null);

export function isOverdue(due: Date | null, today: string): boolean {
  const date = dateOf(due);
  return date !== null && date < today;
}

export function ageInDays(from: Date, today: string): number {
  return Math.max(0, daysBetween(from.toISOString().slice(0, 10), today));
}

export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (!field) return true;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes(field) : typeof target === "string" ? target.includes(field) : true;
}

/* Projects ----------------------------------------------------------------- */

export const PROJECT_SELECT = { id: true, companyId: true, name: true, code: true, status: true, archivedAt: true, projectManagerMemberId: true } satisfies Prisma.ProjectSelect;
export type ProjectRef = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

export function projectArchived(project: { archivedAt: Date | null; status: string }): boolean {
  return Boolean(project.archivedAt) || project.status === "ARCHIVED";
}

/** An archived project's contractor and engineering records are history (§272). */
export function assertProjectWritable(project: { archivedAt: Date | null; status: string }) {
  if (projectArchived(project)) throw fail("ENGINEERING_PROJECT_ARCHIVED", "This project is archived, so its records are read-only.", "CONFLICT");
}

export async function loadProjectThrough(door: Prisma.ProjectWhereInput | null, projectId: string, forbidden: string): Promise<ProjectRef> {
  if (!door) throw new AccessError("FORBIDDEN", forbidden);
  const project = await prisma.project.findFirst({ where: { AND: [door, { id: projectId }] }, select: PROJECT_SELECT });
  if (!project) throw fail("ENGINEERING_PROJECT_NOT_FOUND", "That project could not be found.", "NOT_FOUND");
  return project;
}

/* People ------------------------------------------------------------------- */

export async function people(companyId: string, ids: Array<string | null | undefined>): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const rows = await prisma.companyMember.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, user: { select: { firstName: true, lastName: true } } } });
  return new Map(rows.map((row) => [row.id, { id: row.id, name: `${row.user.firstName} ${row.user.lastName}`.trim() }]));
}

export const personOf = (map: Map<string, PersonRef>, id: string | null | undefined): PersonRef | null => (id ? (map.get(id) ?? null) : null);

/** Active members of this company who can reach the project and hold the grant (§88, §104). */
function responsibleWhere(companyId: string, projectId: string, permission: Permission): Prisma.CompanyMemberWhereInput {
  return {
    companyId,
    status: "ACTIVE",
    role: { permissions: { some: { permission: { key: permission } } } },
    OR: [
      { projectMemberships: { some: { projectId, status: "ACTIVE" } } },
      { managedProjects: { some: { id: projectId } } },
      { role: { moduleAccess: { some: { module: { key: "projects" }, scope: { in: ["COMPANY", "SYSTEM", "DEPARTMENT"] } } } } },
    ],
  };
}

export async function assertResponsible(companyId: string, projectId: string, memberId: string | null | undefined, permission: Permission, field: string) {
  if (!memberId) return;
  const found = await prisma.companyMember.count({ where: { id: memberId, ...responsibleWhere(companyId, projectId, permission) } });
  if (!found) throw fail("ENGINEERING_MEMBER_INVALID", "That person cannot take this on this project.", "VALIDATION_ERROR", { field });
}

export async function memberOptions(companyId: string, projectId: string, permission: Permission): Promise<Option[]> {
  const rows = await prisma.companyMember.findMany({
    where: responsibleWhere(companyId, projectId, permission),
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: 300,
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({ id: row.id, label: `${row.user.firstName} ${row.user.lastName}`.trim() }));
}

/** Every active member holding a permission — for company-level recipients such as compliance owners. */
export async function holders(db: Db, companyId: string, permission: Permission): Promise<string[]> {
  const rows = await db.companyMember.findMany({ where: { companyId, status: "ACTIVE", role: { permissions: { some: { permission: { key: permission } } } } }, select: { id: true } });
  return rows.map((row) => row.id);
}

/* Contractor and work package context -------------------------------------- */

/**
 * The contractor and work package a project record names, checked against the
 * project (§38, §224, §243, §246). A work package from another project, a
 * contractor who was never assigned here, or one whose assignment has ended
 * (for new work) is refused; a work package lends its contractor when none is
 * given, and may not contradict one that is.
 */
export async function resolveProjectContext(
  companyId: string,
  projectId: string,
  input: { contractorId: string | null; workPackageId: string | null },
  options: { newWork: boolean },
): Promise<{ contractorId: string | null; workPackageId: string | null }> {
  let contractorId = input.contractorId;
  if (input.workPackageId) {
    const workPackage = await prisma.workPackage.findFirst({ where: { id: input.workPackageId, companyId }, select: { id: true, projectId: true, contractorId: true, archivedAt: true, status: true } });
    if (!workPackage) throw fail("ENGINEERING_WORK_PACKAGE_INVALID", "That work package could not be found.", "VALIDATION_ERROR", { field: "workPackageId" });
    if (workPackage.projectId !== projectId) throw fail("ENGINEERING_WORK_PACKAGE_PROJECT_MISMATCH", "That work package belongs to another project.", "VALIDATION_ERROR", { field: "workPackageId" });
    if (options.newWork && (workPackage.archivedAt || workPackage.status === "CANCELLED")) throw fail("ENGINEERING_WORK_PACKAGE_CLOSED", "That work package is closed to new work.", "VALIDATION_ERROR", { field: "workPackageId" });
    if (workPackage.contractorId && contractorId && workPackage.contractorId !== contractorId) throw fail("ENGINEERING_CONTRACTOR_MISMATCH", "That work package belongs to a different contractor.", "VALIDATION_ERROR", { field: "contractorId" });
    contractorId = contractorId ?? workPackage.contractorId;
  }
  if (contractorId) {
    const contractor = await prisma.contractorProfile.findFirst({ where: { id: contractorId, companyId }, select: { id: true, status: true, projectAssignments: { where: { projectId }, select: { status: true } } } });
    if (!contractor) throw fail("ENGINEERING_CONTRACTOR_INVALID", "That contractor could not be found.", "VALIDATION_ERROR", { field: "contractorId" });
    const assignment = contractor.projectAssignments[0];
    if (!assignment) throw fail("ENGINEERING_CONTRACTOR_NOT_ASSIGNED", "That contractor is not assigned to this project.", "VALIDATION_ERROR", { field: "contractorId" });
    if (options.newWork && assignment.status === "TERMINATED") throw fail("ENGINEERING_ASSIGNMENT_TERMINATED", "That contractor's assignment on this project has been terminated.", "VALIDATION_ERROR", { field: "contractorId" });
    if (options.newWork && (contractor.status === "ARCHIVED" || contractor.status === "OFFBOARDED")) throw fail("ENGINEERING_CONTRACTOR_INACTIVE", "That contractor is no longer active.", "VALIDATION_ERROR", { field: "contractorId" });
  }
  return { contractorId, workPackageId: input.workPackageId };
}

/* Numbering ---------------------------------------------------------------- */

/**
 * The next human number for a project record (§281, §282): the company's
 * numbering scheme when it is automatic, else the number the writer typed,
 * else the project's own sequence — RFI-001, SUB-001, TRN-001, WP-001.
 */
export async function projectNumber(
  tx: Tx,
  input: {
    companyId: string;
    moduleKey: string;
    entityType: string;
    prefix: string;
    manual: string | null;
    count(): Promise<number>;
    taken(candidate: string): Promise<boolean>;
  },
): Promise<string> {
  const auto = await allocateNumber({ companyId: input.companyId, moduleKey: input.moduleKey, entityType: input.entityType }, { tx });
  if (auto) return auto;
  if (input.manual) return input.manual;
  let next = (await input.count()) + 1;
  for (let attempt = 0; attempt < 50; attempt += 1, next += 1) {
    const candidate = `${input.prefix}-${String(next).padStart(3, "0")}`;
    if (!(await input.taken(candidate))) return candidate;
  }
  return `${input.prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/** Retries a create whose generated number lost a race; a typed number that is taken is the writer's to change. */
export async function withNumber<T>(field: string, manual: string | null, conflict: { code: string; message: string }, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isUniqueViolation(error, field)) throw error;
      if (manual || attempt >= 3) throw fail(conflict.code, conflict.message, "CONFLICT", { field });
    }
  }
}
