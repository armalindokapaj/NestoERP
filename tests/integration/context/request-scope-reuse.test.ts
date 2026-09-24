import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { revokeSession } from "@/lib/auth/session-store";
import { loadGroupMemberContexts, resolveContextForSession } from "@/lib/context/build-context";
import { buildMemberContexts } from "@/lib/context/member-context";
import { loadOrganizationAccessFor } from "@/lib/context/organization-access";
import type { UserContext } from "@/lib/context/types";
import { resolveGroupContexts, resolvePersonalContexts } from "@/lib/context/workspace-access";
import { runWithRequestScope } from "@/lib/core/observability/request-scope";
import { prisma as app } from "@/lib/database/prisma";
import { canOpenQuickCreate } from "@/lib/modules/quick-create/eligibility";
import { resolveWorkspaceNavigation } from "@/lib/workspace/navigation";
import { listWorkspaces, switchWorkspace } from "@/lib/workspace/workspace.service";
import { cleanupSessions, loginAs, loginAsEmail, prisma } from "../../helpers";

// ARMAAR's owner: thirteen memberships, nine of them in companies open for work.
const ARMAAR_OWNER = "owner@armaar-demo.test";

/**
 * Request data reuse against the real database (NAV-02 §17.1, C01-C14).
 *
 * The scope is what a route handler gets from `withContext`; a server render
 * gets the same through React's `cache`. Counts are Prisma operations on the
 * application's client — the physical statements behind them are measured in
 * the production query-count evidence.
 */

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

function countReads() {
  const spies = {
    grants: vi.spyOn(app.accessGrant, "findMany"),
    assignments: vi.spyOn(app.departmentAssignment, "findMany"),
    modules: vi.spyOn(app.companyModule, "findMany"),
    memberships: vi.spyOn(app.companyMember, "findMany"),
    sessions: vi.spyOn(app.session, "findUnique"),
  };
  return () => Object.fromEntries(Object.entries(spies).map(([name, spy]) => [name, spy.mock.calls.length])) as Record<keyof typeof spies, number>;
}

async function resolved(sessionId: string, userId: string): Promise<UserContext> {
  const result = await resolveContextForSession(sessionId, { expectedUserId: userId });
  if (!result.ok) throw new Error(`context did not resolve: ${result.reason}`);
  return result.context;
}

/** What a context decides, without the object identity: the thing that must not change. */
function decisions(contexts: UserContext[]) {
  return contexts.map((context) => ({ companyId: context.companyId, role: context.role, position: context.position, permissions: context.permissions, enabledModules: context.enabledModules, moduleAccess: context.moduleAccess }));
}

describe("one request reads access once (C01-C05)", () => {
  it("concurrent consumers of one organization key share one assignments load and one grants load (C01, C02)", async () => {
    const owner = await loginAs("OWNER");
    const reads = countReads();
    await runWithRequestScope(async () => {
      const [a, b, c] = await Promise.all([
        loadOrganizationAccessFor(owner.parentGroupId, owner.userId),
        loadOrganizationAccessFor(owner.parentGroupId, owner.userId),
        loadOrganizationAccessFor(owner.parentGroupId, owner.userId),
      ]);
      expect(b).toBe(a);
      expect(c).toBe(a);
    });
    expect(reads()).toMatchObject({ grants: 1, assignments: 1 });
  });

  it("a company session that later loads its group's companies reuses its organization access and its own modules (C03)", async () => {
    const owner = await loginAs("OWNER");
    const reads = countReads();
    await runWithRequestScope(async () => {
      const context = await resolved(owner.sessionId, owner.userId);
      expect(context.workspace.scopeType).toBe("COMPANY");
      const companies = await resolveGroupContexts(context);
      expect(companies.length).toBeGreaterThan(1);
    });
    const counts = reads();
    // One organization read, not one for the session and another for the group.
    expect(counts).toMatchObject({ grants: 1, assignments: 1, sessions: 1 });
    // The session's company, then one batch for the rest: never one per company.
    expect(counts.modules).toBe(2);
    expect(counts.memberships).toBe(1);
  });

  it("the batch leaves out the company the session already resolved (QUERY-02)", async () => {
    const owner = await loginAs("OWNER");
    const batches: string[][] = [];
    const original = app.companyModule.findMany.bind(app.companyModule);
    vi.spyOn(app.companyModule, "findMany").mockImplementation(((args: { where?: { companyId?: string | { in: string[] } } }) => {
      const where = args?.where?.companyId;
      batches.push(typeof where === "string" ? [where] : [...(where?.in ?? [])]);
      return original(args as never);
    }) as never);
    await runWithRequestScope(async () => {
      const context = await resolved(owner.sessionId, owner.userId);
      await resolveGroupContexts(context);
    });
    expect(batches[0]).toEqual([owner.companyId]);
    expect(batches[1]).not.toContain(owner.companyId);
    expect(batches[1].length).toBeGreaterThan(0);
  });

  it("navigation, the workspace chooser, + Create and the bell share one set of company contexts (C04)", async () => {
    const owner = await loginAs("OWNER", { workspace: "GROUP" });
    expect(owner.workspace.scopeType).toBe("GROUP");
    const reads = countReads();
    await runWithRequestScope(async () => {
      const context = await resolved(owner.sessionId, owner.userId);
      const [navigation, workspaces, personal, group] = await Promise.all([
        resolveWorkspaceNavigation(context),
        listWorkspaces(context),
        resolvePersonalContexts(context),
        resolveGroupContexts(context),
      ]);
      expect(navigation.length).toBeGreaterThan(0);
      expect(workspaces.companies.map((company) => company.id).sort()).toEqual(group.map((company) => company.companyId).sort());
      expect(personal.every((company) => group.includes(company))).toBe(true);
      expect(canOpenQuickCreate("GROUP", group)).toBe(true);
    });
    const counts = reads();
    expect(counts).toMatchObject({ grants: 1, assignments: 1 });
    // One membership batch for the group, one for the chooser's other groups.
    expect(counts.memberships).toBe(2);
  });

  it("five companies or nine, the group's contexts cost the same queries: never one per company (C05)", async () => {
    const people = [await loginAs("OWNER"), await loginAsEmail(ARMAAR_OWNER)];
    const sizes: number[] = [];
    for (const person of people) {
      const reads = countReads();
      await runWithRequestScope(async () => {
        sizes.push((await loadGroupMemberContexts({ userId: person.userId, parentGroupId: person.parentGroupId, sessionId: person.sessionId })).length);
      });
      expect(reads()).toMatchObject({ memberships: 1, modules: 1, grants: 1, assignments: 1 });
      vi.restoreAllMocks();
    }
    expect(sizes[0]).toBeGreaterThanOrEqual(5);
    expect(sizes[1]).toBeGreaterThanOrEqual(9);
  });
});

describe("reuse never changes an answer (C06, C08, C12, C14)", () => {
  it("the group's contexts are the same with and without a scope (C14: no cross-company synthesis)", async () => {
    for (const role of ["OWNER", "PROCUREMENT", "FINANCE"] as const) {
      const person = await loginAs(role);
      const fresh = await loadGroupMemberContexts({ userId: person.userId, parentGroupId: person.parentGroupId, sessionId: person.sessionId });
      const reused = await runWithRequestScope(async () => {
        const context = await resolved(person.sessionId, person.userId);
        return resolveGroupContexts(context);
      });
      expect(decisions(reused), role).toEqual(decisions(fresh));
    }
  });

  it("a company with no switchable module on is loaded as Dashboard only, not as unknown (C06)", async () => {
    const owner = await loginAs("OWNER");
    const other = await prisma.companyMember.findFirstOrThrow({ where: { userId: owner.userId, status: "ACTIVE", companyId: { not: owner.companyId }, company: { parentGroupId: owner.parentGroupId } }, select: { companyId: true } });
    const switchedOn = await prisma.companyModule.findMany({ where: { companyId: other.companyId, enabled: true }, select: { id: true } });
    await prisma.companyModule.updateMany({ where: { id: { in: switchedOn.map((row) => row.id) } }, data: { enabled: false } });
    try {
      const contexts = await runWithRequestScope(async () => resolveGroupContexts(await resolved(owner.sessionId, owner.userId)));
      const company = contexts.find((context) => context.companyId === other.companyId);
      expect(company?.enabledModules).toEqual(["dashboard"]);
      const enabled = Object.values(company?.moduleAccess ?? {}).filter((access) => access.enabled).map((access) => access.module);
      expect(enabled).toEqual(["dashboard"]);
      expect(company?.permissions).toEqual([...(company?.moduleAccess.dashboard.permissions ?? [])].sort());
    } finally {
      await prisma.companyModule.updateMany({ where: { id: { in: switchedOn.map((row) => row.id) } }, data: { enabled: true } });
    }
  });

  it("two people in concurrent requests each get their own access (C08)", async () => {
    const [owner, finance] = await Promise.all([loginAs("OWNER"), loginAs("FINANCE")]);
    const [a, b] = await Promise.all([
      runWithRequestScope(async () => resolveGroupContexts(await resolved(owner.sessionId, owner.userId))),
      runWithRequestScope(async () => resolveGroupContexts(await resolved(finance.sessionId, finance.userId))),
    ]);
    expect(a.every((context) => context.userId === owner.userId)).toBe(true);
    expect(b.every((context) => context.userId === finance.userId)).toBe(true);
  });

  it("other members' contexts use their own access, never the requester's (C12)", async () => {
    const owner = await loginAs("OWNER");
    const viewer = await loginAs("VIEWER");
    const [inScope, outside] = await Promise.all([
      runWithRequestScope(async () => {
        await resolved(owner.sessionId, owner.userId);
        return (await buildMemberContexts(viewer.companyId, [viewer.membershipId])).get(viewer.membershipId);
      }),
      buildMemberContexts(viewer.companyId, [viewer.membershipId]).then((contexts) => contexts.get(viewer.membershipId)),
    ]);
    expect(inScope?.userId).toBe(viewer.userId);
    expect(inScope?.permissions).toEqual(outside?.permissions);
    expect(inScope?.permissions).not.toEqual(owner.permissions);
  });
});

describe("freshness across requests and after commits (C09, C10)", () => {
  it("a revoked session is refused by the next request, whatever the last one read (C09)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    await runWithRequestScope(() => resolved(pm.sessionId, pm.userId));
    await revokeSession(pm.sessionId);
    const next = await runWithRequestScope(() => resolveContextForSession(pm.sessionId, { expectedUserId: pm.userId }));
    expect(next.ok).toBe(false);
  });

  it("a workspace switch reads the new workspace back, not the one the request began in (C10)", async () => {
    const owner = await loginAs("OWNER");
    const other = await prisma.companyMember.findFirstOrThrow({ where: { userId: owner.userId, status: "ACTIVE", companyId: { not: owner.companyId }, company: { parentGroupId: owner.parentGroupId } }, select: { companyId: true } });
    await runWithRequestScope(async () => {
      const before = await resolved(owner.sessionId, owner.userId);
      await resolveGroupContexts(before);
      const result = await switchWorkspace(before, { scopeType: "COMPANY", companyId: other.companyId });
      expect(result.change.nextCompanyId).toBe(other.companyId);
      const after = await resolved(owner.sessionId, owner.userId);
      expect(after.companyId).toBe(other.companyId);
      expect(after.workspace.companyId).toBe(other.companyId);
    });
  });
});
