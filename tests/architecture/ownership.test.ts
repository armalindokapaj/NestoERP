import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { AGGREGATION_POINTS, domainOfFile, MODEL_OWNER, OWNERSHIP_EXCEPTIONS } from "@/scripts/architecture/ownership";
import { writeSites } from "@/scripts/architecture/writes";

/**
 * Architecture tests (PRD #48 §103, §185-§192, §298).
 *
 * The gate itself is `scripts/verify-ownership.ts`, and CI runs it. These
 * exist so a developer running `pnpm test` finds a boundary they crossed
 * without having to know the gate exists, and so the specific drifts PRD #48
 * §293 names can never come back quietly — each of them is a test of its own,
 * by name, with the service that replaced it.
 */

const sites = writeSites();

/** Every write of `model` from outside the named domain. */
function foreignWrites(model: string, owner: string): string[] {
  return sites
    .filter((site) => site.model === model && domainOfFile(site.file) !== owner)
    .filter((site) => !OWNERSHIP_EXCEPTIONS.some((exception) => exception.file === site.file))
    .map((site) => `${site.file}:${site.line}`);
}

describe("domain ownership", () => {
  it("runs the full gate", () => {
    // Everything the gate checks, in one place, so this file cannot drift from
    // what CI enforces.
    expect(() => execFileSync("npx", ["tsx", "scripts/verify-ownership.ts"], { encoding: "utf8", stdio: "pipe" })).not.toThrow();
  });

  it("gives every model exactly one owner", () => {
    const owners = new Set(Object.values(MODEL_OWNER));
    expect(owners.size).toBeGreaterThan(20);
    expect(Object.keys(MODEL_OWNER).length).toBeGreaterThan(180);
  });

  it("declares a reason for every exception", () => {
    for (const exception of OWNERSHIP_EXCEPTIONS) {
      expect(exception.reason.length, `${exception.model} in ${exception.file ?? exception.domain}`).toBeGreaterThan(40);
    }
    for (const point of AGGREGATION_POINTS) {
      expect(point.reason.length, point.file).toBeGreaterThan(20);
    }
  });
});

/* The drifts PRD #48 §293 names, each closed by a specific service ---------- */

describe("the named ownership drifts stay closed", () => {
  it("Procurement does not write Finance commitments", () => {
    expect(foreignWrites("commitment", "finance")).toEqual([]);
  });

  it("Meetings does not write Tasks", () => {
    expect(foreignWrites("task", "tasks")).toEqual([]);
  });

  it("Engineering does not write Documents", () => {
    expect(foreignWrites("document", "documents")).toEqual([]);
  });

  it("no feature module writes AttentionItem", () => {
    expect(foreignWrites("attentionItem", "core/notifications")).toEqual([]);
  });

  it("no feature module writes IntegrationLink", () => {
    expect(foreignWrites("integrationLink", "core/integrations")).toEqual([]);
  });

  it("Meetings does not write calendar reminders", () => {
    expect(foreignWrites("calendarReminder", "calendar")).toEqual([]);
  });

  it("only Auth writes credentials and sessions", () => {
    expect(foreignWrites("session", "auth")).toEqual([]);
    expect(foreignWrites("passwordResetToken", "auth")).toEqual([]);
  });

  it("no route or server action writes to the database at all", () => {
    expect(sites.filter((site) => site.file.startsWith("app/")).map((site) => `${site.file}:${site.line}`)).toEqual([]);
  });
});
