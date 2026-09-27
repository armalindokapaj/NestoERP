import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * Migration replay (AUD-12 DX-09). Opt-in: AUD12_MIGRATION_REPLAY=1.
 *
 * 1. From empty: every migration applies in order with `prisma migrate
 *    deploy`, the ledger records each one, and no applied migration.sql has
 *    been edited since (Prisma's checksum is the SHA-256 of the file).
 * 2. From a prior release: a database migrated up to an earlier point, with
 *    rows in it, takes the rest of the migrations and keeps those rows.
 *
 * Runs only against throwaway databases it creates and drops on this machine
 * (nesto_a12_replay, nesto_a12_upgrade). Never `migrate dev`/`reset`/`push`.
 */

const enabled = process.env.AUD12_MIGRATION_REPLAY === "1";
const SERVER = process.env.AUD12_PG_SERVER ?? "postgresql://mnrv@localhost:5432";
const REPLAY = "nesto_a12_replay";
const UPGRADE = "nesto_a12_upgrade";
/** How many of the newest migrations the upgrade case holds back. */
const HELD_BACK = 6;

const url = (database: string) => `${SERVER}/${database}?schema=public`;
const psql = (database: string, sql: string) =>
  execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", `${SERVER}/${database}`, "-c", sql], { encoding: "utf8" }).trim();
const recreate = (database: string) => {
  psql("postgres", `drop database if exists ${database}`);
  psql("postgres", `create database ${database}`);
};
const deploy = (database: string, schema = "prisma/schema.prisma") =>
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", schema], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: url(database), DIRECT_URL: url(database) },
    stdio: "pipe",
  });

const MIGRATIONS = "prisma/migrations";
const migrationDirs = () =>
  readdirSync(MIGRATIONS)
    .filter((entry) => statSync(path.join(MIGRATIONS, entry)).isDirectory())
    .sort();
const checksum = (dir: string) => createHash("sha256").update(readFileSync(path.join(MIGRATIONS, dir, "migration.sql"))).digest("hex");

const scratch: string[] = [];
afterAll(() => {
  if (!enabled) return;
  for (const database of [REPLAY, UPGRADE]) psql("postgres", `drop database if exists ${database}`);
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!enabled)("migration replay from empty (DX-09)", () => {
  it("applies every migration, records each, and none was edited after it shipped", () => {
    recreate(REPLAY);
    deploy(REPLAY);

    const dirs = migrationDirs();
    const rows = psql(REPLAY, "select migration_name || '|' || checksum || '|' || (finished_at is not null) || '|' || (rolled_back_at is null) from _prisma_migrations order by migration_name")
      .split("\n")
      .map((line) => line.split("|"));

    expect(rows.map(([name]) => name)).toEqual(dirs);
    expect(rows.filter(([, , finished, live]) => finished !== "true" || live !== "true").map(([name]) => name)).toEqual([]);
    const edited = rows.filter(([name, sum]) => sum !== checksum(name)).map(([name]) => name);
    expect(edited, "migration.sql changed after it was applied; add a new migration instead").toEqual([]);

    // Running it again is a no-op, not an error.
    expect(deploy(REPLAY)).toMatch(/No pending migrations to apply/);
  }, 600_000);
});

/** A value of the right type for a NOT NULL column with no default. */
function literalFor(dataType: string, udt: string, database: string, tag: string): string {
  if (dataType === "USER-DEFINED") return `'${psql(database, `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = '${udt}' order by enumsortorder limit 1`)}'::"${udt}"`;
  if (/char|text/.test(dataType)) return `'${tag}'`;
  if (/timestamp|date/.test(dataType)) return "now()";
  if (dataType === "boolean") return "false";
  if (/int|numeric|double|real/.test(dataType)) return "1";
  if (/json/.test(dataType)) return "'{}'";
  if (dataType === "ARRAY") return "'{}'";
  throw new Error(`no probe value for ${dataType}`);
}

function insertProbe(database: string, table: string, id: string, fixed: Record<string, string> = {}): void {
  const columns = psql(
    database,
    `select column_name || '|' || data_type || '|' || udt_name from information_schema.columns where table_schema = 'public' and table_name = '${table}' and is_nullable = 'NO' and column_default is null`,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("|"));
  if (columns.length === 0) throw new Error(`table ${table} not found, or has no required columns`);
  const names = columns.map(([name]) => `"${name}"`);
  const values = columns.map(([name, type, udt]) => (name === "id" ? `'${id}'` : fixed[name] ? `'${fixed[name]}'` : literalFor(type, udt, database, `${id}-${name}`)));
  psql(database, `insert into "${table}" (${names.join(", ")}) values (${values.join(", ")})`);
}

describe.skipIf(!enabled)("migration upgrade from a prior release (DX-09)", () => {
  it(`keeps rows written before the last ${HELD_BACK} migrations`, () => {
    const dirs = migrationDirs();
    const prior = dirs.slice(0, dirs.length - HELD_BACK);

    // A migrations folder as it stood at the prior release.
    const root = mkdtempSync(path.join(tmpdir(), "nesto-aud12-upgrade-"));
    scratch.push(root);
    mkdirSync(path.join(root, "migrations"));
    cpSync("prisma/schema.prisma", path.join(root, "schema.prisma"));
    cpSync(path.join(MIGRATIONS, "migration_lock.toml"), path.join(root, "migrations/migration_lock.toml"));
    for (const dir of prior) cpSync(path.join(MIGRATIONS, dir), path.join(root, "migrations", dir), { recursive: true });

    recreate(UPGRADE);
    deploy(UPGRADE, path.join(root, "schema.prisma"));
    expect(Number(psql(UPGRADE, "select count(*) from _prisma_migrations"))).toBe(prior.length);

    insertProbe(UPGRADE, "parent_groups", "aud12-upgrade-group");
    insertProbe(UPGRADE, "companies", "aud12-upgrade-company", { parentGroupId: "aud12-upgrade-group" });
    insertProbe(UPGRADE, "users", "aud12-upgrade-user");
    insertProbe(UPGRADE, "company_owners", "aud12-upgrade-owner", { companyId: "aud12-upgrade-company" });

    deploy(UPGRADE);
    expect(Number(psql(UPGRADE, "select count(*) from _prisma_migrations where finished_at is not null"))).toBe(dirs.length);
    expect(psql(UPGRADE, `select id from "companies" where id = 'aud12-upgrade-company'`)).toBe("aud12-upgrade-company");
    expect(psql(UPGRADE, `select id from "users" where id = 'aud12-upgrade-user'`)).toBe("aud12-upgrade-user");
    // The relations survive: the company still belongs to its group, the owner row to its company.
    expect(psql(UPGRADE, `select g.id from "companies" c join "parent_groups" g on g.id = c."parentGroupId" where c.id = 'aud12-upgrade-company'`)).toBe(
      "aud12-upgrade-group",
    );
    expect(
      psql(UPGRADE, `select c.id from "company_owners" o join "companies" c on c.id = o."companyId" where o.id = 'aud12-upgrade-owner'`),
    ).toBe("aud12-upgrade-company");
  }, 600_000);
});
