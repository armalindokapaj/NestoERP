import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JOBS, type JobDefinition } from "@/lib/core/jobs/job.registry";
import { CASCADE_EXCEPTIONS, OWNERSHIP_EXCEPTIONS, AGGREGATION_POINTS } from "@/scripts/architecture/ownership";
import { contractTestProblems, ownerProblems } from "@/scripts/architecture/workers";

/**
 * The gates fail when they should (AUD-12 DX-02, DX-13).
 *
 * A gate that passes on a clean tree proves nothing about whether it would
 * notice a regression. Each gate is run here against a copy of the tree with
 * a violation planted in it, and must fail, name the file, and say what to do
 * — without its baseline or allowlist growing to make room.
 *
 * The copy lives in the OS temp directory; the working tree is never touched.
 */

const REPO = process.cwd();
const COPIED = ["lib", "app", "scripts", "config", "components", "types", "docs", "ops", "tests", "prisma", "tsconfig.json", "package.json"];
const BASELINES = [
  "scripts/architecture/dependency-cycles.baseline.json",
  "scripts/architecture/blind-state-writes.baseline.json",
  "scripts/architecture/unreadable-state-writes.baseline.json",
  "scripts/security/unscoped-by-id.baseline.json",
  "scripts/architecture/ownership.ts",
  "scripts/verify-authorization.ts",
];

let root = "";
const hash = (file: string) => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
let before: Record<string, string> = {};

function plant(file: string, content: string) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

function gate(script: string): { status: number | null; output: string } {
  const run = spawnSync(path.join(REPO, "node_modules/.bin/tsx"), [script], { cwd: root, encoding: "utf8", env: process.env, timeout: 180_000 });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "nesto-aud12-gates-"));
  for (const entry of COPIED) cpSync(path.join(REPO, entry), path.join(root, entry), { recursive: true });
  symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"), "dir");
  before = Object.fromEntries(BASELINES.map((file) => [file, hash(file)]));

  // Rule 1: a model nobody owns.
  appendFileSync(path.join(root, "prisma/schema.prisma"), "\nmodel Aud12Probe {\n  id String @id\n}\n");

  // Meetings writes a Tasks table, a blind state write on its own table, and
  // imports Legal, which imports it back: a new cycle.
  plant(
    "lib/modules/meetings/aud12-probe.ts",
    [
      'import { prisma } from "@/lib/database/prisma";',
      'import { legalProbe } from "@/lib/modules/legal/aud12-probe";',
      "export async function meetingsProbe(id: string) {",
      '  await prisma.task.create({ data: { title: "probe" } });',
      '  await prisma.meeting.update({ where: { id }, data: { status: "CANCELLED" } });',
      "  return legalProbe;",
      "}",
      "",
    ].join("\n"),
  );
  plant(
    "lib/modules/legal/aud12-probe.ts",
    ['import { meetingsProbe } from "@/lib/modules/meetings/aud12-probe";', "export const legalProbe = meetingsProbe;", ""].join("\n"),
  );
  // A state machine nothing registers.
  plant("lib/modules/meetings/aud12-probe.machine.ts", 'export const probe = { key: "aud12_probe" };\n');
  // A request schema that trusts a server-owned field, and a role comparison.
  plant(
    "lib/modules/meetings/aud12-probe.schema.ts",
    ['import { z } from "zod";', "export const probeSchema = z.object({", "  companyId: z.string(),", "});", ""].join("\n"),
  );
  plant("lib/modules/meetings/aud12-probe.role.ts", 'export const isOwner = (context: { role: string }) => context.role === "OWNER";\n');
  // A route that is not wrapped, writes directly, looks a row up by id alone and starts a job.
  plant(
    "app/api/aud12-probe/route.ts",
    [
      'import { prisma } from "@/lib/database/prisma";',
      'import { runJobNow } from "@/lib/core/jobs/job.manual";',
      "export async function GET() {",
      '  await prisma.task.update({ where: { id: "x" }, data: { title: "y" } });',
      "  await runJobNow;",
      '  return new Response("");',
      "}",
      "",
    ].join("\n"),
  );
}, 180_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("verify:ownership, fed a planted violation", () => {
  let result: ReturnType<typeof gate>;
  beforeAll(() => {
    result = gate("scripts/verify-ownership.ts");
  }, 180_000);

  it("fails", () => {
    expect(result.status, result.output).not.toBe(0);
  });

  it("names a model without an owner, and where to add one", () => {
    expect(result.output).toContain("[owners] Aud12Probe has no owning domain; add it to scripts/architecture/ownership.ts");
  });

  it("names the foreign write, its line, and the owner's service to call instead", () => {
    expect(result.output).toMatch(/\[ownership\] lib\/modules\/meetings\/aud12-probe\.ts:4 — meetings writes task, which tasks owns\. Call tasks's service/);
  });

  it("names a route writing directly", () => {
    expect(result.output).toMatch(/\[layer\] app\/api\/aud12-probe\/route\.ts:4 writes task directly/);
  });

  it("names the new cycle with the import that makes each edge", () => {
    expect(result.output).toContain("[cycles] a new circle between domains");
    expect(result.output).toMatch(/lib\/modules\/(meetings|legal)\/aud12-probe\.ts → @\/lib\/modules\/(legal|meetings)\/aud12-probe/);
  });
});

describe("verify:state, fed a planted violation", () => {
  let result: ReturnType<typeof gate>;
  beforeAll(() => {
    result = gate("scripts/verify-state.ts");
  }, 180_000);

  it("fails", () => {
    expect(result.status, result.output).not.toBe(0);
  });

  it("names the blind state write, its line and the fix", () => {
    expect(result.output).toMatch(/lib\/modules\/meetings\/aud12-probe\.ts: 1 blind state writes, 0 allowed \(lines 5\)\. Name the state it moves from/);
  });

  it("names the unregistered machine", () => {
    expect(result.output).toContain('lib/modules/meetings/aud12-probe.machine.ts: declares "aud12_probe", which lib/core/state/registry.ts does not list');
  });
});

describe("verify:authorization, fed a planted violation", () => {
  let result: ReturnType<typeof gate>;
  beforeAll(() => {
    result = gate("scripts/verify-authorization.ts");
  }, 180_000);

  it("fails", () => {
    expect(result.status, result.output).not.toBe(0);
  });

  it("names the unwrapped route handler", () => {
    expect(result.output).toMatch(/\[routes\] app\/api\/aud12-probe\/route\.ts:3 GET does not run inside withContext/);
  });

  it("names the role comparison", () => {
    expect(result.output).toMatch(/\[roles\] lib\/modules\/meetings\/aud12-probe\.role\.ts:1 compares a role name/);
  });

  it("names the server-owned field in a request schema", () => {
    expect(result.output).toContain('[schemas] lib/modules/meetings/aud12-probe.schema.ts:3 request schema accepts server-owned field "companyId"');
  });

  it("names the lookup by id alone against its baseline", () => {
    expect(result.output).toMatch(/\[by-id\] lib\/modules\/meetings\/aud12-probe\.ts has 1 Prisma call\(s\) addressed by id alone \(baseline 0\)\. Scope the lookup by companyId/);
  });
});

describe("verify:workers, fed a planted violation", () => {
  let result: ReturnType<typeof gate>;
  beforeAll(() => {
    result = gate("scripts/verify-workers.ts");
  }, 180_000);

  it("fails and names the route that starts a job", () => {
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("app/api/aud12-probe/route.ts: imports the job runner — jobs are started by the worker process, never by a request");
  });

  it("refuses an owner that is not a domain, and a job without its contract tests (in memory)", () => {
    const base = JOBS.find((job) => job.key === "planning.milestones")!;
    const probe: JobDefinition = { ...base, key: "planning.aud12_probe", owner: "aud12-nowhere" };
    expect(ownerProblems([probe])).toEqual(['planning.aud12_probe: owner "aud12-nowhere" is not a domain directory']);
    expect(contractTestProblems([probe]).join("\n")).toMatch(/planning\.aud12_probe/);
  });
});

describe("the ratchets stay where they were", () => {
  it("no gate run wrote to a baseline or an allowlist", () => {
    for (const file of BASELINES) expect(hash(file), `${file} changed during a failing gate run`).toBe(before[file]);
  });

  it("the copy's baselines are the working tree's baselines", () => {
    for (const file of BASELINES) {
      const repo = createHash("sha256").update(readFileSync(path.join(REPO, file))).digest("hex");
      expect(before[file], file).toBe(repo);
    }
  });
});

/* Every allowlist entry says why ------------------------------------------ */

function recordEntries(file: string, name: string): Array<[string, string]> {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`const ${name}: Record<string, string> = {`);
  expect(start, `${name} in ${file}`).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("\n};", start));
  return [...body.matchAll(/^\s*"([^"]+)":\s*\n?\s*"([^"]*)"/gm)].map((match) => [match[1], match[2]]);
}

describe("every exception carries a reason", () => {
  it("ownership, aggregation and cascade exceptions", () => {
    const missing = [
      ...OWNERSHIP_EXCEPTIONS.filter((entry) => !entry.reason || entry.reason.trim().length < 20).map((entry) => `ownership ${entry.model}@${entry.file ?? entry.domain}`),
      ...AGGREGATION_POINTS.filter((entry) => !entry.reason || entry.reason.trim().length < 20).map((entry) => `aggregation ${entry.file}`),
      ...CASCADE_EXCEPTIONS.filter((entry) => !entry.reason || entry.reason.trim().length < 20).map((entry) => `cascade ${entry.from} → ${entry.to}`),
    ];
    expect(missing).toEqual([]);
  });

  it.each(["ROLE_CHECK_EXCEPTIONS", "SCHEMA_FIELD_EXCEPTIONS"])("verify:authorization %s", (name) => {
    const entries = recordEntries("scripts/verify-authorization.ts", name);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter(([, reason]) => reason.trim().length < 20).map(([key]) => key)).toEqual([]);
  });

  it("numeric baselines are counts only and say why in their gate", () => {
    // The JSON ratchets hold counts, not reasons; their reason is the rule in
    // the gate's header, and a new entry needs --update-baseline plus review.
    for (const file of BASELINES.filter((candidate) => candidate.endsWith(".json"))) {
      expect(existsSync(file), file).toBe(true);
    }
  });
});
