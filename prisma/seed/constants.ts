/**
 * Deterministic seed identifiers (PRD #9 §9).
 *
 * Automated tests address records by these ids, so they must never be random.
 * Running the seed on a clean database always produces the same graph.
 */
import type { DemoUserSpec } from "../../config/demo-accounts";

export { COMPANY_A_USERS, DEMO_PASSWORD } from "../../config/demo-accounts";
export type { DemoUserSpec } from "../../config/demo-accounts";

export const COMPANY_A = "company_demo_a";
export const COMPANY_B = "company_demo_b";
export const COMPANY_SUSPENDED = "company_demo_suspended";

export const PROJECT_IDS = {
  a: "project_a",
  b: "project_b",
  c: "project_c",
  d: "project_d",
  e: "project_e",
  f: "project_f",
  archived: "project_archived",
} as const;

/** Company A departments and their stable keys (PRD #9 §22, §23). */
export const DEPARTMENTS: { key: string; name: string }[] = [
  { key: "management", name: "Management" },
  { key: "administration", name: "Administration" },
  { key: "it", name: "IT" },
  { key: "hr", name: "HR" },
  { key: "projects", name: "Projects" },
  { key: "architecture", name: "Architecture" },
  { key: "engineering", name: "Engineering" },
  { key: "finance", name: "Finance" },
  { key: "legal", name: "Legal" },
  { key: "sales", name: "Sales" },
  { key: "procurement", name: "Procurement" },
  { key: "inventory", name: "Inventory" },
  { key: "qaqc", name: "QA/QC" },
  { key: "hse", name: "HSE" },
];

/** Company B exists so tenant isolation can actually be proven (PRD #9 §12). */
export const COMPANY_B_USERS: DemoUserSpec[] = [
  { id: "user_owner_b", email: "owner-b@nesto.test", firstName: "Bruno", lastName: "Keller", role: "OWNER", department: "management", jobTitle: "Owner", phone: "+49 30 000 001" },
  { id: "user_viewer_b", email: "viewer-b@nesto.test", firstName: "Bea", lastName: "Hoffman", role: "VIEWER", department: "projects", jobTitle: "Observer", phone: "+49 30 000 002" },
];

/**
 * Accounts that must fail authentication in a specific way (PRD #9 §31).
 * They exist for tests, not for the demo login list.
 */
export const NEGATIVE_USERS = [
  { id: "user_inactive", email: "inactive-user@nesto.test", firstName: "Ivy", lastName: "Nolan", userStatus: "INACTIVE" as const, membershipStatus: "ACTIVE" as const },
  { id: "user_suspended", email: "suspended-user@nesto.test", firstName: "Sean", lastName: "Doyle", userStatus: "SUSPENDED" as const, membershipStatus: "ACTIVE" as const },
  { id: "user_membership_inactive", email: "inactive-membership@nesto.test", firstName: "Mila", lastName: "Frank", userStatus: "ACTIVE" as const, membershipStatus: "INACTIVE" as const },
  { id: "user_membership_suspended", email: "suspended-membership@nesto.test", firstName: "Marco", lastName: "Silva", userStatus: "ACTIVE" as const, membershipStatus: "SUSPENDED" as const },
];

/**
 * Proves the schema supports a different role per company, well before the
 * company switcher exists (PRD #9 §30).
 */
export const MULTI_COMPANY_USER = {
  id: "user_multicompany",
  email: "multicompany@nesto.test",
  firstName: "Mia",
  lastName: "Vogel",
  phone: "+351 910 000 099",
};

/** A member of a suspended company: login must be refused (PRD #9 §32). */
export const SUSPENDED_COMPANY_USER = {
  id: "user_suspended_company",
  email: "suspended-company@nesto.test",
  firstName: "Cora",
  lastName: "Neves",
};

/**
 * Invitation fixtures (PRD #14 §304–§306).
 *
 * The pending invitation's raw token is fixed so the acceptance flow can be
 * walked end to end without reading a mailbox. It is demo data: the seed
 * refuses to run in production without an explicit opt-in, and a real
 * invitation's token is 32 random bytes that exist only in the email.
 */
export const DEMO_INVITE_TOKEN = "nesto-demo-pending-invite-token";
export const DEMO_EXISTING_ACCOUNT_INVITE_TOKEN = "nesto-demo-existing-account-invite-token";

/** Has a NESTO account already, and a pending invitation to Company A. */
export const INVITED_USER = {
  id: "user_invited",
  email: "invited-consultant@nesto.test",
  firstName: "Elira",
  lastName: "Hoxha",
};

export const INVITE_IDS = {
  pending: "invite_pending",
  existingAccount: "invite_existing_account",
  expired: "invite_expired",
  cancelled: "invite_cancelled",
  accepted: "invite_accepted",
} as const;

/**
 * Seed dates are generated relative to this anchor so "overdue", "due today"
 * and "upcoming" stay meaningful however long after the seed runs
 * (PRD #9 §228).
 */
export const SEED_NOW = new Date();

export function daysFromNow(days: number): Date {
  const date = new Date(SEED_NOW);
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}
