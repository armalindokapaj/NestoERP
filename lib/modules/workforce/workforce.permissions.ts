import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can, canAccessModule, getModuleScope, isModuleEnabled } from "@/lib/access/can";
import { AccessError, assertModule } from "@/lib/access/guards";
import { buildProjectLinkedScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";
import { dbDay, todayDay, type Day } from "@/lib/modules/hr/employment/employment.dates";

/**
 * Who reaches which workers, crews and assignments (E-04 §146-§152).
 *
 * Company + the Workforce module + a workforce permission + scope. A reader
 * with company scope sees the company's whole workforce; one with project scope
 * (a project manager, a site engineer) sees the crews on their projects and
 * the people working on them — assigned there, or in a crew that is — and
 * nobody else (§150). Managing follows the same line: a project manager assigns
 * people to their own projects, not to somebody else's. A worker without a
 * login is never a reader here: permissions belong to logins (§149).
 */

export const MODULE = "workforce" as const;

export const NOTHING = { id: { in: [] as string[] } };

export function workforceOpen(context: UserContext): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, "workforce.view");
}

export function assertWorkforce(context: UserContext, permission: Permission = "workforce.view"): void {
  assertModule(context, MODULE);
  if (!can(context, "workforce.view") || !can(context, permission)) throw new AccessError("FORBIDDEN");
}

/** Company scope, or anything wider: the whole company's workforce. */
export function seesWholeCompany(context: UserContext): boolean {
  const scope = getModuleScope(context, MODULE);
  return scope === "COMPANY" || scope === "GROUP" || scope === "SYSTEM" || scope === "DEPARTMENT";
}

/** Projects whose workforce this reader reaches. */
export function workforceProjectWhere(context: UserContext): Prisma.ProjectWhereInput {
  const linked = buildProjectLinkedScopeWhere(context, MODULE);
  return { companyId: context.companyId, ...(linked.project ?? {}) };
}

/** A period (inclusive, open end) that covers `day`. */
export function coversDay(day: Day = todayDay()): { startDate: { lte: Date }; OR: Array<{ endDate: null } | { endDate: { gte: Date } }> } {
  const date = dbDay(day);
  return { startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] };
}

/** A period that has not ended yet: today's, or one due to start. */
export function notEnded(day: Day = todayDay()): { OR: Array<{ endDate: null } | { endDate: { gte: Date } }> } {
  return { OR: [{ endDate: null }, { endDate: { gte: dbDay(day) } }] };
}

/** Workers this reader may see (§150): the company's, or those working on the reader's projects. */
export function readableWorkerWhere(context: UserContext): Prisma.EmployeeProfileWhereInput {
  if (!workforceOpen(context)) return NOTHING;
  if (seesWholeCompany(context)) return { companyId: context.companyId };
  const projects = workforceProjectWhere(context);
  return {
    companyId: context.companyId,
    OR: [
      { projectAssignments: { some: { ...notEnded(), project: projects } } },
      { crewMemberships: { some: { ...notEnded(), crew: { project: { is: projects } } } } },
    ],
  };
}

export function readableCrewWhere(context: UserContext): Prisma.WorkforceCrewWhereInput {
  if (!workforceOpen(context)) return NOTHING;
  if (seesWholeCompany(context)) return { companyId: context.companyId };
  return { companyId: context.companyId, project: { is: workforceProjectWhere(context) } };
}

export function readableAssignmentWhere(context: UserContext): Prisma.EmployeeProjectAssignmentWhereInput {
  if (!workforceOpen(context)) return NOTHING;
  return { companyId: context.companyId, project: workforceProjectWhere(context) };
}

/**
 * Whether this reader may change a crew with this project (§114): the grant,
 * and the crew's project in their scope — or company scope for a crew that
 * belongs to no project.
 */
export function canManageCrewOn(context: UserContext, projectInScope: boolean | null): boolean {
  if (!workforceOpen(context) || !can(context, "workforce.crew.manage")) return false;
  if (seesWholeCompany(context)) return true;
  return projectInScope === true;
}

export function canManageAssignments(context: UserContext): boolean {
  return workforceOpen(context) && can(context, "workforce.project_assignment.manage");
}
