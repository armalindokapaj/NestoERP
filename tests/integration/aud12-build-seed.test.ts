import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * What the Vercel build writes to a database (AUD-12 DX-11).
 *
 * Migrations and the access configuration, in that order, and nothing else:
 * no deployment seeds demo or sample data on build.
 */

const SCRIPT = readFileSync("scripts/vercel-build.sh", "utf8");
const commands = SCRIPT.split("\n").filter((line) => !line.trim().startsWith("#"));
const code = commands.join("\n");

describe("scripts/vercel-build.sh database writes", () => {
  it("never seeds", () => {
    expect(code).not.toMatch(/db\s+seed/);
    expect(code).not.toContain("NESTO_SEED_ON_BUILD");
    expect(code).not.toContain("ALLOW_DEMO_SEED");
  });

  it("migrates, then syncs the access configuration, before the build", () => {
    const migrate = code.indexOf("prisma migrate deploy");
    const sync = code.indexOf("scripts/access-sync.ts");
    const build = code.indexOf("next build");
    expect(migrate).toBeGreaterThanOrEqual(0);
    expect(sync).toBeGreaterThan(migrate);
    expect(build).toBeGreaterThan(sync);
  });
});
