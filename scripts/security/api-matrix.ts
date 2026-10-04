/**
 * The entry-point security matrix (PRD #47 §105-§107, §156, §157; AUD-06 §2,
 * RP-10, RP-24).
 *
 * For every permission-sensitive entry point — each HTTP method of each route,
 * each exported server action, each page (with its layouts), each inline
 * `"use server"` closure in a page, the signed storage endpoint, every
 * background job, every notification event and every global-search provider —
 * this follows the real call graph through the TypeScript checker into the
 * services it calls, and records what it finds on the way: the permissions it
 * tests, the modules it guards, the scope builders it applies, the record-level
 * guards and the state guards. It names the domain that owns the data, the
 * specific test files that exercise the entry point, and an outcome. The result
 * is written to docs/security/api-security-matrix.md.
 *
 *   pnpm security:matrix          regenerate the document
 *   pnpm security:matrix --check  fail if the document is stale, or if any
 *                                 company-scoped route or action reaches no
 *                                 permission, module or record check at all
 *
 * The evidence is static: it shows that a check is on the path, not that it
 * is on every branch. Behaviour is proven by the security suites; this keeps
 * the inventory complete and makes an endpoint with nothing on its path
 * impossible to add silently. Pages and inline actions nothing classifies are
 * listed as UNCLASSIFIED in their own section, never dropped (AUD-06 RP-24).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { MODULE_KEYS } from "../../config/modules";
import { moduleForPermission, PERMISSIONS } from "../../config/permissions";
import { JOBS } from "../../lib/core/jobs/job.registry";
import { notificationEventDefinitions } from "../../lib/core/notifications/notification.events";
import { DOWNLOAD_URL_TTL_SECONDS, PREVIEW_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from "../../lib/core/storage";
import { domainOfFile } from "../architecture/ownership";
import { ACTION_SWEEPS, ROUTE_SWEEPS, testsForAction, testsForKey, testsForPage, testsForRoute, testsForSearchProvider, testsForService } from "./matrix-tests";
import { ROUTE_CLASSES } from "./route-classes";
import { fileHasUseServer, hasUseServerDirective, walk } from "./source";

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
  // The Platform Admin's own account (ADM-01): requirePlatformContext, tenant sessions refused.
  "lib/actions/platform-account.ts": "PLATFORM",
  "lib/actions/group-account.ts": "PLATFORM",
  // Recovery links (ADM-01): the credential is the emailed token, checked by its hash.
  "lib/actions/auth.ts#resetPasswordAction": "TOKEN",
  "lib/actions/auth.ts#confirmRecoveryEmailAction": "TOKEN",
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
  "GET /api/projects/[projectId]/3d/assets/[handle]": "deliverProject3DAsset re-checks hasActiveProject3DViewer (projects module, project.view, project scope, entitlement, release) and the handle's audience/epoch on every request (ADM-04A §8)",
  "HEAD /api/projects/[projectId]/3d/assets/[handle]": "the same delivery as GET, without a body (ADM-04A §8)",
  "ACTION lib/actions/records.ts#decideRecordAction": "delegates to the record section's own decide(), which checks permission and scope",
};

/**
 * Pages of the signed-in shell whose subject is the caller themself, or whose
 * content is assembled from per-module providers each applying its own guard
 * (the dashboard, search, activity): reviewed, and classified AUTHENTICATED.
 */
const SELF_SERVICE_PAGES: Record<string, string> = {
  "/access-denied": "a refusal screen; no data",
  "/module-unavailable": "a refusal screen; no data",
  "/workspace": "the caller's own workspaces (workspace-access)",
  "/notifications": "the caller's own notifications; stale titles withheld (WITHDRAWN_TITLE)",
  "/favorites": "the caller's own favorites, each re-read in scope",
  "/my-work": "the caller's own assigned work, each module in scope",
  "/search": "global search: each provider applies its module, permission and scope",
  "/activity": "activity center: each source applies its module, permission and scope",
  "/dashboard": "dashboard widgets, each behind its module and permission",
  "/settings/profile": "the caller's own profile",
  "/settings/security": "the caller's own sessions and password",
  "/settings/notifications": "the caller's own notification preferences",
};

/** The calls a redirect-only page makes: sending the reader on, and building where to. */
const REDIRECT_HELPERS = /^(redirect|permanentRedirect|notFound|\w*Href|encodeURIComponent|String|toString|get|getAll|has|set|append|entries|join|map|filter)$/;

/** Guards a page or its layouts call: the class of the entry point is read from these. */
const GUARD_NAMES = new Set(["requireUserContext", "requireCompanyContext", "requireModule", "requirePermission", "requirePlatformContext", "getUserContext", "withContext", "withPlatformContext", "resolvePlatformContext", "withGroupContext", "requireGroupContext", "resolveGroupContext"]);
const MODULE_GUARDS = new Set(["assertModule", "requireModule", "moduleAndPermissions", "isModuleEnabled", "canAccessModule", "hasAccessLevel", "getModuleScope", "buildProjectLinkedScopeWhere", "resolveModuleExperience"]);
const SCOPE_PATTERN = /^(build\w*(Scope|Access)Where|\w*Door|readable\w*Where|canAccessProject|accessibleProjectIds|visible\w*Where|\w*ScopeWhere)$/;
const RECORD_PATTERN = /^(loadRecord|canReadRecord|assertFound|find\w*InScope|require(?!UserContext|Module|Permission)[A-Z]\w*|findReadable\w*|findWritable\w*|get[A-Z]\w*OrThrow)$/;
const STATE_PATTERN = /^(stateDenied|applyTransition|assert\w*(State|Status|Live|Writable|Editable|Open|Draft|Transition)\w*|can(Transition|Move)\w*|assertTransition|frozenDocumentReason|touchLog)$/;

/** Domains that carry the request rather than own its data: never named as a data owner. */
const INFRASTRUCTURE = new Set(["actions", "forms", "hooks", "layout", "navigation", "unsaved", "api", "context", "access", "auth", "permissions", "config", "database", "utils", "validation", "http", "app", "core/security", "core/observability", "core/api", "components", "i18n"]);

type Evidence = { permissions: Set<string>; modules: Set<string>; scope: Set<string>; record: Set<string>; state: Set<string>; guards: Set<string> };
const empty = (): Evidence => ({ permissions: new Set(), modules: new Set(), scope: new Set(), record: new Set(), state: new Set(), guards: new Set() });
const merge = (into: Evidence, from: Evidence) => {
  for (const key of Object.keys(into) as (keyof Evidence)[]) for (const value of from[key]) into[key].add(value);
};

const configFile = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);

const routeFiles = walk("app/api", (file) => file.endsWith("/route.ts"));
const actionFiles = walk("lib/actions", (file) => file.endsWith(".ts")).filter((file) => readFileSync(file, "utf8").startsWith('"use server"'));
const pageFiles = walk("app", (file) => file.endsWith("/page.tsx"));
const layoutFiles = walk("app", (file) => file.endsWith("/layout.tsx"));
const extraFiles = ["lib/core/search/search.providers.ts", "lib/core/jobs/job.handlers.ts"];
const program = ts.createProgram([...routeFiles, ...actionFiles, ...pageFiles, ...layoutFiles, ...extraFiles].map((file) => path.join(ROOT, file)), parsed.options);
const checker = program.getTypeChecker();

const relative = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

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

function bodyOf(declaration: ts.Declaration): ts.Node | null {
  if ((ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body) return declaration.body;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) return declaration.initializer;
  if (ts.isPropertyAssignment(declaration)) return declaration.initializer;
  return null;
}

function isStateMachineTable(node: ts.Node): boolean {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineStateMachine";
}

/**
 * Evidence reachable from a node. `jsx` also follows server components a page
 * renders (`<ModuleRecordPage module="support" />`): a page's guard is often in
 * the shared component it hands its route to. Kept in its own memo so route and
 * action evidence is exactly what it was before pages were inventoried.
 */
const memos = { plain: new Map<ts.Node, Evidence>(), jsx: new Map<ts.Node, Evidence>() };

function analyse(node: ts.Node, depth: number, jsx = false): Evidence {
  const memo = jsx ? memos.jsx : memos.plain;
  const cached = memo.get(node);
  if (cached) return cached;
  const evidence = empty();
  memo.set(node, evidence); // a cycle sees what has been gathered so far

  const follow = (nameNode: ts.Node) => {
    if (depth >= MAX_DEPTH) return;
    for (const declaration of declarationsOf(nameNode)) {
      const body = bodyOf(declaration);
      if (body) merge(evidence, analyse(body, depth + 1, jsx));
    }
  };

  const visit = (current: ts.Node) => {
    // A state machine table names the permission each of its transitions
    // requires. That is a declaration of the domain's rules, not a check this
    // endpoint's path performs — descending into it would credit every
    // hazard endpoint with every hazard permission (PRD #49 §156).
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "defineStateMachine") return;

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
      if (GUARD_NAMES.has(name)) evidence.guards.add(name);
      if (SCOPE_PATTERN.test(name)) evidence.scope.add(name);
      if (RECORD_PATTERN.test(name)) evidence.record.add(name);
      if (STATE_PATTERN.test(name)) evidence.state.add(name);
      if (nameNode) follow(nameNode);
    }

    if (jsx && (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current))) {
      // A module named to a shared component is the module it guards.
      for (const attribute of current.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer) && MODULE_SET.has(attribute.initializer.text)) evidence.modules.add(attribute.initializer.text);
      }
      if (ts.isIdentifier(current.tagName) && /^[A-Z]/.test(current.tagName.text)) follow(current.tagName);
    }

    // Permission tables and module constants defined outside the function.
    if (ts.isIdentifier(current) && !ts.isCallExpression(current.parent) && depth < MAX_DEPTH) {
      for (const declaration of declarationsOf(current)) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer && !ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) {
          // A state machine table is a declaration of the domain's rules, not
          // a check on this endpoint's path: reading it would credit every
          // hazard endpoint with every hazard permission (PRD #49 §156).
          if (isStateMachineTable(declaration.initializer)) continue;
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

/**
 * The domain that owns what an entry point reads or writes: the one its body
 * calls into most, by the ownership registry's own reading of a file's place
 * (scripts/architecture/ownership.ts). Request plumbing — context, access,
 * API helpers — owns nothing; a handler calling only that is owned by its module.
 */
function ownerOf(body: ts.Node): string | null {
  const counts = new Map<string, number>();
  const tally = (node: ts.Node, level: number) => {
    const visit = (current: ts.Node) => {
      if (ts.isCallExpression(current)) {
        const callee = current.expression;
        const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : null;
        if (nameNode) {
          for (const declaration of declarationsOf(nameNode)) {
            const domain = domainOfFile(relative(declaration.getSourceFile().fileName));
            if (!INFRASTRUCTURE.has(domain)) counts.set(domain, (counts.get(domain) ?? 0) + 1);
            else if (level === 0) {
              const inner = bodyOf(declaration);
              if (inner) tally(inner, 1);
            }
          }
        }
      }
      ts.forEachChild(current, visit);
    };
    visit(node);
  };
  tally(body, 0);
  const ranked = [...counts.entries()].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  return ranked[0]?.[0] ?? null;
}

/* Entry points --------------------------------------------------------------- */

type Status = "covered" | "uncovered" | "not-applicable";
type Kind = "route" | "action" | "page" | "inline" | "job" | "notification" | "search";
type Row = {
  kind: Kind;
  method: string;
  endpoint: string;
  /** Section heading. */
  group: string;
  cls: string;
  evidence: Evidence;
  owner: string;
  surface: string;
  scopeRule: string;
  /** Test files that exercise the entry point itself. */
  tests: string[];
  /** Test files that exercise a service function it calls, by that function's name. */
  serviceTests: Array<{ service: string; file: string }>;
  sweeps: string[];
  status: Status;
  note?: string;
};

/** What kind of permission-sensitive surface an entry point is (§2): the families RP-10 and RP-18 name. */
function surfaceOf(endpoint: string): string {
  const lower = endpoint.toLowerCase();
  if (/storage\/objects|\/download|\/preview|\/thumbnail|\/files?\b|\/attachments?|\/upload/.test(lower)) return "FILE";
  if (/export|\.csv|\/csv|\/print|\/pdf/.test(lower)) return "EXPORT";
  if (/search|palette/.test(lower)) return "SEARCH";
  if (/notification|activity-center|attention|\/activity\b/.test(lower)) return "NOTIFICATION";
  if (/bulk|batch|mark-all/.test(lower)) return "BULK";
  if (/dashboard|summary|overview|\/reports?\b|kpi/.test(lower)) return "AGGREGATE";
  if (/favorites|recent-work/.test(lower)) return "SAVED-LINK";
  return "";
}

const CLASS_SCOPE: Record<string, string> = {
  COMPANY_SCOPED: "session company",
  AUTHENTICATED: "caller's own rows",
  PLATFORM: "platform session; tenant refused",
  PUBLIC: "none",
  TOKEN: "request token",
  SIGNED: `signed claims (key, method, expiry: download ${DOWNLOAD_URL_TTL_SECONDS}s, preview ${PREVIEW_URL_TTL_SECONDS}s, upload ${UPLOAD_URL_TTL_SECONDS}s)`,
  AUTH_PROVIDER: "credentials",
  UNCLASSIFIED: "unknown — review",
};

function scopeRuleOf(cls: string, evidence: Evidence): string {
  const base = CLASS_SCOPE[cls] ?? cls;
  return evidence.scope.size > 0 ? `${base} + scope builder` : base;
}

function statusOf(cls: string, tests: string[], serviceTests: Row["serviceTests"] = []): Status {
  if (tests.length > 0 || serviceTests.length > 0) return "covered";
  return cls === "PUBLIC" || cls === "AUTH_PROVIDER" ? "not-applicable" : "uncovered";
}

/**
 * The domain services a body calls directly (lib/modules, lib/core; request
 * plumbing excluded), and the tests that exercise each by name.
 */
function serviceTestsOf(body: ts.Node): Row["serviceTests"] {
  const found = new Map<string, { service: string; file: string }>();
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      const nameNode = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.name : null;
      if (nameNode) {
        for (const declaration of declarationsOf(nameNode)) {
          const file = relative(declaration.getSourceFile().fileName);
          if (!/^lib\/(modules|core)\//.test(file) || INFRASTRUCTURE.has(domainOfFile(file))) continue;
          const isFunction = ts.isFunctionDeclaration(declaration) || (ts.isVariableDeclaration(declaration) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer) || ts.isCallExpression(declaration.initializer)));
          if (!isFunction) continue;
          for (const test of testsForService(file, nameNode.text)) found.set(`${nameNode.text}\u0000${test}`, { service: nameNode.text, file: test });
        }
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(body);
  return [...found.values()].sort((a, b) => a.service.localeCompare(b.service) || a.file.localeCompare(b.file));
}

const rows: Row[] = [];

function modulesOf(evidence: Evidence): Set<string> {
  const modules = new Set(evidence.modules);
  for (const permission of evidence.permissions) {
    const moduleKey = moduleForPermission(permission);
    if (moduleKey) modules.add(moduleKey);
  }
  return modules;
}

const fallbackOwner = (evidence: Evidence) => [...modulesOf(evidence)].sort()[0] ?? "—";

/* Route handlers */
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
      const evidence = analyse(body, 0);
      // A handler that answers only a platform session is the platform's, wherever it lives (/api/platform-admin/*).
      const platformOnly = (evidence.guards.has("withPlatformContext") || evidence.guards.has("withGroupContext")) && !evidence.guards.has("withContext");
      const cls: string = ROUTE_CLASSES[pattern] ?? (pattern.startsWith("/api/platform/") || platformOnly ? "PLATFORM" : SELF_SERVICE.some((regex) => regex.test(pattern)) ? "AUTHENTICATED" : "COMPANY_SCOPED");
      const tests = testsForRoute(pattern);
      const serviceTests = serviceTestsOf(body);
      const swept = cls === "COMPANY_SCOPED" || cls === "AUTHENTICATED";
      rows.push({
        kind: "route",
        method,
        endpoint: pattern,
        group: `/api/${pattern.split("/")[2] ?? ""}`,
        cls,
        evidence,
        owner: ownerOf(body) ?? fallbackOwner(evidence),
        surface: surfaceOf(pattern),
        scopeRule: scopeRuleOf(cls, evidence),
        tests,
        serviceTests,
        sweeps: swept ? ROUTE_SWEEPS : [],
        status: statusOf(cls, tests, serviceTests),
      });
    }
  }
}

/* Server actions */
const actionClassOf = new Map<string, string>();
for (const file of actionFiles) {
  const source = program.getSourceFile(path.join(ROOT, file))!;
  if (!fileHasUseServer(source)) continue;
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    if (!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const publicAction = /lib\/actions\/(auth|contact|demo)\.ts$/.test(file);
    const endpoint = `${file}#${statement.name.text}`;
    const cls = ACTION_CLASSES[endpoint] ?? ACTION_CLASSES[file] ?? (publicAction ? "PUBLIC" : "COMPANY_SCOPED");
    actionClassOf.set(statement.name.text, cls);
    const evidence = analyse(statement.body, 0);
    const tests = testsForAction(file, statement.name.text);
    const serviceTests = serviceTestsOf(statement.body);
    rows.push({
      kind: "action",
      method: "ACTION",
      endpoint,
      group: `Server actions — ${path.basename(file, ".ts")}`,
      cls,
      evidence,
      owner: ownerOf(statement.body) ?? fallbackOwner(evidence),
      surface: surfaceOf(statement.name.text.replace(/([A-Z])/g, "-$1")),
      scopeRule: scopeRuleOf(cls, evidence),
      tests,
      serviceTests,
      sweeps: publicAction ? [] : ACTION_SWEEPS,
      status: statusOf(cls, tests, serviceTests),
    });
  }
}

/* Pages, with the guards of every layout above them */
const routeOfPage = (file: string) =>
  file
    .replace(/^app/, "")
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/") || "/";

function defaultExportBody(file: string): ts.Node | null {
  const source = program.getSourceFile(path.join(ROOT, file));
  if (!source) return null;
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return statement.body;
  }
  return null;
}

const layoutEvidence = new Map<string, Evidence>();
function layoutsAbove(file: string): Evidence {
  const merged = empty();
  let dir = path.dirname(file);
  while (dir.startsWith("app")) {
    const layout = `${dir}/layout.tsx`;
    if (layoutFiles.includes(layout)) {
      if (!layoutEvidence.has(layout)) {
        const body = defaultExportBody(layout);
        // A layout's guard is its own: the shell's children are not its evidence.
        layoutEvidence.set(layout, body ? analyse(body, 0) : empty());
      }
      merge(merged, layoutEvidence.get(layout)!);
    }
    dir = path.dirname(dir);
  }
  return merged;
}

const inShell = (file: string) => file.startsWith("app/(nesto)/");
const isPublicPage = (file: string) => file.startsWith("app/(public)/") || file.startsWith("app/(public-viewer)/") || file === "app/maintenance/page.tsx" || file === "app/workspace-unavailable/page.tsx";

function pageClass(file: string, route: string, own: Evidence, layouts: Evidence, redirectOnly: boolean): { cls: string; note?: string } {
  const guards = new Set([...own.guards, ...layouts.guards]);
  if (guards.has("requirePlatformContext") || guards.has("resolvePlatformContext") || guards.has("requireGroupContext") || guards.has("resolveGroupContext")) return { cls: "PLATFORM" };
  if (isPublicPage(file)) return { cls: "PUBLIC" };
  // The offline workspace renders nothing from the server: it reads this device's own database, and every sync call it makes is a guarded API route (MOB-09).
  if (file.startsWith("app/(offline)/")) return { cls: "AUTHENTICATED", note: "device-local shell; renders no server data; signed in via middleware" };
  if (inShell(file) && (guards.has("requireUserContext") || guards.has("requireCompanyContext") || guards.has("requireModule"))) {
    if (own.modules.size > 0 || own.permissions.size > 0 || own.record.size > 0) return { cls: "COMPANY_SCOPED" };
    if (redirectOnly) return { cls: "AUTHENTICATED", note: "redirect only; renders no data" };
    const reviewed = Object.entries(SELF_SERVICE_PAGES).find(([prefix]) => route === prefix || route.startsWith(`${prefix}/`));
    if (reviewed) return { cls: "AUTHENTICATED", note: reviewed[1] };
  }
  return { cls: "UNCLASSIFIED" };
}

for (const file of pageFiles) {
  const body = defaultExportBody(file);
  const route = routeOfPage(file);
  const own = body ? analyse(body, 0, true) : empty();
  const layouts = layoutsAbove(file);
  const { cls, note } = pageClass(file, route, own, layouts, body ? isRedirectOnly(body) : false);
  // The page's own evidence, and the guards of the layouts above it — not
  // everything the shell's layout reaches, which every page would share.
  const evidence = empty();
  merge(evidence, own);
  for (const guard of layouts.guards) evidence.guards.add(guard);
  const tests = testsForPage(file, route);
  const serviceTests = body ? serviceTestsOf(body) : [];
  const top = route.split("/")[1] ?? "";
  rows.push({
    kind: "page",
    method: "PAGE",
    endpoint: route,
    group: `Pages — /${top}`,
    cls,
    evidence,
    owner: (body && ownerOf(body)) ?? fallbackOwner(own),
    surface: surfaceOf(route),
    scopeRule: scopeRuleOf(cls, own),
    tests,
    serviceTests,
    sweeps: [],
    status: statusOf(cls, tests, serviceTests),
    note,
  });

  // Inline `"use server"` closures: callable from the browser like any action.
  const source = program.getSourceFile(path.join(ROOT, file))!;
  const visit = (node: ts.Node) => {
    const fn = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ? node : null;
    if (fn && hasUseServerDirective(fn.body)) {
      const name = ts.isFunctionDeclaration(fn) && fn.name ? fn.name.text : ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : "(anonymous)";
      const inlineEvidence = analyse(fn.body!, 0);
      // The closure's authority is the exported action it hands the request to.
      const delegates = [...new Set([...collectCalls(fn.body!)].filter((called) => actionClassOf.has(called)))].sort();
      const delegatedClass = delegates.map((called) => actionClassOf.get(called)!).sort()[0];
      const inlineClass = delegatedClass ?? (inlineEvidence.permissions.size + inlineEvidence.modules.size + inlineEvidence.record.size > 0 ? "COMPANY_SCOPED" : "UNCLASSIFIED");
      const actionTests = delegates.flatMap((called) => {
        const actionFile = rows.find((row) => row.kind === "action" && row.endpoint.endsWith(`#${called}`))?.endpoint.split("#")[0];
        return actionFile ? testsForAction(actionFile, called) : [];
      });
      const inlineTests = [...new Set([...actionTests, ...tests])].sort();
      const inlineServiceTests = delegates.flatMap((called) => rows.find((row) => row.kind === "action" && row.endpoint.endsWith(`#${called}`))?.serviceTests ?? []);
      rows.push({
        kind: "inline",
        method: "INLINE",
        endpoint: `${route} · ${name}`,
        group: "Inline server actions (pages)",
        cls: inlineClass,
        evidence: inlineEvidence,
        owner: ownerOf(fn.body!) ?? fallbackOwner(inlineEvidence),
        surface: "",
        scopeRule: scopeRuleOf(inlineClass, inlineEvidence),
        tests: inlineTests,
        serviceTests: inlineServiceTests,
        sweeps: delegates.length > 0 ? ACTION_SWEEPS : [],
        status: statusOf(inlineClass, inlineTests, inlineServiceTests),
        note: delegates.length > 0 ? `delegates to ${delegates.map((called) => `\`${called}\``).join(", ")}; route ids bound server-side` : undefined,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** A page that only sends the reader elsewhere: it calls `redirect` and nothing that reads data. */
function isRedirectOnly(body: ts.Node): boolean {
  const calls = collectCalls(body);
  return (calls.has("redirect") || calls.has("permanentRedirect")) && [...calls].every((name) => REDIRECT_HELPERS.test(name));
}

function collectCalls(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isIdentifier(callee)) names.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) names.add(callee.name.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}

/* Background jobs: a trusted system actor, never a viewer's session (AUD-06 §7) */
const handlerSource = program.getSourceFile(path.join(ROOT, "lib/core/jobs/job.handlers.ts"))!;
const handlerBodies = new Map<string, ts.Node>();
const findHandlers = (node: ts.Node) => {
  if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name)) handlerBodies.set(node.name.text, node.initializer);
  ts.forEachChild(node, findHandlers);
};
findHandlers(handlerSource);
const JOB_SCOPE: Record<string, string> = {
  COMPANY: "each company through forEachCompany, own SystemContext",
  RECORD: "each queued item's own company",
  PLATFORM: "technical rows of no company",
};
for (const job of [...JOBS].sort((a, b) => a.key.localeCompare(b.key))) {
  const body = handlerBodies.get(job.key);
  const evidence = body ? analyse(body, 0) : empty();
  const tests = testsForKey(job.key);
  rows.push({
    kind: "job",
    method: "JOB",
    endpoint: job.key,
    group: "Background jobs (lib/core/jobs/job.registry.ts)",
    cls: "SYSTEM",
    evidence,
    owner: job.owner,
    surface: job.key.startsWith("notifications") ? "NOTIFICATION" : job.key.startsWith("storage") || job.key.startsWith("documents") ? "FILE" : "",
    scopeRule: `${JOB_SCOPE[job.companyScope] ?? job.companyScope}; suspended companies ${job.suspendedCompanies.toLowerCase().replace("_", " ")}`,
    tests,
    serviceTests: [],
    sweeps: [],
    status: body ? statusOf("SYSTEM", tests) : "uncovered",
    note: body ? undefined : "no handler in job.handlers.ts",
  });
}

/* Notification events: recipients re-checked at dispatch; lists withhold stale titles (AUD-06 RP-18) */
for (const definition of [...notificationEventDefinitions()].sort((a, b) => a.eventType.localeCompare(b.eventType))) {
  const tests = testsForKey(definition.eventType);
  const gate = [definition.permission ? "event permission" : null, definition.discussion ? "discussion access" : null].filter(Boolean).join(" + ");
  rows.push({
    kind: "notification",
    method: "EVENT",
    endpoint: definition.eventType,
    group: "Notification events (lib/core/notifications/notification.events.ts)",
    cls: "NOTIFICATION",
    evidence: empty(),
    owner: "core/notifications",
    surface: "NOTIFICATION",
    scopeRule: `recipient re-checked at dispatch: record read${gate ? ` + ${gate}` : ""}; lists withhold titles of records no longer readable`,
    tests,
    serviceTests: [],
    sweeps: [],
    status: statusOf("NOTIFICATION", tests),
    note: `category ${definition.category}${definition.mandatory ? ", mandatory" : ""}`,
  });
}

/* Global search providers: each applies its module's own list rules (PRD #26 §22) */
const providerSource = program.getSourceFile(path.join(ROOT, "lib/core/search/search.providers.ts"))!;
const providerArray = (() => {
  let found: ts.ArrayLiteralExpression | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "searchProviders" && node.initializer && ts.isArrayLiteralExpression(node.initializer)) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(providerSource);
  return found as ts.ArrayLiteralExpression | null;
})();
for (const element of providerArray?.elements ?? []) {
  if (!ts.isIdentifier(element)) continue;
  const declaration = declarationsOf(element).find(ts.isVariableDeclaration);
  const object = declaration?.initializer && ts.isObjectLiteralExpression(declaration.initializer) ? declaration.initializer : null;
  if (!object) continue;
  const moduleKey = object.properties.map((property) => (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "moduleKey" ? stringValue(property.initializer) : null)).find(Boolean) ?? "—";
  const entityTypes = object.properties.flatMap((property) =>
    ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "entityTypes" && ts.isArrayLiteralExpression(property.initializer) ? property.initializer.elements.filter(ts.isStringLiteralLike).map((literal) => literal.text) : [],
  );
  const method = object.properties.find((property) => (ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property)) && ts.isIdentifier(property.name!) && (property.name as ts.Identifier).text === "search");
  const body = method ? (ts.isMethodDeclaration(method) ? method.body : (method as ts.PropertyAssignment).initializer) : undefined;
  const evidence = body ? analyse(body, 0) : empty();
  if (moduleKey !== "—") evidence.modules.add(moduleKey);
  const tests = testsForSearchProvider(moduleKey, entityTypes);
  const hasGate = evidence.permissions.size > 0 || evidence.scope.size > 0 || evidence.record.size > 0;
  rows.push({
    kind: "search",
    method: "SEARCH",
    endpoint: `${element.text} (${entityTypes.join(", ")})`,
    group: "Global search providers (lib/core/search/search.providers.ts)",
    cls: hasGate ? "COMPANY_SCOPED" : "UNCLASSIFIED",
    evidence,
    owner: moduleKey,
    surface: "SEARCH",
    scopeRule: scopeRuleOf(hasGate ? "COMPANY_SCOPED" : "UNCLASSIFIED", evidence),
    tests,
    serviceTests: [],
    sweeps: [],
    status: statusOf("COMPANY_SCOPED", tests),
  });
}

/* Render ------------------------------------------------------------------ */

const list = (values: Iterable<string>, limit: number) => {
  const sorted = [...values].sort();
  if (sorted.length === 0) return "—";
  const shown = sorted.slice(0, limit).map((value) => `\`${value}\``).join(", ");
  return sorted.length > limit ? `${shown} +${sorted.length - limit}` : shown;
};

const testsCell = (row: Row) => {
  const parts: string[] = [];
  if (row.tests.length > 0) parts.push(`${row.tests.slice(0, 2).map((file) => `\`${file.replace(/^tests\//, "")}\``).join(", ")}${row.tests.length > 2 ? ` +${row.tests.length - 2}` : ""}`);
  if (row.serviceTests.length > 0) {
    const [first] = row.serviceTests;
    const files = new Set(row.serviceTests.map((entry) => entry.file));
    parts.push(`via \`${first.service}\`: \`${first.file.replace(/^tests\//, "")}\`${files.size > 1 ? ` +${files.size - 1}` : ""}`);
  }
  if (row.sweeps.length > 0) parts.push("sweep");
  return parts.join("; ") || "—";
};

const reviewedKey = (row: Row) => `${row.method} ${row.endpoint}`;
const unguarded = rows.filter((row) => (row.kind === "route" || row.kind === "action") && row.cls === "COMPANY_SCOPED" && !REVIEWED[reviewedKey(row)] && row.evidence.permissions.size === 0 && row.evidence.modules.size === 0 && row.evidence.record.size === 0);
const unclassified = rows.filter((row) => row.cls === "UNCLASSIFIED");

const kinds: Array<[Kind, string]> = [
  ["route", "route handlers"],
  ["action", "server actions"],
  ["page", "pages"],
  ["inline", "inline page actions"],
  ["job", "background jobs"],
  ["notification", "notification events"],
  ["search", "search providers"],
];
const count = <T extends string>(values: T[]) => values.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});

const lines: string[] = [];
lines.push("# Entry-point security matrix");
lines.push("");
lines.push("<!-- Generated by `pnpm security:matrix` (scripts/security/api-matrix.ts). Do not edit by hand; CI fails when it is stale. -->");
lines.push("");
lines.push("Every permission-sensitive entry point NESTO exposes — route handlers, server actions, pages, inline page actions, the signed storage endpoint, background jobs, notification events and search providers — with the authorization evidence found on its call path, the domain that owns its data, the tests that exercise it and an outcome (PRD #47 §105, §156; AUD-06 §2, RP-10, RP-24). See [authorization-model.md](authorization-model.md) for the model, [access-manifest.json](access-manifest.json) for who holds what, and [access-exceptions.md](access-exceptions.md) for every deliberate deviation.");
lines.push("");
lines.push("- **Class** — `COMPANY_SCOPED`: session + active membership + company, then module/permission/scope/record checks. `AUTHENTICATED`: the caller's own data (profile, sessions, notifications, favorites, recent work). `PLATFORM`: a platform session; tenant sessions are refused. `PUBLIC` / `TOKEN` / `SIGNED` / `AUTH_PROVIDER`: no session; the credential that replaces it is described in the model. `SYSTEM`: a background job acting as a trusted system actor. `NOTIFICATION`: an event whose recipients are re-checked at dispatch. `UNCLASSIFIED`: nothing on the path classifies it — listed below for review, never dropped.");
lines.push("- **Surface** — the §2 families: `FILE` (download, preview, upload, storage), `EXPORT`, `SEARCH`, `NOTIFICATION`, `BULK`, `AGGREGATE` (dashboards, summaries, reports), `SAVED-LINK` (favorites, recent work).");
lines.push("- **Owner** — the domain whose services the entry point calls into most (scripts/architecture/ownership.ts's reading of a file's place); for jobs, the registry's owner.");
lines.push("- **Modules**, **Expected permission**, **Scope**, **Record guard**, **State guard** — what the static call-graph analysis found reachable from the handler (for a page, from the page, the server components it renders and every layout above it). Evidence, not proof.");
lines.push("- **Tests** — the specific test files that exercise the entry point: a test importing the route or page module, requesting its URL, importing and naming the action, or naming the job or event key. `sweep` marks the discovery sweeps (`tests/security/cross-company-api.test.ts`, `cross-company-actions.test.ts`, `module-disabled.test.ts`, `project-isolation.test.ts`) that attack every session route and action by class.");
lines.push("- **Tests**, continued — `via fn: file` names a test that imports and exercises a domain service the entry point calls directly (the permission, scope and record checks live there; the route or action is a door onto it, PRD #48 §108). It proves the service's authorization, not the door's own guard.");
lines.push("- **Status** — `covered`: at least one specific test exercises it, directly or through the service it calls. `uncovered`: none does (a sweep alone is not counted). `not-applicable`: a public page or provider endpoint with no tenant data.");
lines.push("");
lines.push(`**${kinds.map(([kind, label]) => `${rows.filter((row) => row.kind === kind).length} ${label}`).join(", ")}.** ${Object.entries(count(rows.map((row) => row.cls))).sort().map(([cls, n]) => `${cls} ${n}`).join(" · ")}.`);
lines.push("");
const direct = rows.filter((row) => row.tests.length > 0).length;
lines.push(`Status: ${Object.entries(count(rows.map((row) => row.status))).sort().map(([status, n]) => `${status} ${n}`).join(" · ")} (${direct} by a test of the entry point itself, ${rows.filter((row) => row.tests.length === 0 && row.serviceTests.length > 0).length} only through a service it calls). Company-scoped routes and actions with no check on their path: **${unguarded.length}**. Unclassified entry points: **${unclassified.length}**.`);
lines.push("");

lines.push("## Unclassified entry points");
lines.push("");
if (unclassified.length === 0) {
  lines.push("None.");
} else {
  lines.push("Nothing on these paths names a module, permission, record guard or a reviewed self-service purpose. Each is permission-sensitive until shown otherwise; see [access-exceptions.md](access-exceptions.md).");
  lines.push("");
  lines.push("| Kind | Entry point | Guards found | Owner | Tests |");
  lines.push("|---|---|---|---|---|");
  for (const row of unclassified) lines.push(`| ${row.method} | \`${row.endpoint}\` | ${list(row.evidence.guards, 3)} | ${row.owner} | ${testsCell(row)} |`);
}
lines.push("");

lines.push("## Sensitive surfaces");
lines.push("");
lines.push("| Surface | Entry points | covered | uncovered | not-applicable |");
lines.push("|---|---|---|---|---|");
for (const surface of [...new Set(rows.map((row) => row.surface).filter(Boolean))].sort()) {
  const members = rows.filter((row) => row.surface === surface);
  const statuses = count(members.map((row) => row.status));
  lines.push(`| ${surface} | ${members.length} | ${statuses.covered ?? 0} | ${statuses.uncovered ?? 0} | ${statuses["not-applicable"] ?? 0} |`);
}
lines.push("");

const groups = new Map<string, Row[]>();
for (const row of rows) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
const groupRank = (group: string) => (group.startsWith("/api/") ? 0 : group.startsWith("Server actions") ? 1 : group.startsWith("Pages") ? 2 : group.startsWith("Inline") ? 3 : group.startsWith("Background") ? 4 : group.startsWith("Notification") ? 5 : 6);

for (const [group, groupRows] of [...groups.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))) {
  lines.push(`## ${group}`);
  lines.push("");
  lines.push("| Method | Entry point | Class | Surface | Owner | Modules | Expected permission | Scope | Record guard | State guard | Tests | Status |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const row of [...groupRows].sort((a, b) => (row2key(a) < row2key(b) ? -1 : row2key(a) > row2key(b) ? 1 : 0))) {
    const endpoint = row.kind === "action" ? `\`${row.endpoint.split("#")[1]}\`` : `\`${row.endpoint}\``;
    const reviewed = REVIEWED[reviewedKey(row)] ? ` (reviewed: ${REVIEWED[reviewedKey(row)]})` : "";
    const note = row.note ? ` (${row.note})` : "";
    const scope = row.evidence.scope.size > 0 ? `${CLASS_SCOPE[row.cls] ?? row.cls}; ${list(row.evidence.scope, 2)}` : row.scopeRule;
    lines.push(`| ${row.method} | ${endpoint}${reviewed}${note} | ${row.cls} | ${row.surface || "—"} | ${row.owner} | ${list(modulesOf(row.evidence), 3)} | ${list(row.evidence.permissions, 3)} | ${scope} | ${list(row.evidence.record, 2)} | ${list(row.evidence.state, 2)} | ${testsCell(row)} | ${row.status} |`);
  }
  lines.push("");
}

function row2key(row: Row): string {
  // Routes keep the order they are discovered in (file, then handler); everything else by name.
  return row.kind === "route" ? "" : `${row.endpoint}\u0000${row.method}`;
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
  else console.log(`✓ entry-point security matrix is current: ${rows.length} entry points, none unguarded, ${unclassified.length} unclassified (listed)`);
} else {
  writeFileSync(OUTPUT, document);
  console.log(`wrote ${OUTPUT}: ${rows.length} entry points (${unguarded.length} company-scoped with no check on their path, ${unclassified.length} unclassified)`);
  for (const row of unguarded) console.log(`  unguarded: ${row.method} ${row.endpoint}`);
}
