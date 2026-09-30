import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { minimumSyncProtocolVersion, isAutomaticallyRetryable, SYNC_PROTOCOL_VERSION } from "@/lib/core/sync/protocol";
import { ConnectivityService } from "@/lib/offline/connectivity";
import { OfflineDatabase } from "@/lib/offline/database";
import { backoffDelay, classifyHttp, MAX_AUTOMATIC_RETRIES, needsAttention } from "@/lib/offline/errors";
import { validateHseReport, UNSENT_NOTICE, isSerious } from "@/lib/offline/modules/hse";
import { enqueue, isBlocked, selectReady } from "@/lib/offline/queue";
import { authorizationState, otherAccountsWithPending, recordPending } from "@/lib/offline/security";
import type { MutationRecord } from "@/lib/offline/types";

/** The small decisions the offline layer rests on (MOB-09 §32, §33, §62, §73, §85, §86, §109). */

describe("error classes and retry (§85, §86)", () => {
  it("maps what the server answers to the class that decides what happens next", () => {
    const body = (code: string) => ({ error: { code, message: "m" } });
    expect(classifyHttp(0, null).errorType).toBe("NETWORK");
    expect(classifyHttp(401, body("UNAUTHENTICATED")).errorType).toBe("AUTH");
    expect(classifyHttp(426, null).errorType).toBe("UNSUPPORTED_VERSION");
    expect(classifyHttp(403, body("FORBIDDEN")).errorType).toBe("PERMISSION");
    expect(classifyHttp(404, body("NOT_FOUND")).errorType).toBe("PERMISSION");
    expect(classifyHttp(409, body("CONFLICT")).errorType).toBe("CONFLICT");
    expect(classifyHttp(409, body("WORKSPACE_COMPANY_REQUIRED")).errorType).toBe("AUTH");
    expect(classifyHttp(422, body("VALIDATION_ERROR")).errorType).toBe("VALIDATION");
    expect(classifyHttp(503, body("TEMPORARILY_UNAVAILABLE")).errorType).toBe("SERVER_TEMPORARY");
    expect(classifyHttp(500, null).errorType).toBe("SERVER_TEMPORARY");
  });

  it("retries only what comes back by itself", () => {
    expect(isAutomaticallyRetryable("NETWORK")).toBe(true);
    expect(isAutomaticallyRetryable("SERVER_TEMPORARY")).toBe(true);
    for (const stop of ["PERMISSION", "VALIDATION", "CONFLICT", "AUTH", "UNSUPPORTED_VERSION", "FILE_ERROR"] as const) expect(isAutomaticallyRetryable(stop)).toBe(false);
    expect(needsAttention("PERMISSION")).toBe(true);
    expect(needsAttention("NETWORK")).toBe(false);
  });

  it("backs off exponentially with jitter, capped, and never retries for ever", () => {
    const steady = () => 0.5;
    const delays = [0, 1, 2, 3, 4].map((n) => backoffDelay(n, steady));
    expect(delays).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(backoffDelay(40, steady)).toBe(5 * 60_000);
    expect(backoffDelay(3, () => 0)).toBeLessThan(backoffDelay(3, () => 1));
    expect(MAX_AUTOMATIC_RETRIES).toBeLessThan(20);
  });
});

describe("the sync protocol minimum (§109)", () => {
  it("defaults to 1, honours configuration, and never exceeds what this server speaks", () => {
    expect(minimumSyncProtocolVersion({})).toBe(1);
    expect(minimumSyncProtocolVersion({ NESTO_MIN_SYNC_PROTOCOL_VERSION: "nonsense" })).toBe(1);
    expect(minimumSyncProtocolVersion({ NESTO_MIN_SYNC_PROTOCOL_VERSION: "1" })).toBe(1);
    expect(minimumSyncProtocolVersion({ NESTO_MIN_SYNC_PROTOCOL_VERSION: "99" })).toBe(SYNC_PROTOCOL_VERSION);
  });
});

describe("queue selection (§34)", () => {
  const row = (over: Partial<MutationRecord>): MutationRecord => ({ id: "a", userId: "u", companyId: "c", projectId: "p", type: "TASK_COMMENT_CREATE", targetType: "Task", targetId: "t", dependsOn: [], state: "PENDING", retryCount: 0, nextAttemptAt: 0, createdAt: 1, sealed: undefined as never, ...over });

  it("waits for dependencies that are still in the queue, and treats a missing one as applied", () => {
    const create = row({ id: "create", type: "SITE_DIARY_CREATE", targetId: "local:x" });
    const entry = row({ id: "entry", type: "SITE_DIARY_ADD_ENTRY", targetId: "local:x", dependsOn: ["create"], createdAt: 2 });
    expect(selectReady([create, entry], 10).map((r) => r.id)).toEqual(["create"]);
    expect(selectReady([entry], 10).map((r) => r.id)).toEqual(["entry"]);
  });

  it("does not select a change before its back-off has passed, or one already being sent", () => {
    expect(selectReady([row({ nextAttemptAt: 100 })], 50)).toHaveLength(0);
    expect(selectReady([row({ nextAttemptAt: 100 })], 100)).toHaveLength(1);
    expect(selectReady([row({ id: "b", state: "SYNCING" }), row({ id: "c", type: "SITE_DIARY_SUBMIT", targetId: "t", createdAt: 5 })], 10)).toHaveLength(0);
  });

  it("sends one versioned change per record per round, after the plain ones", () => {
    const entry = row({ id: "entry", type: "SITE_DIARY_ADD_ENTRY", targetId: "d" });
    const update = row({ id: "update", type: "SITE_DIARY_UPDATE_DRAFT", targetId: "d", createdAt: 2 });
    const submit = row({ id: "submit", type: "SITE_DIARY_SUBMIT", targetId: "d", createdAt: 3 });
    expect(selectReady([entry, update, submit], 10).map((r) => r.id)).toEqual(["entry"]);
    expect(selectReady([update, submit], 10).map((r) => r.id)).toEqual(["update"]);
    expect(selectReady([submit], 10).map((r) => r.id)).toEqual(["submit"]);
  });

  it("a failed earlier change blocks what depends on it, but not an unrelated edit", () => {
    const failed = row({ id: "photo", type: "ATTACHMENT_CREATE", targetId: "d", state: "FAILED" });
    const submit = row({ id: "submit", type: "SITE_DIARY_SUBMIT", targetId: "d", dependsOn: ["photo"], createdAt: 2 });
    const update = row({ id: "update", type: "SITE_DIARY_UPDATE_DRAFT", targetId: "d", createdAt: 3 });
    expect(isBlocked(submit, [failed, submit, update])).toBe(true);
    expect(isBlocked(update, [failed, submit, update])).toBe(false);
    expect(selectReady([failed, update], 10).map((r) => r.id)).toEqual(["update"]);
  });
});

describe("the offline authorisation window (§61, §62, §73)", () => {
  async function dbWith(validatedAt: string, expiresAt: string) {
    const db = await OfflineDatabase.openFor("u1", new IDBFactory());
    await db.setMeta("authorization", { validatedAt, offlineAccessExpiresAt: expiresAt, user: { userId: "u1", fullName: "U" }, workspace: { companyId: "c1" }, permissions: ["task.view"] });
    return db;
  }

  it("is open inside the window and locks after it, keeping what was agreed", async () => {
    const db = await dbWith("2026-09-30T10:00:00Z", "2026-10-03T10:00:00Z");
    const inside = await authorizationState(db, new Date("2026-10-01T10:00:00Z").getTime());
    expect(inside).toMatchObject({ known: true, expired: false, locked: false, permissions: ["task.view"] });
    const after = await authorizationState(db, new Date("2026-10-04T10:00:00Z").getTime());
    expect(after).toMatchObject({ expired: true, locked: true });
  });

  it("winding the phone's clock back does not extend access", async () => {
    const db = await dbWith("2026-09-30T10:00:00Z", "2026-10-03T10:00:00Z");
    await authorizationState(db, new Date("2026-10-05T10:00:00Z").getTime());
    const rewound = await authorizationState(db, new Date("2026-09-30T12:00:00Z").getTime());
    expect(rewound.locked).toBe(true);
  });

  it("an unknown device has nothing to lock", async () => {
    const db = await OfflineDatabase.openFor("u2", new IDBFactory());
    expect(await authorizationState(db)).toMatchObject({ known: false, locked: false });
  });
});

describe("who has unsynced work on this device (§98)", () => {
  it("counts other accounts' work, not the current person's", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    recordPending("a", 3);
    recordPending("b", 2);
    expect(otherAccountsWithPending("a")).toBe(2);
    recordPending("b", 0);
    expect(otherAccountsWithPending("a")).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe("connectivity (§24, §25, §138)", () => {
  it("is offline when the server cannot be reached, and announces the restoration once", async () => {
    let reachable = false;
    const service = new ConnectivityService(async () => reachable);
    const seen: boolean[] = [];
    service.subscribe(() => seen.push(service.getSnapshot().online));
    await service.check();
    expect(service.getSnapshot().online).toBe(false);
    reachable = true;
    await service.check();
    await service.check();
    expect(service.getSnapshot()).toMatchObject({ online: true, restorations: 1 });
    expect(seen).toEqual([false, true]);
  });

  it("believes a request that failed like an unreachable server", () => {
    const service = new ConnectivityService(async () => true);
    service.reportUnreachable();
    expect(service.getSnapshot().online).toBe(false);
  });
});

describe("HSE reports offline (§49, §50)", () => {
  const base = { incidentType: "INCIDENT" as const, severity: "LOW" as const, title: "Loose board", description: "Not clipped.", occurredAt: "2026-09-30T10:00:00Z" };

  it("applies the service's rules first", () => {
    const now = new Date("2026-09-30T12:00:00Z").getTime();
    expect(validateHseReport(base, now)).toEqual({ ok: true });
    expect(validateHseReport({ ...base, title: "x" }, now)).toMatchObject({ ok: false, field: "title" });
    expect(validateHseReport({ ...base, occurredAt: "2026-10-05T10:00:00Z" }, now)).toMatchObject({ ok: false, field: "occurredAt" });
    expect(validateHseReport({ ...base, severity: "CRITICAL" }, now)).toMatchObject({ ok: false, field: "immediateAction" });
    expect(validateHseReport({ ...base, severity: "CRITICAL", immediateAction: "Area closed" }, now)).toEqual({ ok: true });
  });

  it("does not refuse a report because the phone's clock is a few minutes ahead", () => {
    const now = new Date("2026-09-30T10:00:00Z").getTime();
    expect(validateHseReport({ ...base, occurredAt: "2026-09-30T10:05:00Z" }, now)).toEqual({ ok: true });
  });

  it("knows what is serious, and says the report has not reached the server", () => {
    expect(isSerious("HIGH")).toBe(true);
    expect(isSerious("LOW")).toBe(false);
    expect(UNSENT_NOTICE).toMatch(/NOT reached the server/);
  });
});

describe("identity on the queue (§99)", () => {
  it("records who made a change and never gives it to anyone else", async () => {
    const factory = new IDBFactory();
    const a = await OfflineDatabase.openFor("userA", factory);
    const record = await enqueue(a, { type: "TASK_COMMENT_CREATE", companyId: "c", projectId: "p", targetType: "Task", targetId: "t", label: "x", payload: { body: "hi" } });
    expect(record.userId).toBe("userA");
    const b = await OfflineDatabase.openFor("userB", factory);
    expect(await b.listMutationRecords()).toHaveLength(0);
  });
});
