/**
 * Domain ownership and transaction gates (PRD #48 §103-§105, §185-§192, §270).
 *
 * Five rules, each of them something a reviewer would otherwise have to hold
 * in their head across two hundred files:
 *
 *   1. every Prisma model has exactly one owning domain, and the registry
 *      names all of them (§8, §292);
 *   2. no domain writes another domain's table, except where the registry says
 *      why — and a field-scoped exception writes only its own columns
 *      (§10, §11, §293);
 *   3. nothing under `app/` writes at all: routes and actions call services
 *      (§108, §109);
 *   4. no cycle in the service dependency graph (§155, §156, §270);
 *   5. no cascade delete that reaches from one domain's records into
 *      another's history (§130, §131).
 *
 * `pnpm verify:ownership` — exits non-zero on any failure.
 * `pnpm verify:ownership --report` — prints the write inventory instead
 * (§252): every model, its owner, and who writes it.
 * `pnpm verify:ownership --update-baseline` — re-records rule 4's cycles once
 * the new one has been reviewed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import ts from "typescript";

import { AGGREGATION_POINTS, CASCADE_EXCEPTIONS, domainOfFile, MODEL_OWNER, OWNERSHIP_EXCEPTIONS } from "./architecture/ownership";
import { sourceFiles, writeSites } from "./architecture/writes";
import { parse, walk } from "./security/source";

const failures: string[] = [];
const fail = (rule: string, message: string) => failures.push(`[${rule}] ${message}`);

const files = sourceFiles();
const sites = writeSites(files);

/* 1. Every model has an owner ---------------------------------------------- */

const schema = readFileSync("prisma/schema.prisma", "utf8");
const models = [...schema.matchAll(/^model (\w+)/gm)].map((match) => match[1]);
const delegate = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

for (const model of models) {
  if (!MODEL_OWNER[delegate(model)]) {
    fail("owners", `${model} has no owning domain; add it to scripts/architecture/ownership.ts`);
  }
}
for (const model of Object.keys(MODEL_OWNER)) {
  if (!models.some((candidate) => delegate(candidate) === model)) {
    fail("owners", `the registry owns "${model}", which is not a model in the schema`);
  }
}

/* 2. Only the owner writes ------------------------------------------------- */

type Allowance = (typeof OWNERSHIP_EXCEPTIONS)[number];

function allowanceFor(model: string, file: string, domain: string): Allowance | undefined {
  return OWNERSHIP_EXCEPTIONS.find(
    (exception) =>
      (exception.model === "*" || exception.model === model) &&
      (exception.file ? exception.file === file : exception.domain === domain),
  );
}

const usedExceptions = new Set<Allowance>();

for (const site of sites) {
  const owner = MODEL_OWNER[site.model];
  if (!owner) continue; // rule 1 already reported it
  const domain = domainOfFile(site.file);
  if (domain === owner || domain === "scripts") continue;

  const allowance = allowanceFor(site.model, site.file, domain);
  if (!allowance) {
    fail(
      "ownership",
      `${site.file}:${site.line} — ${domain} writes ${site.model}, which ${owner} owns. Call ${owner}'s service, or record the exception with its reason.`,
    );
    continue;
  }
  usedExceptions.add(allowance);

  if (allowance.fields) {
    if (!site.fields) {
      fail(
        "ownership",
        `${site.file}:${site.line} — ${domain} may write only ${allowance.fields.join(", ")} of ${site.model}, and this call's columns cannot be read from its syntax. Name them literally.`,
      );
      continue;
    }
    const extra = site.fields.filter((field) => !allowance.fields!.includes(field));
    if (extra.length > 0) {
      fail(
        "ownership",
        `${site.file}:${site.line} — ${domain} writes ${extra.join(", ")} of ${site.model}, beyond the ${allowance.fields.join(", ")} it owns.`,
      );
    }
  }
}

for (const exception of OWNERSHIP_EXCEPTIONS) {
  if (!usedExceptions.has(exception)) {
    fail(
      "ownership",
      `the exception for ${exception.model} in ${exception.file ?? exception.domain} is no longer used. Remove it rather than leaving a door open.`,
    );
  }
}

/* 3. Routes and actions delegate ------------------------------------------- */

for (const site of sites) {
  if (site.file.startsWith("app/")) {
    fail(
      "layer",
      `${site.file}:${site.line} writes ${site.model} directly. A route or an action calls a service; the business rules live there.`,
    );
  }
}

/* 4. No dependency cycles between domains ---------------------------------- */

const IMPORT_PREFIX = /^@\/(lib\/.*)$/;

function resolveImport(specifier: string, from: string): string | null {
  const alias = IMPORT_PREFIX.exec(specifier);
  if (alias) return alias[1];
  if (!specifier.startsWith(".")) return null;
  const base = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    else if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
}

const aggregators = new Set(AGGREGATION_POINTS.map((point) => point.file));
for (const point of AGGREGATION_POINTS) {
  if (!files.includes(point.file)) fail("cycles", `${point.file} is declared an aggregation point but does not exist`);
}

const edges = new Map<string, Map<string, string>>();
for (const file of files) {
  if (!file.startsWith("lib/") || aggregators.has(file)) continue;
  const from = domainOfFile(file);
  const source = parse(file);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    // A type-only import is a shape, not a call: it cannot make a cycle at runtime.
    if (statement.importClause?.isTypeOnly) continue;
    const target = resolveImport(statement.moduleSpecifier.text, file);
    if (!target) continue;
    const to = domainOfFile(target);
    if (to === from || !to) continue;
    if (!edges.has(from)) edges.set(from, new Map());
    if (!edges.get(from)!.has(to)) edges.get(from)!.set(to, `${file} → ${statement.moduleSpecifier.text}`);
  }
}

const seen = new Set<string>();
const onStack: string[] = [];
const cycles = new Map<string, string[]>();

function visit(node: string) {
  if (onStack.includes(node)) {
    const cycle = [...onStack.slice(onStack.indexOf(node)), node];
    cycles.set([...new Set(cycle)].sort().join(" ↔ "), cycle);
    return;
  }
  if (seen.has(node)) return;
  seen.add(node);
  onStack.push(node);
  for (const next of edges.get(node)?.keys() ?? []) visit(next);
  onStack.pop();
}

for (const node of edges.keys()) visit(node);

/*
 * A ratchet rather than a ban.
 *
 * Two domains calling each other's services is what PRD #48 asks for wherever
 * a handoff runs both ways: Tasks tells Meetings its action is done, Meetings
 * asks Tasks to raise one (§60, §75). Forbidding the import would forbid the
 * pattern. What is worth preventing is a new pair growing one by accident, so
 * the pairs that exist today are recorded, reviewed in
 * `docs/domain-dependencies.md`, and a pair not on the list fails.
 */
const CYCLE_BASELINE = "scripts/architecture/dependency-cycles.baseline.json";
const recorded: string[] = existsSync(CYCLE_BASELINE) ? JSON.parse(readFileSync(CYCLE_BASELINE, "utf8")) : [];
const found = [...cycles.keys()].sort();

if (process.argv.includes("--update-baseline")) {
  writeFileSync(CYCLE_BASELINE, `${JSON.stringify(found, null, 2)}\n`);
  console.log(`Recorded ${found.length} dependency cycles in ${CYCLE_BASELINE}.`);
  process.exit(0);
}

for (const key of found) {
  if (recorded.includes(key)) continue;
  const cycle = cycles.get(key)!;
  const path = cycle
    .slice(0, -1)
    .map((from, index) => `${from} → ${cycle[index + 1]} (${edges.get(from)?.get(cycle[index + 1]) ?? "?"})`)
    .join("\n         ");
  fail(
    "cycles",
    `a new circle between domains:\n         ${path}\n         Extract the narrow interface the other side needs, or record it with --update-baseline once reviewed.`,
  );
}
for (const key of recorded) {
  if (!found.includes(key)) fail("cycles", `${key} no longer form a circle — re-record the baseline so it keeps its meaning.`);
}

/* 5. Cross-domain cascades ------------------------------------------------- */

const cascadeAllowed = new Set(CASCADE_EXCEPTIONS.map((exception) => `${exception.from} → ${exception.to}`));
const cascadesSeen = new Set<string>();

for (const [, model, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  for (const line of body.split("\n")) {
    const relation = /^\s*(\w+)\s+(\w+)(\[\])?\??\s+@relation\((.*)\)/.exec(line);
    if (!relation) continue;
    const [, field, target, isList, args] = relation;
    if (isList) continue;
    if (!/onDelete:\s*Cascade/.test(args)) continue;
    // Tenancy: a company's deletion takes the company's data. Not a runtime
    // operation, and a RESTRICT here would only half-delete a company.
    if (target === "Company") continue;

    const childOwner = MODEL_OWNER[delegate(model)];
    const parentOwner = MODEL_OWNER[delegate(target)];
    if (!childOwner || !parentOwner || childOwner === parentOwner) continue;

    const key = `${model}.${field} → ${target}`;
    cascadesSeen.add(key);
    if (!cascadeAllowed.has(key)) {
      fail(
        "cascades",
        `${key} cascades a delete from ${parentOwner} into ${childOwner}. Use Restrict or SetNull, or record why the child is configuration rather than history.`,
      );
    }
  }
}

for (const exception of CASCADE_EXCEPTIONS) {
  const key = `${exception.from} → ${exception.to}`;
  if (!cascadesSeen.has(key)) fail("cascades", `the cascade exception for ${key} no longer matches the schema`);
}

/* Report ------------------------------------------------------------------- */

if (process.argv.includes("--report")) {
  const byModel = new Map<string, Map<string, number>>();
  for (const site of sites) {
    if (!byModel.has(site.model)) byModel.set(site.model, new Map());
    const writers = byModel.get(site.model)!;
    const domain = domainOfFile(site.file);
    writers.set(domain, (writers.get(domain) ?? 0) + 1);
  }
  console.log(`| Model | Owner | Writers |`);
  console.log(`|---|---|---|`);
  for (const model of [...new Set(models.map(delegate))].sort()) {
    const writers = [...(byModel.get(model)?.entries() ?? [])]
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => `${domain} (${count})`)
      .join(", ");
    console.log(`| \`${model}\` | ${MODEL_OWNER[model] ?? "—"} | ${writers || "nested writes only"} |`);
  }
  process.exit(0);
}

const routeFiles = walk("app", (file) => file.endsWith("/route.ts")).length;
if (failures.length > 0) {
  console.error(`Ownership gates failed (${failures.length}):\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(
  `Ownership gates passed: ${models.length} models owned, ${sites.length} write sites in ${files.length} files, ${routeFiles} routes writing none, ${edges.size} domains with no import cycle.`,
);
