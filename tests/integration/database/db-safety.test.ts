import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseTarget, withDatabase } from "@/lib/core/database/target";

/**
 * AUD-12 §5 against real PostgreSQL (DX-07, DX-08, DX-11).
 *
 * Builds its own two databases on the test server — an "application" one with
 * a sentinel row, and a shadow — then runs the actual `db:drift`,
 * `db:reset:demo` and seed commands against them. Every refusal must leave the
 * sentinel as it was. Only runs where the test database is on this machine.
 */

const base = process.env.DATABASE_URL ?? "";
const local = base !== "" && parseTarget(base).local;
const suffix = randomBytes(4).toString("hex");
const appDb = `aud12_app_${suffix}`;
const shadowDb = `aud12_shadow_${suffix}`;
const appUrl = local ? withDatabase(base, appDb) : "";
const shadowUrl = local ? withDatabase(base, shadowDb) : "";

const admin = new PrismaClient({ datasources: { db: { url: base } }, log: [] });

function run(args: string[], env: Record<string, string | undefined>) {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(DATABASE_URL|DIRECT_URL|POSTGRES_|SHADOW_DATABASE_URL|NESTO_|APP_ENV|VERCEL|CI$)/.test(key)) clean[key] = value;
  }
  for (const [key, value] of Object.entries(env)) if (value !== undefined) clean[key] = value;
  const result = spawnSync("npx", ["tsx", ...args], { env: clean as NodeJS.ProcessEnv, encoding: "utf8", input: "", timeout: 240_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

async function sentinel(): Promise<string | null> {
  const client = new PrismaClient({ datasources: { db: { url: appUrl } }, log: [] });
  try {
    const rows = await client.$queryRawUnsafe<{ note: string }[]>("select note from aud12_sentinel").catch(() => []);
    return rows[0]?.note ?? null;
  } finally {
    await client.$disconnect();
  }
}

async function leftoverRunDatabases(): Promise<string[]> {
  const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(`select datname from pg_database where datname like '${shadowDb}_run_%'`);
  return rows.map((row) => row.datname);
}

describe.skipIf(!local)("database safety commands (AUD-12 §5)", () => {
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`create database "${appDb}"`);
    await admin.$executeRawUnsafe(`create database "${shadowDb}"`);
    const app = new PrismaClient({ datasources: { db: { url: appUrl } }, log: [] });
    await app.$executeRawUnsafe("create table aud12_sentinel (note text not null)");
    await app.$executeRawUnsafe("insert into aud12_sentinel values ('populated application data')");
    await app.$disconnect();
  });

  afterAll(async () => {
    for (const name of [appDb, shadowDb, ...(await leftoverRunDatabases())]) {
      await admin.$executeRawUnsafe(`drop database if exists "${name}" with (force)`);
    }
    await admin.$disconnect();
  });

  describe("db:drift (DX-07)", () => {
    it("refuses without a shadow database, before Prisma starts", async () => {
      const result = run(["scripts/db/drift.ts"], { DATABASE_URL: appUrl, NESTO_DISPOSABLE_DATABASES: appDb });
      expect(result.status).toBe(1);
      expect(result.output).toContain("SHADOW_DATABASE_URL is not set");
      expect(await sentinel()).toBe("populated application data");
    });

    it("refuses the application's own database as the shadow, under any spelling", async () => {
      for (const shadow of [appUrl, appUrl.replace("localhost", "127.0.0.1"), `${appUrl}&connection_limit=1`]) {
        const result = run(["scripts/db/drift.ts"], { DATABASE_URL: appUrl, SHADOW_DATABASE_URL: shadow, NESTO_DISPOSABLE_DATABASES: `${appDb},${shadowDb}` });
        expect(result.status, shadow.replace(/\/\/[^@]*@/, "//…@")).toBe(1);
        expect(result.output).toContain("which the application uses");
      }
      expect(await sentinel()).toBe("populated application data");
    });

    it("refuses a shadow that is not marked disposable", async () => {
      const result = run(["scripts/db/drift.ts"], { DATABASE_URL: appUrl, SHADOW_DATABASE_URL: shadowUrl });
      expect(result.status).toBe(1);
      expect(result.output).toContain("not marked disposable");
    });

    it("never prints credentials when it refuses", () => {
      const withPassword = appUrl.replace("://", "://someone:hunter2@").replace(/:\/\/[^@]*@([^@]*@)/, "://someone:hunter2@");
      const result = run(["scripts/db/drift.ts"], { DATABASE_URL: withPassword, SHADOW_DATABASE_URL: withPassword, NESTO_DISPOSABLE_DATABASES: appDb });
      expect(result.status).toBe(1);
      expect(result.output).not.toContain("hunter2");
    });

    it("with a separate disposable shadow, runs in a database of its own and leaves the application data alone", async () => {
      const result = run(["scripts/db/drift.ts"], { DATABASE_URL: appUrl, SHADOW_DATABASE_URL: shadowUrl, NESTO_DISPOSABLE_DATABASES: shadowDb });
      expect(result.status, result.output.slice(-400)).toBe(0);
      expect(result.output).toContain("no drift");
      expect(await sentinel()).toBe("populated application data");
      // The named shadow is untouched, and the run's own database is gone.
      const shadow = new PrismaClient({ datasources: { db: { url: shadowUrl } }, log: [] });
      const tables = await shadow.$queryRawUnsafe<{ count: bigint }[]>("select count(*) as count from information_schema.tables where table_schema = 'public'");
      await shadow.$disconnect();
      expect(Number(tables[0]!.count)).toBe(0);
      expect(await leftoverRunDatabases()).toEqual([]);
    }, 240_000);
  });

  describe("db:reset:demo (DX-08)", () => {
    it("refuses a database that is not marked disposable", async () => {
      const result = run(["scripts/db/destructive.ts", "reset", "--skip-seed"], { DATABASE_URL: appUrl, CI: "true", NESTO_CONFIRM_DESTRUCTIVE: appDb });
      expect(result.status).toBe(1);
      expect(result.output).toContain("not marked disposable");
      expect(await sentinel()).toBe("populated application data");
    });

    it("refuses production and staging, even for a marked database", async () => {
      for (const env of [{ APP_ENV: "production" }, { APP_ENV: "staging" }, { VERCEL_ENV: "production" }]) {
        const result = run(["scripts/db/destructive.ts", "reset", "--skip-seed"], { DATABASE_URL: appUrl, NESTO_DISPOSABLE_DATABASES: appDb, CI: "true", NESTO_CONFIRM_DESTRUCTIVE: appDb, ...env });
        expect(result.status, JSON.stringify(env)).toBe(1);
      }
      expect(await sentinel()).toBe("populated application data");
    });

    it("refuses a remote database whatever the environment says", async () => {
      const result = run(["scripts/db/destructive.ts", "reset", "--skip-seed"], {
        DATABASE_URL: `postgresql://u:secret@db.example.invalid:5432/${appDb}`,
        NESTO_DISPOSABLE_DATABASES: appDb,
        APP_ENV: "development",
        CI: "true",
        NESTO_CONFIRM_DESTRUCTIVE: appDb,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("not on this machine");
      expect(result.output).not.toContain("secret");
    });

    it("refuses without confirmation when nobody is at a terminal", async () => {
      for (const env of [{}, { CI: "true" }, { CI: "true", NESTO_CONFIRM_DESTRUCTIVE: "another_database" }, { NESTO_CONFIRM_DESTRUCTIVE: appDb }]) {
        const result = run(["scripts/db/destructive.ts", "reset", "--skip-seed"], { DATABASE_URL: appUrl, NESTO_DISPOSABLE_DATABASES: appDb, ...env });
        expect(result.status, JSON.stringify(env)).toBe(1);
        expect(result.output).toContain("no terminal to confirm at");
      }
      expect(await sentinel()).toBe("populated application data");
    });

    it("refuses when DATABASE_URL and DIRECT_URL name different databases", async () => {
      const result = run(["scripts/db/destructive.ts", "reset", "--skip-seed"], { DATABASE_URL: appUrl, DIRECT_URL: shadowUrl, NESTO_DISPOSABLE_DATABASES: `${appDb},${shadowDb}`, CI: "true", NESTO_CONFIRM_DESTRUCTIVE: appDb });
      expect(result.status).toBe(1);
      expect(await sentinel()).toBe("populated application data");
    });

    it("resets a marked, local, confirmed database — the documented CI path", async (ctx) => {
      const result = run(["scripts/db/destructive.ts", "reset", "--skip-seed"], { DATABASE_URL: appUrl, NESTO_DISPOSABLE_DATABASES: appDb, CI: "true", NESTO_CONFIRM_DESTRUCTIVE: appDb });
      expect(result.output).not.toContain("db:reset refused");
      if (result.output.includes("PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION")) {
        // Our guard let it through; Prisma's own guard then refused, because
        // it detected an AI agent running it. That consent is a person's to
        // give, so the reset itself is left to CI or a person's terminal.
        expect(await sentinel()).toBe("populated application data");
        ctx.skip("Prisma refuses migrate reset under an AI agent without the user's consent");
      }
      expect(result.status, result.output.slice(-400)).toBe(0);
      // Reset drops everything: the sentinel went with it, the migrations are in.
      expect(await sentinel()).toBeNull();
      const app = new PrismaClient({ datasources: { db: { url: appUrl } }, log: [] });
      const applied = await app.$queryRawUnsafe<{ count: bigint }[]>("select count(*) as count from _prisma_migrations");
      await app.$disconnect();
      expect(Number(applied[0]!.count)).toBeGreaterThan(0);
    }, 240_000);
  });

  describe("the demo seed (DX-11)", () => {
    it("refuses a remote database the seed target does not name, before connecting", () => {
      const result = run(["prisma/seed.ts"], { DATABASE_URL: "postgresql://u:secret@db.example.invalid:5432/demo", APP_ENV: "demo", NESTO_DEMO_PASSWORD: "x" });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("Refusing to seed demo data");
      expect(result.output).not.toContain("secret");
    });

    it("refuses production even when the target is named and ALLOW_DEMO_SEED is set", () => {
      const result = run(["prisma/seed.ts"], {
        DATABASE_URL: "postgresql://u:secret@db.example.invalid:5432/demo",
        NESTO_SEED_TARGET: "db.example.invalid/demo",
        APP_ENV: "production",
        ALLOW_DEMO_SEED: "true",
        NESTO_DEMO_PASSWORD: "x",
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("the environment is production");
    });

    it("refuses the ARMAAR seed the same way", () => {
      const result = run(["prisma/seed/armaar/index.ts"], { DATABASE_URL: "postgresql://u:secret@db.example.invalid:5432/demo", VERCEL_ENV: "production" });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("Refusing to seed demo data");
    });
  });
});
