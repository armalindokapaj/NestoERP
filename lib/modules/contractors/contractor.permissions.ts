import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can, canAccessModule, getModuleScope, isModuleEnabled } from "@/lib/access/can";
import { buildProjectScopeWhere } from "@/lib/access/scope";
import type { UserContext } from "@/lib/context/types";

/**
 * Who reaches which contractor records (PRD #46 §175-§193, §240-§247).
 *
 * Company + module + permission + scope + record. The contractor directory is
 * company master data, like suppliers: anybody whose contractor access reaches
 * company or project scope reads all of it — a project manager has to find a
 * contractor to assign one. A reader limited to assigned or own records sees
 * only the contractors on projects they can open and the ones they added.
 * Everything that belongs to a project — the assignment, a work package — is
 * reached only through that project's door, so reading a contractor never
 * opens a project.
 */

export const MODULE = "contractors" as const;
export const RECORD = "contractor" as const;
export const WORK_PACKAGE_RECORD = "work_package" as const;
export const COMPLIANCE_RECORD = "contractor_compliance" as const;
export const ACTIVITY_ENTITY = "ContractorProfile";
export const WORK_PACKAGE_ACTIVITY = "WorkPackage";

const NONE = { id: { in: [] as string[] } };

export function contractorsOpen(context: UserContext, permission: Permission = "contractor.view"): boolean {
  return isModuleEnabled(context, MODULE) && canAccessModule(context, MODULE) && can(context, permission);
}

function wholeDirectory(context: UserContext): boolean {
  const scope = getModuleScope(context, MODULE);
  return scope !== "ASSIGNED" && scope !== "SELF";
}

/** Projects whose contractor side this reader may open with this permission. */
export function contractorProjectDoor(context: UserContext, permission: Permission): Prisma.ProjectWhereInput | null {
  if (!contractorsOpen(context, permission) || !can(context, "project.view")) return null;
  return buildProjectScopeWhere(context);
}

export function contractorDirectoryWhere(context: UserContext): Prisma.ContractorProfileWhereInput {
  if (!contractorsOpen(context)) return NONE;
  if (wholeDirectory(context)) return { companyId: context.companyId };
  const door = can(context, "project.view") ? buildProjectScopeWhere(context) : null;
  return {
    companyId: context.companyId,
    OR: [{ createdByMemberId: context.membershipId }, ...(door ? [{ projectAssignments: { some: { project: { is: door } } } }] : [])],
  };
}

export function readableAssignmentWhere(context: UserContext): Prisma.ProjectContractorAssignmentWhereInput {
  const door = contractorProjectDoor(context, "project_contractor.view");
  return door ? { companyId: context.companyId, project: { is: door } } : NONE;
}

export function readableWorkPackageWhere(context: UserContext): Prisma.WorkPackageWhereInput {
  const door = contractorProjectDoor(context, "work_package.view");
  return door ? { companyId: context.companyId, project: { is: door } } : NONE;
}

/** Compliance belongs to the contractor, so it follows the directory — and its own grant (§41, §181). */
export function readableComplianceWhere(context: UserContext): Prisma.ContractorComplianceItemWhereInput {
  if (!contractorsOpen(context, "contractor_compliance.view")) return NONE;
  return { companyId: context.companyId, contractor: { is: contractorDirectoryWhere(context) } };
}

/** Contract details on a contractor, assignment or work package need Legal or Finance authority (§53, §54, §157). */
export function commercialOpen(context: UserContext): boolean {
  return (canAccessModule(context, "contracts") && can(context, "legal.view")) || (canAccessModule(context, "finance") && can(context, "finance.view"));
}
