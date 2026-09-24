/**
 * Test fixtures, kept out of the demo (E-06 §45, §150).
 *
 * The automated suites need tenants and accounts no demonstration should show:
 * a company with half its modules off, a suspended company, accounts that must
 * fail to sign in in a particular way, invitations in every state. They live in
 * their own parent group, flagged as a test fixture, so the Platform Admin's
 * group list and the demo sign-in screen never see them — and so nobody in the
 * demo group can reach them through group scope either.
 */

export const FIXTURE_GROUP = {
  id: "group_fixture",
  slug: "nesto-test-fixtures",
  name: "NESTO Test Fixtures",
} as const;

/**
 * A standalone company tenant (OW §8, §45, §86): a parent group that holds one
 * company. It has no Group level, so its Owner works in the company and the
 * sidebar names the company alone. The group's name differs from the
 * company's on purpose, so a test can tell which one is shown.
 */
export const SOLO_GROUP = {
  id: "group_fixture_solo",
  slug: "nesto-solo-fixture",
  name: "Solo Studio Holding",
} as const;
export const SOLO_COMPANY = "company_fixture_solo";
export const SOLO_OWNER = {
  id: "user_solo_owner",
  username: "solo-owner",
  email: "solo-owner@nesto.test",
  firstName: "Sara",
  lastName: "Lindqvist",
  role: "OWNER",
  department: "executive",
  jobTitle: "Owner",
  phone: "+355 69 900 0002",
} as const;

/** The other tenant: a different company in a different group, with seven modules off. */
export const FIXTURE_TENANT = "company_fixture_tenant";
/** Accounts in awkward states, invitations, and projects the demo no longer shows. */
export const FIXTURE_WORKS = "company_fixture";
/** A suspended company: nobody in it can sign in. */
export const COMPANY_SUSPENDED = "company_demo_suspended";

/** The tenant switches off exactly what Company B used to (PRD #9 §13). */
export const FIXTURE_TENANT_DISABLED_MODULES = ["finance", "sales", "contracts", "procurement", "inventory", "qaqc", "hse"] as const;

export const FIXTURE_PROJECTS = {
  /** The tenant's two projects: isolation targets. */
  tenantOne: "project_b_one",
  tenantTwo: "project_b_two",
  /** A finished project and an archived one, for status and restore paths. */
  finished: "project_f",
  archived: "project_archived",
} as const;

export const TENANT_USERS = [
  { id: "user_owner_b", username: "tenant-owner", email: "tenant-owner@nesto.test", firstName: "Bruno", lastName: "Keller", role: "OWNER", department: "executive", jobTitle: "Owner", phone: "+49 30 000 001" },
  { id: "user_viewer_b", username: "tenant-viewer", email: "tenant-viewer@nesto.test", firstName: "Bea", lastName: "Hoffman", role: "VIEWER", department: "projects", jobTitle: "Observer", phone: "+49 30 000 002" },
] as const;

export const FIXTURE_OWNER = {
  id: "user_fixture_owner",
  username: "fixture-owner",
  email: "fixture-owner@nesto.test",
  firstName: "Felix",
  lastName: "Marsh",
  role: "OWNER",
  department: "executive",
  jobTitle: "Owner",
  phone: "+355 69 900 0001",
} as const;

/**
 * Accounts that must fail authentication in a specific way (PRD #9 §31).
 */
export const NEGATIVE_USERS = [
  { id: "user_inactive", username: "inactive-user", email: "inactive-user@nesto.test", firstName: "Ivy", lastName: "Nolan", userStatus: "INACTIVE" as const, membershipStatus: "ACTIVE" as const },
  { id: "user_suspended", username: "suspended-user", email: "suspended-user@nesto.test", firstName: "Sean", lastName: "Doyle", userStatus: "SUSPENDED" as const, membershipStatus: "ACTIVE" as const },
  { id: "user_membership_inactive", username: "inactive-membership", email: "inactive-membership@nesto.test", firstName: "Mila", lastName: "Frank", userStatus: "ACTIVE" as const, membershipStatus: "INACTIVE" as const },
  { id: "user_membership_suspended", username: "suspended-membership", email: "suspended-membership@nesto.test", firstName: "Marco", lastName: "Silva", userStatus: "ACTIVE" as const, membershipStatus: "SUSPENDED" as const },
];

/** A member of a suspended company: login must be refused (PRD #9 §32). */
export const SUSPENDED_COMPANY_USER = {
  id: "user_suspended_company",
  username: "suspended-company",
  email: "suspended-company@nesto.test",
  firstName: "Cora",
  lastName: "Neves",
};

/**
 * Invitation fixtures (PRD #14 §304–§306).
 *
 * The pending invitation's raw token is fixed so the acceptance flow can be
 * walked end to end without reading a mailbox. It is test data: the seed
 * refuses to run in production without an explicit opt-in, and a real
 * invitation's token is 32 random bytes that exist only in the email.
 */
export const DEMO_INVITE_TOKEN = "nesto-demo-pending-invite-token";
export const DEMO_EXISTING_ACCOUNT_INVITE_TOKEN = "nesto-demo-existing-account-invite-token";

/** Has a NESTO account already, and a pending invitation to Fixture Works. */
export const INVITED_USER = {
  id: "user_invited",
  username: "invited-consultant",
  email: "invited-consultant@nesto.test",
  firstName: "Iris",
  lastName: "Vale",
};

export const INVITE_IDS = {
  pending: "invite_pending",
  existingAccount: "invite_existing_account",
  expired: "invite_expired",
  cancelled: "invite_cancelled",
  accepted: "invite_accepted",
} as const;
