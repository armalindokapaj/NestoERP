/**
 * The API security matrix (PRD #47 §105-§107, §156, §157).
 *
 * For every endpoint — each HTTP method of each route, and each exported
 * server action — this follows the handler's real call graph through the
 * TypeScript checker into the services it calls, and records what it finds on
 * the way: the permissions it tests, the modules it guards, the scope builders
 * it applies, the record-level guards and the state guards. The result is
 * written to docs/security/api-security-matrix.md.
 *
 *   pnpm security:matrix          regenerate the document
 *   pnpm security:matrix --check  fail if the document is stale, or if any
 *                                 company-scoped endpoint reaches no
 *                                 permission, module or record check at all
 *
 * The evidence is static: it shows that a check is on the path, not that it
 * is on every branch. Behaviour is proven by the security suites; this keeps
 * the inventory complete and makes an endpoint with nothing on its path
 * impossible to add silently.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { MODULE_KEYS } from "../../config/modules";
import { moduleForPermission, PERMISSIONS } from "../../config/permissions";
import { ROUTE_CLASSES } from "./route-classes";
import { fileHasUseServer, walk } from "./source";

const OUTPUT = "docs/security/api-security-matrix.md";
const ROOT = process.cwd();
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MAX_DEPTH = 10;

const PERMISSION_SET = new Set<string>(PERMISSIONS);
const MODULE_SET = new Set<string>(MODULE_KEYS);

/** Routes whose subject is the caller themself; they need no business permission (§103 AUTHENTICATED). */
const SELF_SERVICE = [/^\/api\/me(\/|$)/, /^\/api\/notifications(\/|$)/, /^\/api\/favorites(\/|$)/, /^\/api\/recent-work(\/|$)/];

/** Server actions whose subject is the caller, or that carry their own credential. */
const ACTION_CLASSES: Record<string, string> = {
  "lib/actions/account.ts": "AUTHENTICATED",
  "lib/actions/team.ts#acceptInviteAction": "TOKEN",
  "lib/actions/team.ts#acceptInviteAsCurrentUserAction": "TOKEN",
};

/**
 * Company-scoped endpoints the static trace cannot see a check on, each reviewed
 * by hand. Dispatch through a registry (search providers, record sections) hides
 * the check from the call graph; company configuration every member's interface
 * needs carries no business data.
 */
const REVIEWED: Record<string, string> = {
  "GET /api/search": "each search provider applies its module, permission and scope (lib/core/search/search.providers.ts)",
  "GET /api/productivity/palette": "search providers plus favorites/recent, each resolved in the reader's scope",
  "GET /api/productivity/settings": "company productivity preferences (retention, palette limits) every member's UI reads",
  "GET /api/settings/runtime": "company timezone, locale, currency and enabled modules every member's UI reads",
  "ACTION lib/actions/records.ts#decideRecordAction": "delegates to the record section's own decide(), which checks permission and scope",
};

const MODULE_GUARDS = new Set(["assertModule", "requireModule", "moduleAndPermissions", "isModuleEnabled", "canAccessModule", "hasAccessLevel", "getModuleScope", "buildProjectLinkedScopeWhere", "resolveModuleExperience"]);
const SCOPE_PATTERN = /^(build\w*(Scope|Access)Where|\w*Door|readable\w*Where|canAccessProject|accessibleProjectIds|visible\w*Where|\w*ScopeWhere)$/;
const RECORD_PATTERN = /^(loadRecord|canReadRecord|assertFound|find\w*InScope|require(?!UserContext|Module|Permission)[A-Z]\w*|findReadable\w*|findWritable\w*|get[A-Z]\w*OrThrow)$/;
const STATE_PATTERN = /^(stateDenied|assert\w*(State|Status|Live|Writable|Editable|Open|Draft|Transition)\w*|can(Transition|Move)\w*|assertTransition|frozenDocumentReason|touchLog)$/;

type Evidence = { permissions: Set<string>; modules: Set<string>; scope: Set<string>; record: Set<string>; state: Set<string> };
const empty = (): Evidence => ({ permissions: new Set(), modules: new Set(), scope: new Set(), record: new Set(), state: new Set() });
const merge = (into: Evidence, from: Evidence) => {
  for (const key of Object.keys(into) as (keyof Evidence)[]) for (const value of from[key]) into[key].add(value);
};

const configFile = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

const routeFiles = walk("app/api", (file) => file.endsWith("/route.ts"));
const actionFiles = walk("lib/actions", (file) => file.endsWith(".ts")).filter((file) => readFileSync(file, "utf8").startsWith('"use server"'));
const program = ts.createProgram([...routeFiles, ...actionFiles].map((file) => path.join(ROOT, file)), parsed.options);
const checker = program.getTypeChecker();

const inProject = (node: ts.Node) => {
  const file = node.getSourceFile().fileName;
  return file.startsWith(ROOT) && !file.includes("/node_modules/") && !file.endsWith(".d.ts");
};

function declarationsOf(node: ts.Node): ts.Declaration[] {
  let symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return [];
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return (symbol.declarations ?? []).filter(inProject);
}

function stringValue(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isIdentifier(node)) {
    for (const declaration of declarationsOf(node)) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const init = declaration.initializer;
        const inner = ts.isAsExpression(init) ? init.expression : init;
        if (ts.isStringLiteralLike(inner)) return inner.text;
      }
    }
  }
  return null;
}

const memo = new Map<ts.Node, Evidence>();

function bodyOf(declaration: ts.Declaration): ts.Node | null {
  if ((ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body) return declaration.body;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) return declaration.initializer;
  if (ts.isPropertyAssignment(declaration)) return declaration.initializer;
  return null;
}

function analyse(node: ts.Node, depth: number): Evidence {
  const cached = memo.get(node);
  if (cached) return cached;
  const evidence = empty();
  memo.set(node, evidence); // a cycle sees what has been gathered so far

  const visit = (current: ts.Node) => {
    if (ts.isStringLiteralLike(current) && PERMISSION_SET.has(current.text)) evidence.permissions.add(current.text);

    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : null;
      const name = nameNode?.text ?? "";
      if (MODULE_GUARDS.has(name)) {
        for (const argument of current.arguments) {
          const value = stringValue(argument);
          if (value && MODULE_SET.has(value)) evidence.modules.add(value);
        }
      }
      if (SCOPE_PATTERN.test(name)) evidence.scope.add(name);
      if (RECORD_PATTERN.test(name)) evidence.record.add(name);
      if (STATE_PATTERN.test(name)) evidence.state.add(name);

      if (nameNode && depth < MAX_DEPTH) {
        for (const declaration of declarationsOf(nameNode)) {
          const body = bodyOf(declaration);
          if (body) merge(evidence, analyse(body, depth + 1));
        }
      }
    }

    // Permission tables and module constants defined outside the function.
    if (ts.isIdentifier(current) && !ts.isCallExpression(current.parent) && depth < MAX_DEPTH) {
      for (const declaration of declarationsOf(current)) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer && !ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) {
          const scan = (inner: ts.Node) => {
            if (ts.isStringLiteralLike(inner) && PERMISSION_SET.has(inner.text)) evidence.permissions.add(inner.text);
            ts.forEachChild(inner, scan);
          };
          scan(declaration.initializer);
        }
      }
    }

    ts.forEachChild(current, visit);
  };
  visit(node);
  return evidence;
}

type Row = { method: string; endpoint: string; kind: "route" | "action"; cls: string; evidence: Evidence };
const rows: Row[] = [];

for (const file of routeFiles) {
  const source = program.getSourceFile(path.join(ROOT, file))!;
  const pattern = file.replace(/^app/, "").replace(/\/route\.ts$/, "");
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    const handlers: [string, ts.Node][] = [];
    if (ts.isFunctionDeclaration(statement) && statement.name && HTTP_METHODS.includes(statement.name.text) && statement.body) handlers.push([statement.name.text, statement.body]);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.includes(declaration.name.text) && declaration.initializer) handlers.push([declaration.name.text, declaration.initializer]);
      }
    }
    for (const [method, body] of handlers) {
      const cls = ROUTE_CLASSES[pattern] ?? (SELF_SERVICE.some((regex) => regex.test(pattern)) ? "AUTHENTICATED" : "COMPANY_SCOPED");
      rows.push({ method, endpoint: pattern, kind: "route", cls, evidence: analyse(body, 0) });
    }
  }
}

for (const file of actionFiles) {
  const source = program.getSourceFile(path.join(ROOT, file))!;
  if (!fileHasUseServer(source)) continue;
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    if (!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const publicAction = /lib\/actions\/(auth|contact|demo|dev)\.ts$/.test(file);
    const endpoint = `${file}#${statement.name.text}`;
    const cls = ACTION_CLASSES[endpoint] ?? ACTION_CLASSES[file] ?? (publicAction ? "PUBLIC" : "COMPANY_SCOPED");
    rows.push({ method: "ACTION", endpoint, kind: "action", cls, evidence: analyse(statement.body, 0) });
  }
}

/* Render ------------------------------------------------------------------ */

const list = (values: Set<string>, limit: number) => {
  const sorted = [...values].sort();
  if (sorted.length === 0) return "—";
  const shown = sorted.slice(0, limit).map((value) => `\`${value}\``).join(", ");
  return sorted.length > limit ? `${shown} +${sorted.length - limit}` : shown;
};

function modulesOf(evidence: Evidence): Set<string> {
  const modules = new Set(evidence.modules);
  for (const permission of evidence.permissions) {
    const moduleKey = moduleForPermission(permission);
    if (moduleKey) modules.add(moduleKey);
  }
  return modules;
}

const reviewedKey = (row: Row) => `${row.method} ${row.endpoint}`;
const unguarded = rows.filter((row) => row.cls === "COMPANY_SCOPED" && !REVIEWED[reviewedKey(row)] && row.evidence.permissions.size === 0 && row.evidence.modules.size === 0 && row.evidence.record.size === 0);

const lines: string[] = [];
lines.push("# API security matrix");
lines.push("");
lines.push("<!-- Generated by `pnpm security:matrix` (scripts/security/api-matrix.ts). Do not edit by hand; CI fails when it is stale. -->");
lines.push("");
lines.push("Every endpoint NESTO exposes, with the authorization evidence found on its call path (PRD #47 §105, §156). See [authorization-model.md](authorization-model.md) for what each column means.");
lines.push("");
lines.push("- **Class** — `COMPANY_SCOPED`: session + active membership + company, then module/permission/scope/record checks. `AUTHENTICATED`: the caller's own data (profile, sessions, notifications, favorites, recent work). `PUBLIC` / `TOKEN` / `SIGNED` / `AUTH_PROVIDER`: no session; the credential that replaces it is described in the model.");
lines.push("- **Permissions**, **Modules**, **Scope**, **Record guard**, **State guard** — what the static call-graph analysis found reachable from the handler. Evidence, not proof; the behaviour is proven by `pnpm test:security`.");
lines.push("- **Tests** — every session endpoint is attacked by the cross-company sweep (`tests/security/cross-company-api.test.ts`); server actions by `tests/security/cross-company-actions.test.ts`.");
lines.push("");
const byClass = rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.cls]: (acc[row.cls] ?? 0) + 1 }), {});
lines.push(`**${rows.filter((row) => row.kind === "route").length} route handlers, ${rows.filter((row) => row.kind === "action").length} server actions.** ${Object.entries(byClass).sort().map(([cls, count]) => `${cls} ${count}`).join(" · ")}. Company-scoped endpoints with no check on their path: **${unguarded.length}**.`);
lines.push("");

const groups = new Map<string, Row[]>();
for (const row of rows) {
  const group = row.kind === "action" ? `Server actions — ${path.basename(row.endpoint.split("#")[0], ".ts")}` : `/api/${row.endpoint.split("/")[2] ?? ""}`;
  groups.set(group, [...(groups.get(group) ?? []), row]);
}

for (const [group, groupRows] of [...groups.entries()].sort(([a], [b]) => (a.startsWith("Server") === b.startsWith("Server") ? a.localeCompare(b) : a.startsWith("Server") ? 1 : -1))) {
  lines.push(`## ${group}`);
  lines.push("");
  lines.push("| Method | Endpoint | Class | Modules | Permissions | Scope | Record guard | State guard | Tests |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const row of groupRows) {
    const endpoint = row.kind === "action" ? `\`${row.endpoint.split("#")[1]}\`` : `\`${row.endpoint}\``;
    const tests = row.cls === "COMPANY_SCOPED" || row.cls === "AUTHENTICATED" ? "sweep" : "security";
    const note = REVIEWED[reviewedKey(row)] ? ` (reviewed: ${REVIEWED[reviewedKey(row)]})` : "";
    lines.push(`| ${row.method} | ${endpoint}${note} | ${row.cls} | ${list(modulesOf(row.evidence), 3)} | ${list(row.evidence.permissions, 3)} | ${list(row.evidence.scope, 2)} | ${list(row.evidence.record, 2)} | ${list(row.evidence.state, 2)} | ${tests} |`);
  }
  lines.push("");
}

const document = `${lines.join("\n")}`;

if (process.argv.includes("--check")) {
  let failed = false;
  if (unguarded.length > 0) {
    failed = true;
    console.error(`✗ ${unguarded.length} company-scoped endpoint(s) reach no permission, module or record check:`);
    for (const row of unguarded) console.error(`  ${row.method} ${row.endpoint}`);
  }
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, "utf8") !== document) {
    failed = true;
    console.error(`✗ ${OUTPUT} is stale — run pnpm security:matrix and commit the result`);
  }
  if (failed) process.exitCode = 1;
  else console.log(`✓ API security matrix is current: ${rows.length} endpoints, none unguarded`);
} else {
  writeFileSync(OUTPUT, document);
  console.log(`wrote ${OUTPUT}: ${rows.length} endpoints (${unguarded.length} company-scoped with no check on their path)`);
  for (const row of unguarded) console.log(`  unguarded: ${row.method} ${row.endpoint}`);
}
