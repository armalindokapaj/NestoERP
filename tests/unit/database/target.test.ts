import { describe, expect, it } from "vitest";

import {
  applicationTargets,
  checkDestructiveTarget,
  checkSeedTarget,
  checkShadowTarget,
  environmentOf,
  parseTarget,
  probeDistinct,
  withDatabase,
  type ServerIdentity,
} from "@/lib/core/database/target";

/**
 * AUD-12 §5 — the rules every destructive database command asks before it
 * starts (DX-07, DX-08, DX-11). The scripts that apply them run against real
 * databases in tests/integration/database/db-safety.test.ts.
 */

const LOCAL = "postgresql://dev:secret@localhost:5432/nesto_scratch?schema=public";
const REMOTE = "postgresql://postgres.abc:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

describe("reading a target", () => {
  it("normalises every loopback spelling, the default port and schema", () => {
    const keys = [
      "postgresql://a@localhost/nesto_scratch",
      "postgresql://b:x@127.0.0.1:5432/nesto_scratch?schema=public",
      "postgres://c@[::1]:5432/nesto_scratch",
      "postgresql://d@localhost/nesto_scratch?host=/tmp",
    ].map((url) => parseTarget(url).key);
    expect(new Set(keys).size).toBe(1);
    expect(parseTarget(LOCAL).local).toBe(true);
    expect(parseTarget(REMOTE).local).toBe(false);
  });

  it("tells schemas and ports apart", () => {
    expect(parseTarget(`${LOCAL}`).key).not.toBe(parseTarget(LOCAL.replace("schema=public", "schema=other")).key);
    expect(parseTarget(LOCAL).key).not.toBe(parseTarget(LOCAL.replace(":5432", ":5433")).key);
  });

  it("never puts a credential in a label or an error", () => {
    expect(parseTarget(LOCAL).label).not.toContain("secret");
    expect(parseTarget(REMOTE).label).not.toContain("secret");
    expect(() => parseTarget("mysql://root:secret@localhost/x")).toThrow(/PostgreSQL/);
    expect(() => parseTarget("not a url secret")).toThrow(/cannot be read/);
  });

  it("keeps credentials when naming another database on the same server", () => {
    expect(withDatabase(LOCAL, "nesto_scratch_run_1")).toBe("postgresql://dev:secret@localhost:5432/nesto_scratch_run_1?schema=public");
  });
});

describe("the environment", () => {
  it("prefers APP_ENV, then Vercel's, then Node's", () => {
    expect(environmentOf({ APP_ENV: "demo", VERCEL_ENV: "production", NODE_ENV: "production" })).toBe("demo");
    expect(environmentOf({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe("production");
    expect(environmentOf({ VERCEL_ENV: "preview" })).toBe("staging");
    expect(environmentOf({ NODE_ENV: "test" })).toBe("test");
    expect(environmentOf({})).toBe("development");
  });
});

describe("destructive commands (DX-08)", () => {
  const disposable = { NESTO_DISPOSABLE_DATABASES: "nesto_scratch, nesto_other" };

  it("run only against a local database marked disposable", () => {
    expect(checkDestructiveTarget(parseTarget(LOCAL), { ...disposable, NODE_ENV: "development" })).toEqual({ ok: true });
  });

  it("refuse an unmarked local database", () => {
    const verdict = checkDestructiveTarget(parseTarget(LOCAL), { NODE_ENV: "development" });
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/not marked disposable/);
  });

  it("refuse a remote database whatever the label says", () => {
    const verdict = checkDestructiveTarget(parseTarget(REMOTE.replace("/postgres", "/nesto_scratch")), { ...disposable, APP_ENV: "development" });
    expect(!verdict.ok && verdict.reason).toMatch(/not on this machine/);
  });

  it("refuse production and staging even for a marked local database", () => {
    for (const env of [{ APP_ENV: "production" }, { APP_ENV: "staging" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { NODE_ENV: "production" }]) {
      const verdict = checkDestructiveTarget(parseTarget(LOCAL), { ...disposable, ...env });
      expect(verdict.ok, JSON.stringify(env)).toBe(false);
    }
  });
});

describe("the shadow database (DX-07)", () => {
  const env = { NESTO_DISPOSABLE_DATABASES: "nesto_shadow", DATABASE_URL: LOCAL };
  const shadow = parseTarget("postgresql://dev@localhost/nesto_shadow");

  it("is refused when it is the application's database, under any spelling", () => {
    const same = parseTarget("postgresql://other@127.0.0.1:5432/nesto_scratch");
    const verdict = checkShadowTarget(same, applicationTargets(env), { NESTO_DISPOSABLE_DATABASES: "nesto_scratch" });
    expect(!verdict.ok && verdict.reason).toMatch(/which the application uses/);
  });

  it("is refused in another schema of the application's database", () => {
    const otherSchema = parseTarget(`${LOCAL.replace("schema=public", "schema=shadow")}`);
    const verdict = checkShadowTarget(otherSchema, applicationTargets(env), { NESTO_DISPOSABLE_DATABASES: "nesto_scratch" });
    expect(verdict.ok).toBe(false);
  });

  it("must be marked disposable and local", () => {
    expect(checkShadowTarget(shadow, applicationTargets(env), env)).toEqual({ ok: true });
    expect(checkShadowTarget(shadow, applicationTargets(env), { DATABASE_URL: LOCAL }).ok).toBe(false);
    expect(checkShadowTarget(parseTarget(REMOTE.replace("/postgres", "/nesto_shadow")), [], env).ok).toBe(false);
  });

  it("is refused when the server says it is the application's database under another name", async () => {
    const same: ServerIdentity = { database: "nesto_scratch", address: "127.0.0.1", port: 5432, system: "7300" };
    const probe = { identity: async () => same, tableCount: async () => 0 };
    const verdict = await probeDistinct("postgresql://x@localhost:6432/nesto_scratch", [LOCAL], probe);
    expect(!verdict.ok && verdict.reason).toMatch(/same database as an application URL/);
  });

  it("passes when the server says it is a different database", async () => {
    let call = 0;
    const probe = {
      identity: async (): Promise<ServerIdentity> => (call++ === 0 ? { database: "nesto_shadow", address: "127.0.0.1", port: 5432, system: "7300" } : { database: "nesto_scratch", address: "127.0.0.1", port: 5432, system: "7300" }),
      tableCount: async () => 0,
    };
    expect(await probeDistinct("postgresql://x@localhost/nesto_shadow", [LOCAL], probe)).toEqual({ ok: true });
  });
});

describe("the demo seed (DX-11)", () => {
  const remote = parseTarget("postgresql://u:secret@db.example.com:5432/demo");

  it("seeds this machine outside production", () => {
    expect(checkSeedTarget(parseTarget(LOCAL), { NODE_ENV: "development" })).toEqual({ ok: true });
  });

  it("seeds a remote database only when NESTO_SEED_TARGET names it", () => {
    expect(checkSeedTarget(remote, { APP_ENV: "demo" }).ok).toBe(false);
    expect(checkSeedTarget(remote, { APP_ENV: "demo", NESTO_SEED_TARGET: "db.example.com/other" }).ok).toBe(false);
    expect(checkSeedTarget(remote, { APP_ENV: "demo", NESTO_SEED_TARGET: "db.example.com/demo" })).toEqual({ ok: true });
  });

  it("never seeds production or staging, even when named", () => {
    for (const env of [{ APP_ENV: "production" }, { APP_ENV: "staging" }, { VERCEL_ENV: "production" }]) {
      expect(checkSeedTarget(remote, { ...env, NESTO_SEED_TARGET: "db.example.com/demo" }).ok, JSON.stringify(env)).toBe(false);
      expect(checkSeedTarget(parseTarget(LOCAL), env).ok).toBe(false);
    }
  });
});
