import { describe, expect, it } from "vitest";

import {
  createMenuCache,
  isInternalAppPath,
  isMenuDTO,
  MENU_CAPACITY,
  MENU_TTL_MS,
  menuPathname,
  type MenuLoad,
} from "@/lib/modules/quick-create/menu-cache";
import type { QuickCreateMenuDTO } from "@/lib/modules/quick-create/quick-create.service";

/**
 * The `+ Create` menu cache (NAV-01 QC-07..QC-09): 30 s, 10 entries, one
 * request per key, context isolation, and late answers that never land.
 */

const menu = (contextKey: string, keys: string[] = ["tasks.task.create"]): QuickCreateMenuDTO => ({
  actions: keys.map((key) => ({ key, label: key, group: "GENERAL", icon: "Plus", keywords: [], companies: null, ownership: "COMPANY", needsProject: false })) as QuickCreateMenuDTO["actions"],
  workspace: { scopeType: "COMPANY", company: { id: "c1", name: "C1" } },
  context: null,
  contextKey,
});

function deferred() {
  let resolve!: (value: MenuLoad) => void;
  const promise = new Promise<MenuLoad>((done) => (resolve = done));
  return { promise, resolve };
}

function harness(contextKey = "ctx-1") {
  let now = 0;
  const calls: Array<{ pathname: string; signal: AbortSignal; reply: ReturnType<typeof deferred> }> = [];
  const cache = createMenuCache({
    now: () => now,
    fetcher: (pathname, signal) => {
      const reply = deferred();
      calls.push({ pathname, signal, reply });
      return reply.promise;
    },
  });
  cache.setContext(contextKey);
  return { cache, calls, tick: (ms: number) => (now += ms) };
}

describe("keys (QC-07)", () => {
  it("strips the query and hash, and keeps the record path whole", () => {
    expect(menuPathname("/projects/p1/units?floor=2#x")).toBe("/projects/p1/units");
    expect(menuPathname("")).toBe("/");
    expect(menuPathname(null)).toBe("/");
  });

  it("never serves one project's menu on another project's page", async () => {
    const { cache, calls } = harness();
    const a = cache.load("/projects/a");
    calls[0].reply.resolve({ ok: true, menu: menu("ctx-1") });
    await a;
    expect(cache.peek("/projects/a")).not.toBeNull();
    expect(cache.peek("/projects/b")).toBeNull();
  });
});

describe("reuse and freshness (QC-07, Q07, Q08)", () => {
  it("reuses a fresh answer with no second request, and a legitimate empty menu too", async () => {
    const { cache, calls } = harness();
    const first = cache.load("/dashboard");
    calls[0].reply.resolve({ ok: true, menu: menu("ctx-1", []) });
    expect((await first).ok).toBe(true);
    const again = await cache.load("/dashboard");
    expect(calls).toHaveLength(1);
    expect(again).toMatchObject({ ok: true, menu: { actions: [] } });
  });

  it("does not hand out an entry once 30 s have passed", async () => {
    const { cache, calls, tick } = harness();
    const first = cache.load("/dashboard");
    calls[0].reply.resolve({ ok: true, menu: menu("ctx-1") });
    const loaded = await first;
    tick(MENU_TTL_MS - 1);
    expect(cache.isFresh("/dashboard", (loaded as { menu: QuickCreateMenuDTO }).menu)).toBe(true);
    tick(1);
    expect(cache.isFresh("/dashboard", (loaded as { menu: QuickCreateMenuDTO }).menu)).toBe(false);
    expect(cache.peek("/dashboard")).toBeNull();
    void cache.load("/dashboard");
    expect(calls).toHaveLength(2);
  });

  it("never stores a failure", async () => {
    const { cache, calls } = harness();
    const first = cache.load("/dashboard");
    calls[0].reply.resolve({ ok: false, reason: "failed" });
    expect(await first).toEqual({ ok: false, reason: "failed" });
    expect(cache.size).toBe(0);
    void cache.load("/dashboard");
    expect(calls).toHaveLength(2);
  });

  it("holds at most 10 entries, the least recently used going first", async () => {
    const { cache, calls, tick } = harness();
    for (let index = 0; index <= MENU_CAPACITY; index += 1) {
      const load = cache.load(`/p/${index}`);
      calls[index].reply.resolve({ ok: true, menu: menu("ctx-1") });
      await load;
      tick(1);
      if (index === 0) continue;
      cache.peek("/p/0"); // keep /p/0 in use
    }
    expect(cache.size).toBe(MENU_CAPACITY);
    expect(cache.peek("/p/0")).not.toBeNull();
    expect(cache.peek("/p/1")).toBeNull();
  });
});

describe("one request, and answers that belong (QC-09, Q09, Q11-Q13, Q15)", () => {
  it("joins repeated opens to the one request in flight", async () => {
    const { cache, calls } = harness();
    const a = cache.load("/dashboard");
    const b = cache.load("/dashboard");
    expect(calls).toHaveLength(1);
    calls[0].reply.resolve({ ok: true, menu: menu("ctx-1") });
    expect(await a).toEqual(await b);
  });

  it("drops an answer that lands after a cancel, and a reopen asks again", async () => {
    const { cache, calls } = harness();
    const first = cache.load("/dashboard");
    cache.cancel();
    expect(calls[0].signal.aborted).toBe(true);
    const second = cache.load("/dashboard");
    expect(calls).toHaveLength(2);
    // The first fetch completed anyway: it must not land.
    calls[0].reply.resolve({ ok: true, menu: menu("ctx-1", ["stale.action"]) });
    expect(await first).toEqual({ ok: false, reason: "superseded" });
    calls[1].reply.resolve({ ok: true, menu: menu("ctx-1", ["fresh.action"]) });
    expect(await second).toMatchObject({ ok: true, menu: { actions: [{ key: "fresh.action" }] } });
  });

  it("drops everything when the context changes, in flight included", async () => {
    const { cache, calls } = harness();
    const warm = cache.load("/dashboard");
    calls[0].reply.resolve({ ok: true, menu: menu("ctx-1") });
    await warm;
    const late = cache.load("/tasks");
    cache.setContext("ctx-2");
    expect(cache.peek("/dashboard")).toBeNull();
    calls[1].reply.resolve({ ok: true, menu: menu("ctx-1") });
    expect(await late).toEqual({ ok: false, reason: "superseded" });
    expect(cache.size).toBe(0);
  });

  it("refuses a menu drawn for another context key, and does not store it", async () => {
    const { cache, calls } = harness("ctx-1");
    const load = cache.load("/dashboard");
    calls[0].reply.resolve({ ok: true, menu: menu("ctx-other") });
    expect(await load).toEqual({ ok: false, reason: "context-changed" });
    expect(cache.size).toBe(0);
  });
});

describe("response shape and launch targets (§12, QC-04, QC-10)", () => {
  it("tells a menu from a malformed body", () => {
    expect(isMenuDTO(menu("k"))).toBe(true);
    expect(isMenuDTO({ actions: [] })).toBe(false);
    expect(isMenuDTO({ ...menu("k"), actions: [{ key: 1 }] })).toBe(false);
    expect(isMenuDTO(null)).toBe(false);
  });

  it("opens only internal application paths", () => {
    expect(isInternalAppPath("/tasks/new?projectId=p1")).toBe(true);
    for (const bad of ["https://evil.test/x", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/api/quick-create/actions", "/platform-admin", "tasks/new", 42]) {
      expect(isInternalAppPath(bad)).toBe(false);
    }
  });
});
