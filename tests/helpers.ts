import { PrismaClient } from "@prisma/client";

import type { RoleKey } from "@/config/roles";
import { resolveContextForSession } from "@/lib/context/build-context";
import type { UserContext } from "@/lib/context/types";

/**
 * Test fixtures (PRD #9 §206, §207).
 *
 * `loginAs("PROJECT_MANAGER")` resolves the real seeded account through the
 * real resolver: real database, real membership, real role, real permissions.
 * Authorisation is never mocked in tests that exist to verify authorisation
 * (PRD #9 §223).
 */
export const prisma = new PrismaClient();

const EMAIL_FOR_ROLE: Record<RoleKey, string> = {
  OWNER: "owner@nesto.test",
  ADMIN: "admin@nesto.test",
  COMPANY_IT: "it@nesto.test",
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

export function demoEmail(role: RoleKey): string {
  return EMAIL_FOR_ROLE[role];
}

/** What a seeded role signs in with (PRD #50 §6). */
export function demoUsername(role: RoleKey): string {
  return EMAIL_FOR_ROLE[role].split("@")[0];
}

const createdSessions: string[] = [];

/**
 * Creates a real session row for a seeded account and resolves its context.
 *
 * Takes the address because that is how the demo roster is keyed here; the
 * account is found by it, not authenticated by it — signing in is by username
 * (PRD #50 §6), which `authenticateCredentials` covers in its own tests.
 */
export async function loginAsEmail(email: string): Promise<UserContext> {
  const user = await prisma.user.findFirst({
    where: { email },
    include: { memberships: { where: { status: "ACTIVE" }, take: 1 } },
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
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  createdSessions.push(session.id);

  const result = await resolveContextForSession(session.id, { expectedUserId: user.id });
  if (!result.ok) throw new Error(`Could not resolve context for ${email}: ${result.reason}`);

  return result.context;
}

export function loginAs(role: RoleKey): Promise<UserContext> {
  return loginAsEmail(demoEmail(role));
}

/** Resolves a context for a session id without asserting success. */
export function resolveSession(sessionId: string, expectedUserId?: string) {
  return resolveContextForSession(sessionId, { expectedUserId });
}

export async function createRawSession(identifier: string) {
  // Either an address or a username: the callers here are fixtures naming a
  // seeded account, not a login path.
  const user = await prisma.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { username: identifier },
    include: { memberships: { take: 1 } },
  });
  if (!user) throw new Error(`No seeded user for ${identifier}`);
  const membership = user.memberships[0];

  const session = await prisma.session.create({
    data: {
      sessionToken: `test_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      userId: user.id,
      membershipId: membership.id,
      currentCompanyId: membership.companyId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  createdSessions.push(session.id);
  return { session, user, membership };
}

/** Removes the sessions a test file created, leaving the seed untouched. */
export async function cleanupSessions(): Promise<void> {
  if (createdSessions.length === 0) return;
  await prisma.session.deleteMany({ where: { id: { in: createdSessions } } });
  createdSessions.length = 0;
}

export const PROJECT = {
  a: "project_a",
  b: "project_b",
  c: "project_c",
  d: "project_d",
  e: "project_e",
  f: "project_f",
  archived: "project_archived",
  companyB: "project_b_one",
} as const;
