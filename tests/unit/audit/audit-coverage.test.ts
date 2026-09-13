import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AuditAction, auditPolicies } from "@/lib/core/audit/audit-policy.registry";

/**
 * Audit coverage (PRD #28 §134-§137).
 *
 * A registered policy that nothing emits is the worst kind of compliance gap:
 * the action key exists, the category and severity are declared, the viewer
 * renders, and the event never happens. It reads as "nothing occurred" rather
 * than "nothing was recorded".
 *
 * The 2026-09-13 gap audit found exactly that — 9 of 52 registered actions
 * were emitted. These tests are the guard against it coming back, and they are
 * static on purpose: a behavioural test per action would be 50 tests that each
 * prove one call site, while this proves there are no silent policies at all.
 */

const ROOT = join(__dirname, "..", "..", "..");

/**
 * Source that may *emit* an action.
 *
 * Only the registry is excluded, because it declares every constant and would
 * otherwise make each one look emitted. The rest of the audit core counts:
 * `audit-query.service.ts` legitimately emits AUDIT_LOG_EXPORTED when somebody
 * takes a copy of the log.
 */
function productionSources(): string[] {
  const out: string[] = [];
  const skipDirs = new Set(["node_modules", ".next", ".next-e2e", ".git", "tests"]);

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "audit-policy.registry.ts") {
        continue;
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        out.push(readFileSync(full, "utf8"));
      }
    }
  };

  for (const dir of ["lib", "app"]) walk(join(ROOT, dir));
  return out;
}

/**
 * Registered for a capability V0.1 does not have. Each must stay justified
 * here rather than quietly lingering in the registry.
 */
const NOT_YET_IMPLEMENTED: Record<string, string> = {
  REPORT_EXPORTED_XLSX: "V0.1 exports CSV only; no XLSX writer ships (PRD #28 §171).",
};

describe("audit policy coverage", () => {
  const sources = productionSources();
  const emitted = new Set<string>();
  for (const src of sources) {
    for (const match of src.matchAll(/AuditAction\.([A-Z_]+)/g)) emitted.add(match[1]);
  }

  it("emits every registered policy that is not an explicit deferral", () => {
    const registered = auditPolicies().map((policy) => policy.actionKey);
    const silent = registered.filter(
      (key) => !emitted.has(key) && !(key in NOT_YET_IMPLEMENTED),
    );

    expect(silent, `registered but never emitted: ${silent.join(", ")}`).toEqual([]);
  });

  /**
   * The `required` ones matter most: `audit.service.ts` defines required as
   * "not allowed to happen unaudited", so a required policy with no call site
   * is the codebase contradicting itself.
   */
  it("emits every policy declared required", () => {
    const silent = auditPolicies()
      .filter((policy) => policy.required)
      .map((policy) => policy.actionKey)
      .filter((key) => !emitted.has(key));

    expect(silent, `required but never emitted: ${silent.join(", ")}`).toEqual([]);
  });

  it("keeps every deferral pointing at a real registered action", () => {
    const registered = new Set(auditPolicies().map((policy) => policy.actionKey));
    for (const key of Object.keys(NOT_YET_IMPLEMENTED)) {
      expect(registered.has(key), `${key} is exempted but not registered`).toBe(true);
      expect(emitted.has(key), `${key} is exempted but is now emitted — drop the exemption`).toBe(
        false,
      );
    }
  });

  it("registers a policy for every action constant", () => {
    const registered = new Set(auditPolicies().map((policy) => policy.actionKey));
    const orphanConstants = Object.values(AuditAction).filter((key) => !registered.has(key));

    expect(orphanConstants, "action constants with no policy").toEqual([]);
  });
});
