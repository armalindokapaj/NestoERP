import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/telemetry/navigation/route";
import { renderPrometheus, resetHistograms, resetMetrics } from "@/lib/core/observability/metrics";
import { resetRateLimits } from "@/lib/core/security/rate-limit";
import { actAs } from "@/tests/security/harness/actor";
import { cleanupSessions, loginAs, prisma } from "@/tests/helpers";

vi.mock("@/lib/context/resolve-user-context", () => import("@/tests/security/harness/actor"));

/** POST /api/telemetry/navigation (NAV-03 TELEMETRY-03; T08, T09, T12). */

afterEach(() => {
  actAs(null);
  resetRateLimits();
  resetMetrics();
  resetHistograms();
  delete process.env.NESTO_NAV_TELEMETRY;
});
afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

const batch = { schemaVersion: 1, events: [{ kind: "navigation", route: "tasks", stage: "primary", navigationKind: "spa", outcome: "success", durationMs: 300 }] };

function send(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return POST(new Request("http://localhost/api/telemetry/navigation", { method: "POST", body: text, headers: { "content-type": "application/json", host: "localhost", origin: "http://localhost", ...headers } }));
}

describe("navigation telemetry ingestion", () => {
  it("accepts a valid batch with 204, no body, private caching, and records it", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    const response = await send(batch);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(renderPrometheus()).toContain('navigation_duration_ms_count{route="tasks",stage="primary",kind="spa"} 1');
  });

  it("refuses a signed-out caller", async () => {
    expect((await send(batch)).status).toBe(401);
  });

  it("refuses a cross-site request", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    expect((await send(batch, { origin: "https://evil.test" })).status).toBe(403);
    expect((await send(batch, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("refuses an oversized body while reading, and echoes nothing of a bad one", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    const large = await send(JSON.stringify({ ...batch, padding: "x".repeat(20_000) }));
    expect(large.status).toBe(413);
    const unknown = await send({ ...batch, events: [{ ...batch.events[0], title: "Secret project" }] });
    expect(unknown.status).toBe(422);
    expect(await unknown.text()).not.toContain("Secret project");
    expect((await send("not json")).status).toBe(422);
  });

  it("allows six batches a minute per session, then 429 with Retry-After (T09)", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    const statuses: number[] = [];
    for (let index = 0; index < 8; index += 1) statuses.push((await send(batch)).status);
    expect(statuses.slice(0, 6).every((status) => status === 204)).toBe(true);
    const refused = await send(batch);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("drops the batch harmlessly when ingestion is switched off (T12)", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    process.env.NESTO_NAV_TELEMETRY = "off";
    expect((await send(batch)).status).toBe(204);
    expect(renderPrometheus()).not.toContain("navigation_duration_ms");
  });
});
