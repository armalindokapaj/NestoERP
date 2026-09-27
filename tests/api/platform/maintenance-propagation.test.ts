import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as listTasks, POST as createTask } from "@/app/api/tasks/route";
import { authenticateCredentials } from "@/lib/auth/credentials";
import * as maintenance from "@/lib/core/maintenance/platform-maintenance";
import { counterValue, Metric } from "@/lib/core/observability/metrics";
import { REQUEST_METHOD_HEADER, REQUEST_SIGNATURE_HEADER, signRequestMethod } from "@/lib/core/security/request-method";
import { prisma as app } from "@/lib/database/prisma";
import { maintenanceState } from "@/lib/modules/platform/platform-control.query";
import { saveMaintenanceSetting } from "@/lib/modules/platform/platform-control.service";
import { createProject3DModelUpload } from "@/lib/modules/project-3d/project-3d.ingestion";
import { actAs } from "@/tests/security/harness/actor";
import { DEMO_PASSWORD } from "@/config/demo-accounts";
import { cleanupSessions, demoUsername, loginAs, loginAsPlatformAdmin, prisma } from "@/tests/helpers";

vi.mock("@/lib/context/resolve-user-context", () => import("@/tests/security/harness/actor"));
// The method and path the proxy stamps on a live request, which the gates read.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers, cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));

/** The headers middleware forwards, signed as middleware signs them (AUD-06 §3): an unsigned method reads as a write. */
async function asRequest(method: string, path: string) {
  const signature = await signRequestMethod(method, path);
  request.headers = new Headers({
    [REQUEST_METHOD_HEADER]: method,
    "x-nesto-request-path": path,
    ...(signature ? { [REQUEST_SIGNATURE_HEADER]: signature } : {}),
  });
}

/**
 * Maintenance writes and the gates that enforce them (NAV-02 §11, §12;
 * M08-M11, V01, V05) against the real platform_settings table.
 *
 * Route handlers run for real; only the cookie step of context resolution is
 * replaced by the security harness's actor, as in the API sweeps.
 */

const KEYS = ["maintenance.enabled", "maintenance.readOnly", "maintenance.disableUploads", "maintenance.disableNewLogins", "maintenance.disable3DProcessing"];

let admin: Awaited<ReturnType<typeof loginAsPlatformAdmin>>;

beforeAll(async () => {
  admin = await loginAsPlatformAdmin();
  await prisma.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  actAs(null);
  request.headers = new Headers();
  await prisma.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
  maintenance.resetMaintenanceSnapshotForTests();
});

afterAll(async () => {
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("saving a maintenance setting (CACHE-02)", () => {
  it("commits the policy, then reports page propagation complete; this process's pages see it at once", async () => {
    await maintenance.getPageMaintenanceState();
    const result = await saveMaintenanceSetting(admin, { key: "maintenance.readOnly", enabled: true, reason: "Migration rehearsal" });
    expect(result).toEqual({ ok: true, policyCommitted: true, pageRefresh: "complete" });
    await expect(maintenance.getPageMaintenanceState()).resolves.toMatchObject({ source: "read", state: { readOnly: true, reason: "Migration rehearsal" } });
  });

  it("a rolled-back save reports nothing and leaves the page snapshot as it was (M10)", async () => {
    await maintenance.getPageMaintenanceState();
    vi.spyOn(app, "$transaction").mockRejectedValueOnce(new Error("serialization failure") as never);
    await expect(saveMaintenanceSetting(admin, { key: "maintenance.enabled", enabled: true, reason: "Never committed" })).rejects.toThrow("serialization failure");
    expect(await prisma.platformSetting.count({ where: { key: "maintenance.enabled" } })).toBe(0);
    await expect(maintenance.getPageMaintenanceState()).resolves.toMatchObject({ source: "snapshot", state: { enabled: false } });
  });

  it("a committed save whose page refresh fails says so, and enforcement already sees it (M11)", async () => {
    const before = counterValue(Metric.MAINTENANCE_INVALIDATION_FAILURE);
    vi.spyOn(maintenance, "invalidateMaintenanceSnapshot").mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });
    const result = await saveMaintenanceSetting(admin, { key: "maintenance.disableUploads", enabled: true, reason: "Storage move" });
    expect(result).toEqual({ ok: true, policyCommitted: true, pageRefresh: "pending" });
    expect(counterValue(Metric.MAINTENANCE_INVALIDATION_FAILURE)).toBe(before + 1);
    await expect(maintenance.getMaintenanceState()).resolves.toMatchObject({ disableUploads: true });
  });

  it("with the whole platform in maintenance, the Platform Admin still reads and changes it (M09)", async () => {
    await saveMaintenanceSetting(admin, { key: "maintenance.enabled", enabled: true, reason: "Outage drill" });
    await expect(maintenanceState()).resolves.toMatchObject({ enabled: true });
    await saveMaintenanceSetting(admin, { key: "maintenance.enabled", enabled: false, reason: "Drill over" });
    await expect(maintenanceState()).resolves.toMatchObject({ enabled: false });
  });
});

describe("each switch refuses the next admission it governs (M08)", () => {
  it("maintenance mode refuses tenant APIs, reads included", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    await saveMaintenanceSetting(admin, { key: "maintenance.enabled", enabled: true, reason: "Outage drill" });
    const response = await listTasks(new Request("http://localhost/api/tasks"));
    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toMatch(/maintenance/i);
  });

  it("read-only mode refuses a write and still answers a read", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    await saveMaintenanceSetting(admin, { key: "maintenance.readOnly", enabled: true, reason: "Migration" });
    await asRequest("POST", "/api/tasks");
    const write = await createTask(new Request("http://localhost/api/tasks", { method: "POST", body: "{}" }));
    expect(write.status).toBe(409);
    expect((await write.json()).error.message).toMatch(/read-only/i);
    await asRequest("GET", "/api/tasks");
    const read = await listTasks(new Request("http://localhost/api/tasks"));
    expect(read.status).toBe(200);
  });

  it("disabling uploads refuses an upload and leaves other writes alone", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    await saveMaintenanceSetting(admin, { key: "maintenance.disableUploads", enabled: true, reason: "Storage move" });
    await asRequest("POST", "/api/documents/upload");
    const upload = await createTask(new Request("http://localhost/api/documents/upload", { method: "POST", body: "{}" }));
    expect(upload.status).toBe(409);
    expect((await upload.json()).error.message).toMatch(/uploads/i);
    await asRequest("POST", "/api/tasks");
    const write = await createTask(new Request("http://localhost/api/tasks", { method: "POST", body: "{}" }));
    expect(write.status).not.toBe(409);
  });

  it("disabling new logins refuses sign-in", async () => {
    const credentials = { username: demoUsername("PROJECT_MANAGER"), password: DEMO_PASSWORD };
    const before = await authenticateCredentials(credentials, new Headers());
    expect(before).not.toBeNull();
    await prisma.session.delete({ where: { id: before!.sessionId } });
    await saveMaintenanceSetting(admin, { key: "maintenance.disableNewLogins", enabled: true, reason: "Cut-over" });
    await expect(authenticateCredentials(credentials, new Headers())).resolves.toBeNull();
  });

  it("disabling 3D processing refuses a new model upload", async () => {
    await saveMaintenanceSetting(admin, { key: "maintenance.disable3DProcessing", enabled: true, reason: "Renderer upgrade" });
    await expect(createProject3DModelUpload(admin, "project_a", "any-slot", { fileName: "model.glb", contentType: "model/gltf-binary", sizeBytes: 10, reason: "test" } as never)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("failures before the handler (V01, V05)", () => {
  it("an unauthenticated request is refused as such while a maintenance read fails beside it (V01)", async () => {
    vi.spyOn(app.platformSetting, "findMany").mockRejectedValue(new Error("database down") as never);
    const response = await listTasks(new Request("http://localhost/api/tasks"));
    expect(response.status).toBe(401);
  });

  it("a maintenance read that fails is a sanitized error with a request id, not an unhandled failure (V05)", async () => {
    actAs(await loginAs("PROJECT_MANAGER"));
    vi.spyOn(app.platformSetting, "findMany").mockRejectedValue(new Error("password=hunter2 host=db") as never);
    const response = await listTasks(new Request("http://localhost/api/tasks"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.requestId).toMatch(/^req_/);
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("a context read that throws is a sanitized error too (V05)", async () => {
    const harness = await import("@/tests/security/harness/actor");
    vi.spyOn(harness, "resolveUserContext").mockRejectedValueOnce(new Error("connection reset"));
    const response = await listTasks(new Request("http://localhost/api/tasks"));
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
  });
});
