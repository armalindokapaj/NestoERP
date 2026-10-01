import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A role never impersonates a person (C-01 §2, §94).
 *
 * The development role override is gone: a role laid over the signed-in
 * person, carried in a cookie. Nothing in the product may bring it back —
 * no override option on the resolver, no "actual role" beside the role, no
 * "Viewing as" on a page, no role chip in the top bar. The old cookie's name
 * is gone entirely; the demo user switch that deleted it was removed.
 */

const ROOT = process.cwd();
const PRODUCT = ["app", "components", "config", "lib"];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) out.push(...files(file));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(file);
  }
  return out;
}

const product = [...PRODUCT.flatMap((root) => files(path.join(ROOT, root))), path.join(ROOT, "middleware.ts")].map((file) => ({
  file: path.relative(ROOT, file),
  source: readFileSync(file, "utf8"),
}));

describe("no development role override (C-01)", () => {
  it("leaves no override in the context, the shell or the pages (§29-§37, §72, §73)", () => {
    const retired = /\broleOverride\b|\bresolveRole\b|\broleIsOverridden\b|\bactualRole\b|\bDevRoleSwitcher\b|\bsetDevRoleAction\b|\bDEV_ROLE_COOKIE\b|\bRESET_DEV_ROLE\b|Viewing as|lib\/auth\/dev-role"|lib\/actions\/dev"|devOverride/;
    const offenders = product.filter(({ source }) => retired.test(source)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("names the old cookie nowhere: nothing deletes or reads it any more", () => {
    expect(product.filter(({ source }) => source.includes("nesto.dev-role")).map(({ file }) => file)).toEqual([]);
  });

  it("has retired the override's files; development gating lives in its own module (§38, §39, §85)", () => {
    for (const file of ["lib/auth/dev-role.ts", "lib/actions/dev.ts", "components/layout/dev-role-switcher.tsx"]) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(false);
    }
    expect(existsSync(path.join(ROOT, "lib/auth/dev-mode.ts"))).toBe(true);
  });

  it("reads no cookie but the session's in resolving the context (§30)", () => {
    const resolver = readFileSync(path.join(ROOT, "lib/context/resolve-user-context.ts"), "utf8");
    expect(resolver).not.toMatch(/cookies\(/);
    expect(readFileSync(path.join(ROOT, "lib/context/build-context.ts"), "utf8")).not.toMatch(/cookies\(|isDevMode/);
  });
});
