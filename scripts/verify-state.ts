/**
 * State integrity gates (PRD #49 §276-§279).
 *
 * Three rules, all of them about the same thing: a controlled record moves
 * between states by a declared transition, and the state it moved from is part
 * of the write rather than an `if` above it.
 *
 *   1. Every declared machine governs a model its own domain owns. A machine
 *      reaches its table through a delegate name, which the ownership scanner
 *      cannot see, so this is what keeps PRD #48's rule true for transitions.
 *   2. Every `*.machine.ts` is registered. An unregistered machine is invisible
 *      to this gate, to the docs and to the tests.
 *   3. No file gains a blind state write. A write that sets a state column
 *      without naming a state column in its `where` can be lost to whoever
 *      else is acting on the record — the baseline records where that is still
 *      true, per file, and the count may fall but never rise.
 *   4. No file gains an unreadable one. A payload built by spreading or passed
 *      as a variable hides which columns it writes, so rule 3 cannot tell
 *      whether it sets a state — a `moveStatus(…, { ...extra })` helper is
 *      exactly where a blind transition would go unseen. On a model with a
 *      state column, such a write either names a state in its `where` or is
 *      counted, under the same ratchet.
 *
 * `--report` prints the inventory PRD #49 §277 asks for; `--update-baseline`
 * re-records it after a reviewed change.
 */
import fs from "node:fs";
import path from "node:path";

import { STATE_MACHINES } from "../lib/core/state/registry";
import { domainOfFile, MODEL_OWNER } from "./architecture/ownership";
import { sourceFiles, writeSites } from "./architecture/writes";
import { controlledStateFields } from "./architecture/states";

const BASELINE = "scripts/architecture/blind-state-writes.baseline.json";
const UNREADABLE_BASELINE = "scripts/architecture/unreadable-state-writes.baseline.json";

const report = process.argv.includes("--report");
const updateBaseline = process.argv.includes("--update-baseline");
const failures: string[] = [];

/* -------------------------------------------------------------------------- */
/* 1. A machine governs only its own domain's model                            */
/* -------------------------------------------------------------------------- */

const machineFiles = sourceFiles().filter((file) => file.endsWith(".machine.ts"));
const declaredIn = new Map<string, string>();
for (const file of machineFiles) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bkey:\s*"([a-z0-9_]+)"/g)) {
    declaredIn.set(match[1], file);
  }
}

for (const machine of STATE_MACHINES) {
  const file = declaredIn.get(machine.key);
  if (!file) {
    failures.push(`${machine.key}: registered but no *.machine.ts file declares it — the gate cannot tell which domain owns it.`);
    continue;
  }
  const domain = domainOfFile(file);
  const owner = MODEL_OWNER[machine.model];
  if (!owner) {
    failures.push(`${machine.key}: governs "${machine.model}", which no domain owns.`);
  } else if (owner !== domain) {
    failures.push(`${machine.key}: declared in ${domain} but governs ${machine.model}, owned by ${owner}. A transition is a write; move the machine or add a door (PRD #48 §9).`);
  }
}

/* -------------------------------------------------------------------------- */
/* 2. Every machine file is registered                                         */
/* -------------------------------------------------------------------------- */

const registered = new Set(STATE_MACHINES.map((machine) => machine.key));
for (const [key, file] of declaredIn) {
  if (!registered.has(key)) {
    failures.push(`${file}: declares "${key}", which lib/core/state/registry.ts does not list. An unregistered machine is checked by nothing.`);
  }
}

/* -------------------------------------------------------------------------- */
/* 3. Blind state writes may fall, never rise                                  */
/* -------------------------------------------------------------------------- */

const stateFields = controlledStateFields();
const byDelegate = new Map<string, string[]>();
for (const [model, fields] of Object.entries(stateFields)) {
  byDelegate.set(model[0].toLowerCase() + model.slice(1), fields);
}

type Blind = { file: string; line: number; model: string; op: string; field: string };
const blind: Blind[] = [];
const guarded: Blind[] = [];

const unreadable: Omit<Blind, "field">[] = [];

for (const site of writeSites()) {
  const fields = byDelegate.get(site.model);
  if (!fields) continue;
  if (site.op.startsWith("create")) continue;
  if (site.fields === null) {
    const guards = site.where !== null && site.where.some((key) => fields.includes(key));
    if (!guards) unreadable.push({ file: site.file, line: site.line, model: site.model, op: site.op });
    continue;
  }
  const written = site.fields.filter((field) => fields.includes(field));
  if (written.length === 0) continue;
  // A guard on any state column of the same model counts: the scan worker
  // writes `scanStatus` under `where: { storageStatus: "SCANNING" }`, which is
  // exactly the protection this is looking for.
  const guards = site.where !== null && site.where.some((key) => fields.includes(key));
  for (const field of written) {
    (guards ? guarded : blind).push({ file: site.file, line: site.line, model: site.model, op: site.op, field });
  }
}

const perFile = (sites: { file: string }[]) => {
  const tally: Record<string, number> = {};
  for (const site of sites) tally[site.file] = (tally[site.file] ?? 0) + 1;
  return tally;
};
const counts = perFile(blind);
const unreadableCounts = perFile(unreadable);

if (updateBaseline) {
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  fs.writeFileSync(UNREADABLE_BASELINE, `${JSON.stringify(unreadableCounts, null, 2)}\n`);
  console.log(
    `Recorded ${blind.length} blind state writes across ${Object.keys(counts).length} files, ` +
      `and ${unreadable.length} unreadable ones across ${Object.keys(unreadableCounts).length}.`,
  );
  process.exit(0);
}

const ratchet = (
  current: Record<string, number>,
  file: string,
  sites: { file: string; line: number }[],
  describe: (count: number, allowed: number, lines: string) => string,
) => {
  const allowedBy: Record<string, number> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  for (const [source, count] of Object.entries(current)) {
    const allowed = allowedBy[source] ?? 0;
    if (count > allowed) {
      const lines = sites.filter((site) => site.file === source).map((site) => site.line).join(", ");
      failures.push(`${source}: ${describe(count, allowed, lines)}`);
    }
  }
  return allowedBy;
};

const baseline = ratchet(
  counts,
  BASELINE,
  blind,
  (count, allowed, lines) =>
    `${count} blind state writes, ${allowed} allowed (lines ${lines}). Name the state it moves from in the \`where\`, or move the transition onto the domain's machine.`,
);
ratchet(
  unreadableCounts,
  UNREADABLE_BASELINE,
  unreadable,
  (count, allowed, lines) =>
    `${count} writes the gate cannot read on a model with a state column, ${allowed} allowed (lines ${lines}). Spell out the columns in \`data\`, or name the state it read in the \`where\`.`,
);

if (report) {
  console.log(`\nControlled state writes (PRD #49 §277)\n`);
  console.log(`  ${String(guarded.length).padStart(4)}  guarded — the where names a state column`);
  console.log(`  ${String(blind.length).padStart(4)}  blind   — the where does not`);
  console.log(`  ${String(unreadable.length).padStart(4)}  unreadable — the payload hides its columns and the where names no state`);
  console.log(`\n${STATE_MACHINES.length} declared machines:\n`);
  for (const machine of STATE_MACHINES) {
    console.log(`  ${machine.key.padEnd(24)} ${machine.model.padEnd(28)} ${machine.transitions.length} transitions, ${machine.states.length} states`);
  }
  console.log(`\nBlind writes by file:\n`);
  for (const [file, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${file}`);
  }
  console.log(`\nUnreadable writes by file:\n`);
  for (const [file, count] of Object.entries(unreadableCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${file}`);
  }
  console.log();
}

if (failures.length > 0) {
  console.error(`\nState integrity gates failed (${failures.length}):\n`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error();
  process.exit(1);
}

const recorded = Object.values(baseline).reduce((total, n) => total + n, 0);
console.log(
  `State gates passed: ${STATE_MACHINES.length} machines over ${STATE_MACHINES.reduce((n, m) => n + m.transitions.length, 0)} transitions, ` +
    `${guarded.length} guarded state writes, ${blind.length} blind and ${recorded} allowed, ${unreadable.length} unreadable.`,
);
