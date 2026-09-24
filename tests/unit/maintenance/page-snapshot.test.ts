import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cacheService from "@/lib/core/cache/cache.service";
import {
  admitPage,
  getMaintenanceState,
  getPageMaintenanceState,
  invalidateMaintenanceSnapshot,
  MaintenanceConfigurationError,
  PAGE_SNAPSHOT_MAX_AGE_MS,
  readMaintenanceState,
  resetMaintenanceSnapshotForTests,
} from "@/lib/core/maintenance/platform-maintenance";
import { runWithRequestScope } from "@/lib/core/observability/request-scope";
import { prisma } from "@/lib/database/prisma";

/**
 * The maintenance page snapshot and its enforcement read (NAV-02 §11, §12,
 * M01-M05, M07, M13-M18). The database is replaced by a controllable reader
 * so ages, races and failures are exact; the platform tests cover the real
 * table and the audited write.
 */

type Row = { key: string; value: unknown; reason: string | null };

let rows: Row[] = [];
let pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
let manual = false;
let reads = 0;

function answer(): Promise<Row[]> {
  reads += 1;
  const snapshot = rows.map((row) => ({ ...row }));
  if (!manual) return Promise.resolve(snapshot);
  return new Promise((resolve, reject) => pending.push({ resolve: () => resolve(snapshot), reject }));
}

function setFlag(key: string, value: unknown, reason: string | null = null) {
  rows = [...rows.filter((row) => row.key !== key), { key, value, reason }];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  rows = [];
  pending = [];
  manual = false;
  reads = 0;
  resetMaintenanceSnapshotForTests();
  vi.spyOn(prisma.platformSetting, "findMany").mockImplementation((() => answer()) as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.NESTO_MAINTENANCE_PAGE_CACHE;
});

describe("the state itself (MAINT-02)", () => {
  it("no rows is the documented default: everything off (M15)", async () => {
    await expect(readMaintenanceState()).resolves.toEqual({ enabled: false, readOnly: false, disableUploads: false, disableNewLogins: false, disable3DProcessing: false, reason: null });
  });

  it("a malformed known value is a configuration failure, never off (M14)", async () => {
    setFlag("maintenance.readOnly", "true");
    await expect(readMaintenanceState()).rejects.toBeInstanceOf(MaintenanceConfigurationError);
  });

  it("the reason follows a fixed precedence, whatever order the rows arrive in (M18)", async () => {
    setFlag("maintenance.disable3DProcessing", true, "3D upgrade");
    setFlag("maintenance.readOnly", true, "Database migration");
    await expect(readMaintenanceState()).resolves.toMatchObject({ readOnly: true, disable3DProcessing: true, reason: "Database migration" });
    setFlag("maintenance.enabled", true, "Full outage");
    await expect(readMaintenanceState()).resolves.toMatchObject({ enabled: true, reason: "Full outage" });
  });
});

describe("page snapshot", () => {
  it("is reused for five seconds with no further read (M01)", async () => {
    await getPageMaintenanceState();
    vi.advanceTimersByTime(PAGE_SNAPSHOT_MAX_AGE_MS - 100);
    const second = await getPageMaintenanceState();
    expect(second.source).toBe("snapshot");
    expect(reads).toBe(1);
  });

  it("an expired snapshot is never served: the next page waits for a fresh read (M02)", async () => {
    await getPageMaintenanceState();
    setFlag("maintenance.enabled", true);
    vi.advanceTimersByTime(PAGE_SNAPSHOT_MAX_AGE_MS + 1);
    const next = await getPageMaintenanceState();
    expect(next.source).toBe("read");
    expect(next.state.enabled).toBe(true);
    expect(reads).toBe(2);
  });

  it("is checked again at admission when authentication outlasted it (M03)", async () => {
    const candidate = getPageMaintenanceState();
    await candidate;
    setFlag("maintenance.readOnly", true);
    vi.advanceTimersByTime(PAGE_SNAPSHOT_MAX_AGE_MS + 1);
    await expect(admitPage(candidate)).resolves.toMatchObject({ readOnly: true });
    expect(reads).toBe(2);
  });

  it("two concurrent misses share one read (M04)", async () => {
    manual = true;
    const first = getPageMaintenanceState();
    const second = getPageMaintenanceState();
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(1);
    pending[0].resolve();
    await Promise.all([first, second]);
    expect(reads).toBe(1);
  });

  it("a read that began before a committed change neither fills the cache nor admits anyone (M05)", async () => {
    manual = true;
    const stale = getPageMaintenanceState();
    await vi.advanceTimersByTimeAsync(0);
    setFlag("maintenance.enabled", true);
    invalidateMaintenanceSnapshot();
    manual = false;
    pending[0].resolve();
    // The old read answered "off"; the caller gets a fresh read instead.
    await expect(stale).resolves.toMatchObject({ state: { enabled: true } });
    const next = await getPageMaintenanceState();
    expect(next.state.enabled).toBe(true);
  });

  it("a read finishing after its five seconds cannot fill the cache (M16)", async () => {
    manual = true;
    const slow = getPageMaintenanceState();
    await vi.advanceTimersByTimeAsync(PAGE_SNAPSHOT_MAX_AGE_MS + 500);
    pending[0].resolve();
    await slow;
    manual = false;
    const next = await getPageMaintenanceState();
    expect(next.source).toBe("read");
    expect(reads).toBe(2);
  });

  it("a database failure with no valid snapshot fails closed, and is not cached (M13)", async () => {
    vi.spyOn(prisma.platformSetting, "findMany").mockRejectedValueOnce(new Error("connection refused") as never);
    await expect(getPageMaintenanceState()).rejects.toThrow("connection refused");
    await expect(getPageMaintenanceState()).resolves.toMatchObject({ source: "read", state: { enabled: false } });
  });

  it("a cache that throws is a miss, answered from the database (M17)", async () => {
    await getPageMaintenanceState();
    vi.spyOn(cacheService, "getCached").mockImplementation(() => {
      throw new Error("cache down");
    });
    const next = await getPageMaintenanceState();
    expect(next.source).toBe("read");
    expect(reads).toBe(2);
  });

  it("an enabled snapshot is confirmed live before anybody is redirected (CACHE-04, M12)", async () => {
    setFlag("maintenance.enabled", true);
    await getPageMaintenanceState();
    setFlag("maintenance.enabled", false);
    // Within the five seconds the snapshot still says enabled; the live check says otherwise.
    const admitted = await runWithRequestScope(() => admitPage(getPageMaintenanceState()));
    expect(admitted.enabled).toBe(false);
  });

  it("the bypass switch reads fresh every time (§20)", async () => {
    process.env.NESTO_MAINTENANCE_PAGE_CACHE = "off";
    await getPageMaintenanceState();
    await getPageMaintenanceState();
    expect(reads).toBe(2);
  });

  it("rapid toggles end on the latest committed state (M18)", async () => {
    for (const value of [true, false, true]) {
      setFlag("maintenance.readOnly", value);
      invalidateMaintenanceSnapshot();
      await expect(getPageMaintenanceState()).resolves.toMatchObject({ state: { readOnly: value } });
    }
  });
});

describe("enforcement read (MAINT-01)", () => {
  it("reads the database for each new request, never a page snapshot (M06)", async () => {
    await getPageMaintenanceState();
    setFlag("maintenance.enabled", true);
    await expect(runWithRequestScope(() => getMaintenanceState())).resolves.toMatchObject({ enabled: true });
    await expect(runWithRequestScope(() => getMaintenanceState())).resolves.toMatchObject({ enabled: true });
    expect(reads).toBe(3);
  });

  it("is shared within one request only", async () => {
    await runWithRequestScope(async () => {
      await Promise.all([getMaintenanceState(), getMaintenanceState()]);
    });
    expect(reads).toBe(1);
  });

  it("does not join a page read already in flight (M07)", async () => {
    manual = true;
    const page = getPageMaintenanceState();
    const api = runWithRequestScope(() => getMaintenanceState());
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);
    pending.forEach((entry) => entry.resolve());
    await Promise.all([page, api]);
  });
});
