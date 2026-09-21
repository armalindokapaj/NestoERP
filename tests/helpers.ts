import { PrismaClient } from "@prisma/client";

import type { RoleKey } from "@/config/roles";
import { resolveContextForSession } from "@/lib/context/build-context";
import { resolvePlatformContextForSession, type PlatformContext } from "@/lib/context/platform-context";
import type { UserContext } from "@/lib/context/types";

/**
 * Test fixtures (PRD #9 §206, §207).
 *
 * `loginAs("PROJECT_MANAGER")` resolves the real seeded account through the
 * real resolver: real database, real membership, real role, real permissions.
 * Authorisation is never mocked in tests that exist to verify authorisation
 * (PRD #9 §223).
 *
 * The account behind each role is the one that has always carried it, so a
 * test reading "the records QA/QC raised" still reads the right ones. Since
 * E-06 several of them head a group department and are a member of all five
 * demo companies; a session starts in Aurelia, their oldest membership, as a
 * real sign-in does. The Owner, IT, HR, Legal, Procurement, Inventory, QA/QC,
 * HSE and Finance accounts are group heads; the CEO, Project Manager,
 * Architect, Engineer, Sales and Viewer accounts are Aurelia's own members.
 */
export const prisma = new PrismaClient();

const EMAIL_FOR_ROLE: Record<RoleKey, string> = {
  OWNER: "owner@nesto.test",
  PLATFORM_ADMIN: "platform-admin@nesto.test",
  GROUP_IT: "it@nesto.test",
  HR: "hr@nesto.test",
  CEO: "ceo@nesto.test",
  PROJECT_MANAGER: "pm@nesto.test",
  ARCHITECT: "architect@nesto.test",
  ENGINEER: "engineer@nesto.test",
  FINANCE: "finance@nesto.test",
  LEGAL: "legal@nesto.test",
  SALES: "sales@nesto.test",
  PROCUREMENT: "procurement@nesto.test",
  INVENTORY: "inventory@nesto.test",
  QAQC: "qaqc@nesto.test",
  HSE: "hse@nesto.test",
  VIEWER: "viewer@nesto.test",
};

/**
 * Seeded people the role map above cannot name (E-06 §51-§55, §136).
 */
export const DEMO_EMAIL = {
  /** Heads Group Architecture and manages Aurelia's architecture branch. */
  architectureHead: "architecture-manager@nesto.test",
  /** Heads Group Sales and manages Meridian's sales branch. */
  salesHead: "sales-manager@nesto.test",
  /** Heads Group Engineering; manages no branch. */
  engineeringHead: "group-engineering@nesto.test",
  /** Meridian's own architecture manager; heads nothing. */
  architectureManagerB: "architecture-manager-b@nesto.test",
  /** An Aurelia accountant: a plain company Finance member. */
  financeA: "finance-a@nesto.test",
  /** Architect in Aurelia and in Forma. */
  multiCompany: "multicompany@nesto.test",
  /** The fixture tenant's owner: another group, another company. */
  tenantOwner: "tenant-owner@nesto.test",
  tenantViewer: "tenant-viewer@nesto.test",
  /** Fixture Works' owner: where invitations and awkward memberships live. */
  fixtureOwner: "fixture-owner@nesto.test",
  pmB: "pm-b@nesto.test",
  ceoB: "ceo-b@nesto.test",
} as const;

export function demoEmail(role: RoleKey): string {
  return EMAIL_FOR_ROLE[role];
}

const USERNAME_FOR_ROLE: Record<RoleKey, string> = {
  OWNER: "owner",
  PLATFORM_ADMIN: "platform-admin",
  GROUP_IT: "group-it",
  HR: "group-hr",
  CEO: "ceo-a",
  PROJECT_MANAGER: "pm-a",
  ARCHITECT: "architect-a",
  ENGINEER: "engineer-a",
  FINANCE: "group-finance",
  LEGAL: "group-legal",
  SALES: "sales-a",
  PROCUREMENT: "group-procurement",
  INVENTORY: "group-inventory",
  QAQC: "group-qaqc",
  HSE: "group-hse",
  VIEWER: "viewer-a",
};

/** What a seeded role's account signs in with (PRD #50 §6, E-06 §48). */
export function demoUsername(role: RoleKey): string {
  return USERNAME_FOR_ROLE[role];
}

const createdSessions: string[] = [];

/**
 * Creates a real session row for a seeded account and resolves its context.
 *
 * Takes the address because that is how the demo roster is keyed here; the
 * account is found by it, not authenticated by it — signing in is by username
 * (PRD #50 §6), which `authenticateCredentials` covers in its own tests.
 */
export async function loginAsEmail(email: string, options: WorkspaceOption = {}): Promise<UserContext> {
  // An undefined address would drop the filter and sign in as whoever comes first.
  if (!email) throw new Error("loginAsEmail needs an address: is the role still seeded?");
  const user = await prisma.user.findFirst({
    where: { email },
    include: { memberships: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 1 } },
  });

  if (!user) throw new Error(`No seeded user for ${email}. Run the seed first.`);
  const membership = user.memberships[0];
  if (!membership) throw new Error(`${email} has no active membership.`);

  const session = await prisma.session.create({
    data: {
      sessionToken: `test_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      userId: user.id,
      membershipId: membership.id,
      currentCompanyId: membership.companyId,
      workspaceScope: options.workspace ?? "COMPANY",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  createdSessions.push(session.id);

  const result = await resolveContextForSession(session.id, { expectedUserId: user.id });
  if (!result.ok) throw new Error(`Could not resolve context for ${email}: ${result.reason}`);

  return result.context;
}

/**
 * A session in one named membership. A person in two companies has two, and
 * `loginAsEmail` takes whichever the database returns first — a test about
 * which company the session is in has to say (E-05A §28).
 */
export async function loginAsMembership(membershipId: string, options: WorkspaceOption = {}): Promise<UserContext> {
  const membership = await prisma.companyMember.findUnique({ where: { id: membershipId } });
  if (!membership) throw new Error(`No seeded membership ${membershipId}. Run the seed first.`);

  const session = await prisma.session.create({
    data: {
      sessionToken: `test_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      userId: membership.userId,
      membershipId: membership.id,
      currentCompanyId: membership.companyId,
      workspaceScope: options.workspace ?? "COMPANY",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  createdSessions.push(session.id);

  const result = await resolveContextForSession(session.id, { expectedUserId: membership.userId });
  if (!result.ok) throw new Error(`Could not resolve context for ${membershipId}: ${result.reason}`);
  return result.context;
}

export function loginAs(role: RoleKey, options: WorkspaceOption = {}): Promise<UserContext> {
  return loginAsEmail(demoEmail(role), options);
}

/**
 * The workspace a test session starts in. A session made here works in its
 * company unless it says otherwise, as every test written before the Group
 * workspace assumed; `workspace: "GROUP"` asks for the group, which the
 * resolver grants only to somebody with group-level standing
 * (Workspace Context §16, §82).
 */
export type WorkspaceOption = { workspace?: "GROUP" | "COMPANY" };

/**
 * A session for the Platform Admin, who has no membership: it resolves to the
 * platform context, never a company one (E-06 §19).
 */
export async function loginAsPlatformAdmin(email = EMAIL_FOR_ROLE.PLATFORM_ADMIN): Promise<PlatformContext & { sessionId: string }> {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  const session = await prisma.session.create({
    data: {
      sessionToken: `test_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  createdSessions.push(session.id);
  const result = await resolvePlatformContextForSession(session.id, { expectedUserId: user.id });
  if (!result.ok) throw new Error(`Could not resolve a platform context for ${email}: ${result.reason}`);
  return result.context;
}

/** Resolves a context for a session id without asserting success. */
export function resolveSession(sessionId: string, expectedUserId?: string) {
  return resolveContextForSession(sessionId, { expectedUserId });
}

export async function createRawSession(identifier: string) {
  if (!identifier) throw new Error("createRawSession needs an address or a username.");
  // Either an address or a username: the callers here are fixtures naming a
  // seeded account, not a login path.
  const user = await prisma.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { username: identifier },
    include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!user) throw new Error(`No seeded user for ${identifier}`);
  const membership = user.memberships[0];

  const session = await prisma.session.create({
    data: {
      sessionToken: `test_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      userId: user.id,
      membershipId: membership.id,
      currentCompanyId: membership.companyId,
      workspaceScope: "COMPANY",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  createdSessions.push(session.id);
  return { session, user, membership };
}

/**
 * Group-level standing for somebody who has none by role: a group-scope grant on
 * a module, which is one of the ways the access model gives it (Workspace
 * Context §7, §8, §63). Returns what undoes it. Used to test the cross-company
 * mechanics with the seeded multi-company Architect, who holds no group position.
 */
export async function grantGroupStanding(userId: string, parentGroupId = "group_demo_nesto"): Promise<() => Promise<void>> {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: EMAIL_FOR_ROLE.OWNER } });
  const grant = await prisma.accessGrant.create({
    data: { userId, parentGroupId, functionKey: "organization", scopeType: "GROUP", accessLevel: "VIEW", grantedByUserId: owner.id, reason: "test: group standing" },
  });
  return async () => {
    await prisma.accessGrant.delete({ where: { id: grant.id } });
  };
}

/** Removes the sessions a test file created, leaving the seed untouched. */
export async function cleanupSessions(): Promise<void> {
  if (createdSessions.length === 0) return;
  await prisma.session.deleteMany({ where: { id: { in: createdSessions } } });
  createdSessions.length = 0;
}

/** One of a company's own project types by name, as seeded from the defaults (E-05A §62). */
export async function projectTypeId(companyId = "company_demo_a", name = "Residential"): Promise<string> {
  return (await prisma.projectType.findFirstOrThrow({ where: { companyId, name }, select: { id: true } })).id;
}

/** The demo companies and the test fixture companies (E-06 §43, §45). */
export const COMPANY = {
  a: "company_demo_a",
  b: "company_demo_b",
  c: "company_demo_c",
  d: "company_demo_d",
  e: "company_demo_e",
  /** Another group; seven modules off. The isolation target. */
  tenant: "company_fixture_tenant",
  /** Invitations, negative memberships, a finished and an archived project. */
  works: "company_fixture",
  suspended: "company_demo_suspended",
} as const;

/**
 * One visible project per demo company (a Riverside Residences, b Central
 * Office Tower, c East Gate Logistics Hub, d Marina Apartments, e Adriatic
 * Hotel & Residences), and the fixtures' projects.
 */
export const PROJECT = {
  a: "project_a",
  b: "project_b",
  c: "project_c",
  d: "project_d",
  e: "project_e",
  /** Fixture Works: FINISHED. */
  f: "project_f",
  /** Fixture Works: archived. */
  archived: "project_archived",
  /** The fixture tenant's first project. */
  companyB: "project_b_one",
} as const;
