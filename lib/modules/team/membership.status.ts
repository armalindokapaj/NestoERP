import type { CompanyMember, DepartmentStatus, MembershipStatus } from "@prisma/client";

/**
 * Membership status rules (PRD #14 §109, §110).
 *
 * There is no `ACTIVE → INVITED`: an invitation is how somebody arrives, not a
 * state they can be pushed back into (PRD #14 §109).
 */
const TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  INVITED: ["ACTIVE", "INACTIVE"],
  ACTIVE: ["INACTIVE", "SUSPENDED"],
  INACTIVE: ["ACTIVE", "SUSPENDED"],
  SUSPENDED: ["ACTIVE", "INACTIVE"],
};

export function canTransitionMembershipStatus(
  from: MembershipStatus,
  to: MembershipStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/**
 * Whether this membership may act inside the company.
 *
 * The authorisation layer asks this on every request, which is what makes a
 * deactivation take effect immediately rather than when a session expires
 * (PRD #14 §242).
 */
export function isCompanyAccessAllowed(status: MembershipStatus): boolean {
  return status === "ACTIVE";
}

export function isMembershipActive(member: Pick<CompanyMember, "status">): boolean {
  return member.status === "ACTIVE";
}

export const membershipStatusLabels: Record<MembershipStatus, string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  INACTIVE: "Inactive",
  SUSPENDED: "Suspended",
};

/* -------------------------------------------------------------------------- */
/* Departments                                                                 */
/* -------------------------------------------------------------------------- */

const DEPARTMENT_TRANSITIONS: Record<DepartmentStatus, DepartmentStatus[]> = {
  ACTIVE: ["INACTIVE"],
  INACTIVE: ["ACTIVE"],
  ARCHIVED: [],
};

export const EDITABLE_DEPARTMENT_STATUSES: DepartmentStatus[] = ["ACTIVE", "INACTIVE"];

export function canTransitionDepartmentStatus(
  from: DepartmentStatus,
  to: DepartmentStatus,
): boolean {
  if (from === to) return true;
  return DEPARTMENT_TRANSITIONS[from].includes(to);
}

export function isDepartmentArchived(
  department: Pick<{ status: DepartmentStatus; archivedAt: Date | null }, "status" | "archivedAt">,
): boolean {
  return department.status === "ARCHIVED" || department.archivedAt !== null;
}
