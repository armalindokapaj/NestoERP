import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextResult } from "@/lib/context/types";
import { counterValue, Metric, resetMetrics } from "@/lib/core/observability/metrics";
import { resolveContextForSession } from "@/lib/context/build-context";
import { cleanupSessions, COMPANY, createRawSession, DEMO_EMAIL, prisma } from "../helpers";
import { callRoute, discoverApiRoutes, loadRouteModule, type RouteModule } from "./harness/routes";

/**
 * Access follows the database on the very next request (PRD #47 §22, §23,
 * §126-§130, §212, §213).
 *
 * Here the context is resolved by the real resolver from a real session row on
 * every call — only the cookie read is replaced — so a suspension, a role
 * change or a module switched off between two requests must show on the
 * second one. There is no permission cache to go stale: `UserContext` is
 * rebuilt from the membership, the role defaults and the company's module
 * switches each time (see docs/security/authorization-model.md, "Freshness").
 */
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/context/resolve-user-context", () => ({
  resolveUserContext: async (): Promise<ContextResult> => (session.id ? resolveContextForSession(session.id) : { ok: false, reason: "UNAUTHENTICATED" }),
}));

const routes = new Map<string, RouteModule>();
async function get(pattern: string, path = pattern) {
  if (!routes.has(pattern)) routes.set(pattern, await loadRouteModule(discoverApiRoutes().find((route) => route.pattern === pattern)!));
  return callRoute(routes.get(pattern)!.GET!, "GET", path, {});
}
const codeOf = (body: unknown) => (body as { error?: { code?: string } })?.error?.code;
const permissionsOf = (body: unknown) => (body as { permissions: string[] }).permissions;

beforeEach(() => {
  session.id = "";
  resetMetrics();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("session and membership state (PRD #47 §13, §22, §23)", () => {
  it("answers 401 with no session", async () => {
    const outcome = await get("/api/me");
    expect(outcome.status).toBe(401);
    expect(codeOf(outcome.body)).toBe("UNAUTHENTICATED");
    expect(counterValue(Metric.AUTHORIZATION_DENIED, { reason: "UNAUTHENTICATED" })).toBe(1);
  });

  it("refuses the next request once the membership is suspended, and serves it again once restored (§129, §130, §213)", async () => {
    const { session: row, membership } = await createRawSession("viewer@nesto.test");
    session.id = row.id;
    expect((await get("/api/me")).status).toBe(200);

    await prisma.companyMember.update({ where: { id: membership.id }, data: { status: "SUSPENDED" } });
    try {
      const outcome = await get("/api/me");
      expect(outcome.status).toBe(403);
      expect(codeOf(outcome.body)).toBe("MEMBERSHIP_INACTIVE");
      expect(counterValue(Metric.AUTHORIZATION_DENIED, { reason: "MEMBERSHIP_INACTIVE" })).toBe(1);
    } finally {
      await prisma.companyMember.update({ where: { id: membership.id }, data: { status: "ACTIVE" } });
    }
    expect((await get("/api/me")).status).toBe(200);
  });

  it("refuses every request for a member of a suspended company (§22)", async () => {
    const { session: row } = await createRawSession("suspended-company@nesto.test").catch(async () => {
      const member = await prisma.companyMember.findFirstOrThrow({ where: { company: { status: "SUSPENDED" } }, include: { user: true } });
      return createRawSession(member.user.username);
    });
    session.id = row.id;
    const outcome = await get("/api/me");
    expect(outcome.status).toBe(403);
    expect(codeOf(outcome.body)).toBe("COMPANY_INACTIVE");
  });
});

describe("authorization changes take effect on the next request (PRD #47 §128, §212)", () => {
  it("applies a role change immediately, in both directions", async () => {
    const { session: row, membership } = await createRawSession("viewer@nesto.test");
    session.id = row.id;
    const viewerPermissions = permissionsOf((await get("/api/me")).body);
    expect(viewerPermissions).not.toContain("task.create");

    const engineer = await prisma.role.findUniqueOrThrow({ where: { key: "ENGINEER" } });
    await prisma.companyMember.update({ where: { id: membership.id }, data: { roleId: engineer.id } });
    try {
      expect(permissionsOf((await get("/api/me")).body)).toContain("task.create");
    } finally {
      await prisma.companyMember.update({ where: { id: membership.id }, data: { roleId: membership.roleId } });
    }
    expect(permissionsOf((await get("/api/me")).body)).toEqual(viewerPermissions);
  });

  it("removes a module's permissions and its API the moment the company switches it off (§26, §211)", async () => {
    const { session: row } = await createRawSession(DEMO_EMAIL.tenantOwner);
    session.id = row.id;
    const meetings = await prisma.companyModule.findFirstOrThrow({ where: { companyId: COMPANY.tenant, module: { key: "meetings" } } });
    expect(meetings.enabled).toBe(true);
    expect(permissionsOf((await get("/api/me")).body)).toContain("meeting.view");

    await prisma.companyModule.update({ where: { id: meetings.id }, data: { enabled: false } });
    try {
      expect(permissionsOf((await get("/api/me")).body).filter((permission) => permission.startsWith("meeting."))).toEqual([]);
      const outcome = await get("/api/meetings");
      expect(outcome.status).toBe(403);
      expect(codeOf(outcome.body)).toBe("MODULE_UNAVAILABLE");
      expect(counterValue(Metric.MODULE_DISABLED_DENIED)).toBe(1);
    } finally {
      await prisma.companyModule.update({ where: { id: meetings.id }, data: { enabled: true } });
    }
    expect((await get("/api/meetings")).status).toBe(200);
  });
});

describe("denials are recorded without disclosure (PRD #47 §116-§118, §196)", () => {
  it("answers a guessed record id with a plain 404 and counts it as a record denial", async () => {
    const { session: row } = await createRawSession(DEMO_EMAIL.tenantOwner);
    session.id = row.id;
    const task = await prisma.task.findFirstOrThrow({ where: { companyId: COMPANY.a }, select: { id: true, title: true } });
    const route = discoverApiRoutes().find((candidate) => candidate.pattern === "/api/tasks/[taskId]")!;
    const handlers = await loadRouteModule(route);
    const outcome = await callRoute(handlers.GET!, "GET", `/api/tasks/${task.id}`, { taskId: task.id });
    expect(outcome.status).toBe(404);
    expect(JSON.stringify(outcome.body)).not.toContain(task.title);
    expect(Object.keys((outcome.body as { error: object }).error).sort()).toEqual(["code", "message", "requestId"]);
    expect(counterValue(Metric.AUTHORIZATION_DENIED, { reason: "RECORD_DENIED" })).toBe(1);
  });
});
