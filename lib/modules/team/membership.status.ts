import type { CompanyMember, MembershipStatus } from "@prisma/client";

/**
 * Membership status rules an administrator may apply (PRD #14 §109, §110).
 *
 * There is no `ACTIVE → INVITED`: an invitation is how somebody arrives, not a
 * state they can be pushed back into (PRD #14 §109).
 *
 * Nor is there `INVITED → ACTIVE`. Only the invited person accepting activates
 * an invitation — the acceptance path in `invite.service.ts` does it, bound to
 * their token and their account. An administrator "reactivating" a pending
 * invitation would hand company access to somebody who never agreed to join
 * and may not even control the address (PRD #47 §58).
 */
const TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  INVITED: ["INACTIVE"],
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

