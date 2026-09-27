import { execFileSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

/**
 * Seed rerun idempotency (AUD-12 DX-10). Opt-in: AUD12_SEED_RERUN=1.
 *
 * A fresh throwaway database (nesto_a12_seed) is migrated with `prisma migrate
 * deploy` and seeded with the repository's seed command (`prisma db seed`).
 * Seeding it a second time must leave the key tables' counts where they were
 * and must not remove a row the seed never wrote. The database is dropped
 * afterwards. Never run against a shared database.
 */

const enabled = process.env.AUD12_SEED_RERUN === "1";
const SERVER = process.env.AUD12_PG_SERVER ?? "postgresql://mnrv@localhost:5432";
const DATABASE = "nesto_a12_seed";
const TABLES = ["users", "parent_groups", "companies", "company_members", "projects", "tasks", "invoices", "documents"];

const url = `${SERVER}/${DATABASE}?schema=public`;
const psql = (database: string, sql: string) =>
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", `${SERVER}/${database}`, "-c", sql], { encoding: "utf8" }).trim();
const env = {
  ...process.env,
  DATABASE_URL: url,
  DIRECT_URL: url,
  NESTO_DISPOSABLE_DATABASES: DATABASE,
  APP_ENV: "development",
  NODE_ENV: "development",
} as NodeJS.ProcessEnv;
const run = (args: string[]) => execFileSync("npx", args, { encoding: "utf8", env, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
const counts = () => Object.fromEntries(TABLES.map((table) => [table, Number(psql(DATABASE, `select count(*) from "${table}"`))]));

afterAll(() => {
  if (enabled) psql("postgres", `drop database if exists ${DATABASE}`);
});

describe.skipIf(!enabled)("the demo seed, run twice (DX-10)", () => {
  it("changes no key table's count the second time, and keeps a row it did not write", () => {
    psql("postgres", `drop database if exists ${DATABASE}`);
    psql("postgres", `create database ${DATABASE}`);
    run(["prisma", "migrate", "deploy"]);
    run(["prisma", "db", "seed"]);

    const first = counts();
    expect(first.users).toBeGreaterThan(0);
    expect(first.companies).toBeGreaterThan(0);
    expect(first.projects).toBeGreaterThan(0);

    // A person nobody seeded: the rerun must leave them alone. (Not a parent
    // group: the seed's validation insists on exactly one visible group.)
    psql(
      DATABASE,
      `insert into "users" (id, "firstName", "lastName", username, "passwordHash", "updatedAt") values ('aud12-bystander', 'AUD-12', 'Bystander', 'aud12.bystander', 'x', now())`,
    );

    run(["prisma", "db", "seed"]);
    const second = counts();

    expect(second).toEqual({ ...first, users: first.users + 1 });
    expect(psql(DATABASE, `select username from "users" where id = 'aud12-bystander'`)).toBe("aud12.bystander");
  }, 1_800_000);
});
