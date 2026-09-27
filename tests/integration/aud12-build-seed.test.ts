import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The build's demo seed gate (AUD-12 DX-11).
 *
 * tests/integration/database/db-safety.test.ts proves the seed's own guard
 * (prisma/seed/guard.ts) refuses production and an unnamed remote database.
 * This covers the other half, scripts/vercel-build.sh: the eligibility check
 * it runs before seeding is executed here exactly as written in the script,
 * and the script's shape is held so the seed stays behind the opt-in, the
 * eligibility answer and the empty-database check.
 */

const SCRIPT = readFileSync("scripts/vercel-build.sh", "utf8");
const snippet = /eligible=\$\(DATABASE_URL="\$direct_url" npx tsx -e '([\s\S]*?)\n\s*'\)/.exec(SCRIPT)?.[1];

const REMOTE = "postgresql://demo:secret@db.example.supabase.co:5432/nesto_demo";

function eligibility(env: Record<string, string>): string {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !["APP_ENV", "VERCEL_ENV", "VERCEL", "NESTO_SEED_TARGET", "NODE_ENV"].includes(key)),
  );
  const run = spawnSync("npx", ["tsx", "-e", snippet!], { encoding: "utf8", env: { ...clean, ...env } as NodeJS.ProcessEnv });
  if (run.status !== 0 || !run.stdout.trim()) throw new Error(`the eligibility check failed (${run.status}): ${run.stderr}`);
  return run.stdout.trim();
}

describe("scripts/vercel-build.sh demo seed (DX-11)", () => {
  it("contains the eligibility check this test runs", () => {
    expect(snippet).toBeTruthy();
    expect(snippet).toContain("checkSeedTarget");
  });

  it("seeds nothing without NESTO_SEED_TARGET", () => {
    expect(eligibility({ DATABASE_URL: REMOTE, APP_ENV: "demo" })).toBe("NESTO_SEED_TARGET is not set");
  });

  it("seeds nothing when the target names another database", () => {
    expect(eligibility({ DATABASE_URL: REMOTE, APP_ENV: "demo", NESTO_SEED_TARGET: "db.example.supabase.co/nesto_other" })).toBe(
      "NESTO_SEED_TARGET names another database",
    );
  });

  it("seeds nothing in production, even with the target named", () => {
    expect(eligibility({ DATABASE_URL: REMOTE, APP_ENV: "production", NESTO_SEED_TARGET: "db.example.supabase.co/nesto_demo" })).toMatch(/production/);
  });

  it("seeds nothing on a Vercel production deployment that sets no APP_ENV", () => {
    expect(eligibility({ DATABASE_URL: REMOTE, VERCEL: "1", VERCEL_ENV: "production", NESTO_SEED_TARGET: "db.example.supabase.co/nesto_demo" })).toMatch(
      /production/,
    );
  });

  it("answers yes only for a named demo target", () => {
    expect(eligibility({ DATABASE_URL: REMOTE, APP_ENV: "demo", NESTO_SEED_TARGET: "db.example.supabase.co/nesto_demo" })).toBe("yes");
  });

  it("keeps the seed behind the opt-in, the eligibility answer and an empty database", () => {
    const optIn = SCRIPT.indexOf('if [ "${NESTO_SEED_ON_BUILD:-}" = "1" ]; then');
    const eligible = SCRIPT.indexOf('if [ "$eligible" != "yes" ]; then');
    const empty = SCRIPT.indexOf('if [ "$users" = "0" ]; then');
    const seed = SCRIPT.indexOf("npx prisma db seed");
    expect(optIn).toBeGreaterThan(-1);
    expect(optIn).toBeLessThan(eligible);
    expect(eligible).toBeLessThan(empty);
    expect(empty).toBeLessThan(seed);
    // One seed invocation, and nothing resets or pushes.
    expect(SCRIPT.match(/db seed/g)).toHaveLength(1);
    expect(SCRIPT).not.toMatch(/migrate (dev|reset)|db push|--accept-data-loss|--force-reset/);
  });
});
