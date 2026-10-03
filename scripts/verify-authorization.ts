/**
 * Static authorization gates (PRD #47 §103-§107, §158, §162-§166).
 *
 * Every rule here is something a reviewer would otherwise have to remember:
 *
 *   1. every API route is classified, and every session route runs its
 *      handlers inside `withContext` (§103, §104, §107);
 *   2. every server action resolves the user context before it does anything,
 *      unless it is on the short public list (§12, §103);
 *   3. no authorization decision compares a role name, outside the documented
 *      exceptions (§30-§32, §164);
 *   4. no request schema accepts a field the server must own (§60, §61, §165);
 *   5. the number of Prisma calls addressed by `id` alone does not grow without
 *      review (§16, §19, §166).
 *
 * `pnpm verify:authorization` — exits non-zero on any failure.
 * `pnpm verify:authorization --update-baseline` — re-records rule 5's counts
 * after the new call sites have been reviewed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import ts from "typescript";

import { ROUTE_CLASSES } from "./security/route-classes";
import { calledNames, fileHasUseServer, hasUseServerDirective, lineOf, parse, walk } from "./security/source";

const failures: string[] = [];
const fail = (rule: string, message: string) => failures.push(`[${rule}] ${message}`);

/* 1. API routes ------------------------------------------------------------ */

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Factories that return a handler already wrapped in `withContext`. Each is verified below. */
const CONTEXT_WRAPPERS: Record<string, string> = {
  decisionHandler: "lib/modules/approvals/approvals.routes.ts",
};

for (const [wrapper, file] of Object.entries(CONTEXT_WRAPPERS)) {
  if (!existsSync(file) || !calledNames(parse(file)).has("withContext")) fail("routes", `${wrapper} in ${file} no longer calls withContext`);
}

const routeFiles = walk("app/api", (file) => file.endsWith("/route.ts"));
for (const file of routeFiles) {
  const pattern = file.replace(/^app/, "").replace(/\/route\.ts$/, "");
  const source = parse(file);
  if (ROUTE_CLASSES[pattern]) continue;
  // The platform's own routes run for a platform session, which carries no company (E-06 §116).
  const wrapper = pattern.startsWith("/api/platform/") || pattern.startsWith("/api/platform-admin/")
    ? "withPlatformContext"
    : "withContext";

  let handlers = 0;
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name && HTTP_METHODS.includes(statement.name.text)) {
      handlers += 1;
      if (!statement.body || !calledNames(statement.body).has(wrapper)) {
        fail("routes", `${file}:${lineOf(source, statement)} ${statement.name.text} does not run inside ${wrapper}`);
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !HTTP_METHODS.includes(declaration.name.text)) continue;
        handlers += 1;
        const init = declaration.initializer;
        const wrapper = init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) ? init.expression.text : null;
        const inline = init && calledNames(init).has("withContext");
        if (!inline && !(wrapper && CONTEXT_WRAPPERS[wrapper])) {
          fail("routes", `${file}:${lineOf(source, declaration)} ${declaration.name.text} is neither wrapped in withContext nor built by a verified wrapper`);
        }
      }
    }
  }
  if (handlers === 0) fail("routes", `${file} exports no recognisable handler; classify it in ROUTE_CLASSES or export GET/POST/…`);
}

/* 2. Server actions -------------------------------------------------------- */

const CONTEXT_RESOLVERS = new Set([
  "requireUserContext",
  // A business write belongs to one company, so it refuses in the Group
  // workspace before it does anything (Workspace Context §59).
  "requireCompanyContext",
  "getUserContext",
  "resolveUserContext",
  "requireModule",
  "requirePermission",
]);

/**
 * Actions that run without a workspace context, and what protects each instead.
 * Anything else that skips the context fails the build.
 */
const PUBLIC_ACTIONS: Record<string, string> = {
  "lib/actions/auth.ts#signInAction": "credentials + throttling (PRD #6, #38 M1)",
  "lib/actions/auth.ts#endSessionAction": "ends the caller's own session",
  "lib/actions/auth.ts#signOutAction": "ends the caller's own session",
  "lib/actions/auth.ts#requestPasswordResetAction": "identical answer for every email, throttled",
  "lib/actions/auth.ts#resetPasswordAction": "single-use reset token",
  "lib/actions/contact.ts#submitContactAction": "public site contact form, throttled",
};

/** Public actions discovered in the team module's invitation flow carry a token, not a session. */
const TOKEN_ACTION_PATTERN = /Invite|invite/;

let actionsChecked = 0;
const actionFiles = walk("lib", (file) => /\.tsx?$/.test(file)).concat(walk("app", (file) => /\.tsx?$/.test(file)));
for (const file of actionFiles) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("use server")) continue;
  const source = parse(file);
  const moduleLevel = fileHasUseServer(source);

  const check = (name: string, body: ts.Node, node: ts.Node, inline: boolean) => {
    actionsChecked += 1;
    const key = `${file}#${name}`;
    const calls = calledNames(body);
    if ([...calls].some((call) => CONTEXT_RESOLVERS.has(call))) return;
    if (PUBLIC_ACTIONS[key]) return;
    if (!inline && TOKEN_ACTION_PATTERN.test(name) && /token/i.test(body.getText(source))) return;
    // An inline page action that hands straight to an exported action is
    // checked where that action is defined.
    if (inline && [...calls].some((call) => /Action$/.test(call))) return;
    fail("actions", `${file}:${lineOf(source, node)} server action ${name} does not resolve the user context`);
  };

  const visit = (node: ts.Node) => {
    if (moduleLevel && node.parent === source) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        check(node.name.text, node.body, node, false);
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && hasUseServerDirective(node.body)) {
      const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text : "(inline action)";
      check(name, node.body!, node, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/* 3. Literal role checks --------------------------------------------------- */

const ROLE_COMPARISON = /(?:\bcontext|\bctx|\bviewer|\bactor|\bmember|\bexisting|\brole)\??\.(?:role|key)\s*[!=]==|\broleKey\s*[!=]==|\brole\.key\s*[!=]==|approverRoleKey\s*[!=]==|[!=]==\s*(?:context|ctx)\.role\b|\.includes\((?:context|ctx)\.role\)|role:\s*\{\s*key:\s*["{]/;

/**
 * Where a role name legitimately decides something (§32): each is an invariant
 * of the platform or a configured assignment, not a shortcut past permissions.
 */
const ROLE_CHECK_EXCEPTIONS: Record<string, string> = {
  "lib/core/approvals/approval-steps.ts": "a step configured for a role is assigned to that role (PRD #41 §33)",
  "lib/modules/procurement/approvals/approval.service.ts": "role-assigned procurement approval steps (PRD #41)",
  "lib/core/notifications/attention.conditions.ts": "recipients of a role-assigned approval step",
  "lib/modules/team/team.service.ts": "the company must keep an Owner; Owner changes need team.owner.assign (PRD #14 §94)",
  "lib/modules/team/team.repository.ts": "active Owner count for the last-Owner invariant",
  "lib/modules/team/team.options.ts": "Owner is only offered to members holding team.owner.assign",
  "lib/modules/team/invitations/invite.service.ts": "inviting an Owner requires team.owner.assign",
  "lib/modules/project-planning/planning.attention.ts": "notification recipients only; the dispatcher re-authorizes each (PRD #47 §242)",
  "lib/modules/dashboard/dashboard.service.ts": "chooses a dashboard layout, never data access",
  "lib/modules/company/company-bootstrap.service.ts": "creating a company's first Owner (PRD #38 §10)",
  "lib/modules/platform/platform-implementation.service.ts": "the implementation checklist asks whether a group has an Owner and Group IT yet (E-06 §39, §40, §71); it grants nothing",
  "lib/modules/timesheets/timesheet.reports.ts": "the role set is derived from who holds timesheet.submit_own, not named",
  "lib/modules/organization/organization-integrity.ts": "a read-only consistency check that a position is held with the role its holder works as (E-06 §6.5); it grants nothing",
};

for (const file of walk("lib", (candidate) => /\.tsx?$/.test(candidate)).concat(walk("app", (candidate) => /\.tsx?$/.test(candidate)))) {
  if (file.startsWith("lib/i18n/")) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (!ROLE_COMPARISON.test(line)) return;
    if (/participant|\brow\.role\b|person\.role|input\.role|value\.role/.test(line)) return; // meeting participant roles, not company roles
    if (ROLE_CHECK_EXCEPTIONS[file]) return;
    fail("roles", `${file}:${index + 1} compares a role name: ${line.trim().slice(0, 120)}`);
  });
}

/* 4. Server-owned fields in request schemas ------------------------------- */

const SERVER_OWNED_FIELDS = ["companyId", "membershipId", "actorMemberId", "createdByMemberId", "updatedByMemberId", "approvedByMemberId", "decidedByMemberId", "archivedByMemberId", "submittedByMemberId", "uploadedByMemberId", "createdBy", "approvedBy", "reviewedBy", "permissions", "roleKey"];
const SCHEMA_FIELD = new RegExp(`^\\s*(${SERVER_OWNED_FIELDS.join("|")})\\s*:\\s*z\\.`);

/** Schemas that name one of these fields for a reason other than trusting it. */
const SCHEMA_FIELD_EXCEPTIONS: Record<string, string> = {
  "lib/modules/documents/document.schema.ts#uploadedByMemberId": "list filter; only narrows the scoped document query",
  "lib/modules/tasks/task.schema.ts#createdByMemberId": "list filter; only narrows the scoped task query",
  "lib/modules/platform/platform.schema.ts#roleKey":
    "the role a person of the approved initial roster is given, set by the Platform Admin while a group is implementing and never a session's own role; refused once the group is active (E-06 §30, §138)",
  "lib/modules/projects/project.schema.ts#companyId":
    "Projects page filter, which only narrows the union of the person's own memberships' project scopes; and the company a new project is created in, which contextForCompany re-checks against the person's own active memberships and project.create there (E-05A §30, §39)",
  "lib/3d/shared/release.schema.ts#companyId":
    "immutable server-built release manifest validation; this schema is never used to accept a request body",
  "lib/modules/platform/platform-control.schema.ts#roleKey":
    "the target membership role chosen by a separately authorized Platform Admin, never the caller's role",
  "lib/workspace/workspace.service.ts#companyId":
    "the workspace being switched to: a request, re-checked against the caller's own active membership and standing before the session moves, and answered the same whether it is somebody else's company or none (Workspace Context §14, §80, §81)",
  "lib/modules/sales/leads/lead.schema.ts#companyId":
    "Group workspace list filter; narrowToCompany intersects it with the companies the person already reads and ignores any other (Workspace Context §86, §87)",
  "lib/modules/sales/opportunities/opportunity.schema.ts#companyId":
    "Group workspace list filter; narrowToCompany intersects it with the companies the person already reads and ignores any other (Workspace Context §86, §87)",
  "lib/modules/project-3d/project-3d.schema.ts#companyId":
    "Platform Admin 3D provisioning (platform.3d.configure): the company of the Project being provisioned, used only together with projectId and parentGroupId, all three of which must match one real Project of a non-fixture group or the request is not found",
  "lib/modules/activity/activity-center.schema.ts#companyId":
    "Activity Center filter; narrowed to the person's own memberships, and a company they may not use is refused with 403 (Activity Center §38, §142)",
  "lib/modules/productivity/productivity.schema.ts#companyId":
    "My Work filter; applied only when it names a company among the person's own visible rows, otherwise dropped (Fast Re-entry §63, §168)",
  "lib/modules/quick-create/quick-create.schema.ts#companyId":
    "the company a Quick Create launch targets; re-checked against the person's own group memberships and the create permission there, refused otherwise (Quick Create §140, §147)",
};

for (const file of walk("lib", (candidate) => candidate.endsWith(".ts"))) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("from \"zod\"")) continue;
  text.split("\n").forEach((line, index) => {
    const match = SCHEMA_FIELD.exec(line);
    if (match && !SCHEMA_FIELD_EXCEPTIONS[`${file}#${match[1]}`]) {
      fail("schemas", `${file}:${index + 1} request schema accepts server-owned field "${match[1]}"`);
    }
  });
}

/* 5. Prisma calls addressed by id alone ------------------------------------ */

const BASELINE = "scripts/security/unscoped-by-id.baseline.json";
const BY_ID = /\.(findUnique|findUniqueOrThrow|update|delete|upsert)\(\s*\{\s*where:\s*\{\s*id(?:\s*[,}]|:\s*[\w.]+\s*[,}])/g;

const counts: Record<string, number> = {};
for (const file of walk("lib", (candidate) => /\.tsx?$/.test(candidate)).concat(walk("app", (candidate) => /\.tsx?$/.test(candidate)))) {
  const found = readFileSync(file, "utf8").match(BY_ID)?.length ?? 0;
  if (found > 0) counts[file] = found;
}

if (process.argv.includes("--update-baseline")) {
  writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`recorded ${Object.values(counts).reduce((sum, value) => sum + value, 0)} by-id call sites in ${BASELINE}`);
} else {
  const baseline: Record<string, number> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  for (const [file, count] of Object.entries(counts)) {
    if (count > (baseline[file] ?? 0)) {
      fail("by-id", `${file} has ${count} Prisma call(s) addressed by id alone (baseline ${baseline[file] ?? 0}). Scope the lookup by companyId, or — if the row was just loaded in scope — review and run with --update-baseline`);
    }
  }
}

/* ------------------------------------------------------------------------- */

if (failures.length > 0) {
  console.error(`✗ verify:authorization — ${failures.length} failure(s) (${routeFiles.length} routes, ${actionsChecked} server actions checked)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`✓ verify:authorization — ${routeFiles.length} routes, ${actionsChecked} server actions, role checks, request schemas and by-id queries`);
}
