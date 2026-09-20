import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { cleanupSessions, loginAs, prisma } from "@/tests/helpers";
import { actAs } from "./harness/actor";
import { callRoute, discoverApiRoutes, fillPattern, HTTP_METHODS, loadRouteModule } from "./harness/routes";

vi.mock("@/lib/context/resolve-user-context", () => import("./harness/actor"));

describe("Company session / Platform 3D boundary", () => {
  let owner: UserContext;

  beforeAll(async () => {
    owner = await loginAs("OWNER");
  });

  afterAll(async () => {
    actAs(null);
    await cleanupSessions();
    await prisma.$disconnect();
  });

  it("refuses every Platform 3D API method before parsing or lookup", async () => {
    actAs(owner);
    const attempts: Array<{ endpoint: string; status: number; thrown?: string }> = [];
    const routes = discoverApiRoutes().filter((route) => route.pattern.startsWith("/api/platform/3d"));
    for (const route of routes) {
      const handlers = await loadRouteModule(route);
      const params = Object.fromEntries(route.params.map((name) => [name, `company-supplied-${name}`]));
      for (const method of HTTP_METHODS) {
        const handler = handlers[method];
        if (!handler) continue;
        const path = fillPattern(route.pattern, params);
        const result = await callRoute(handler, method, path, params, { reason: "Company session must be refused" });
        attempts.push({ endpoint: `${method} ${route.pattern}`, status: result.status, thrown: result.thrown });
      }
    }
    expect(attempts.length).toBeGreaterThan(8);
    expect(attempts.filter((attempt) => attempt.status !== 403 || attempt.thrown)).toEqual([]);
  });
});
