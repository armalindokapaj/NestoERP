import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { PRE_STREAM_ROUTES, type PreStreamRoute } from "../../app/(nesto)/pre-stream-routes";

/**
 * NAV-01 route inventory (LOAD-04).
 *
 * Every authenticated page, its nearest loading boundary and skeleton variant,
 * where its guard runs, and whether a document status is asserted before the
 * stream starts. Read from the source tree, so it is right for whatever branch
 * it runs on — the 459 pages of the PRD's snapshot are a baseline, not a rule.
 *
 *   tsx scripts/navigation/route-inventory.ts          # print a summary
 *   tsx scripts/navigation/route-inventory.ts --write  # regenerate the doc
 *
 * tests/unit/navigation/route-inventory.test.ts holds the invariant: no page
 * without a loading ancestor.
 */

export const NESTO_ROOT = join(process.cwd(), "app", "(nesto)");
export const INVENTORY_DOC = join(process.cwd(), "docs", "navigation", "NAV-01-route-inventory.md");

/** Where each pre-stream status contract is asserted (NAV-01 §2.1); the routes are `PRE_STREAM_ROUTES`. */
const CONTRACT_SPECS: Record<PreStreamRoute, string> = {
  "/clients/[clientId]": "clients.spec.ts",
  "/documents/[documentId]": "documents.spec.ts",
  "/tasks/[taskId]": "tasks.spec.ts, role-acceptance.spec.ts",
  "/people/[personId]": "people-links.spec.ts",
  "/hr/employees/[employeeId]": "hr.spec.ts",
  "/hr/employees/[employeeId]/compensation": "hr.spec.ts",
  "/projects/[projectId]/units/[unitId]": "project-structure.spec.ts",
  "/projects/types": "projects.spec.ts",
  "/support/[section]/[recordId]": "department-modules.spec.ts",
  "/qaqc/inspections/[inspectionId]": "qaqc.spec.ts",
};

export const STATUS_CONTRACTS: Record<string, string> = Object.fromEntries(
  PRE_STREAM_ROUTES.map((route) => [route, `404 before streaming · guard in \`pre-stream-guards.ts\` · ${CONTRACT_SPECS[route]}`]),
);

/** Pages that only answer with an outcome: they draw no data of their own. */
const OUTCOME_ROUTES = new Set(["/access-denied", "/module-unavailable", "/workspace"]);

export type InventoryRow = {
  route: string;
  page: string;
  loading: string | null;
  variant: string | null;
  guard: string;
  kind: "page" | "redirect" | "outcome";
  statusContract: string | null;
};

function walk(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (name === "page.tsx") found.push(path);
  }
  return found;
}

function routeOf(pageDir: string): string {
  const parts = relative(NESTO_ROOT, pageDir).split(sep).filter((part) => part && !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
}

function nearest(fromDir: string, file: string): string | null {
  let current = fromDir;
  while (current.startsWith(NESTO_ROOT)) {
    const candidate = join(current, file);
    if (existsSync(candidate)) return candidate;
    if (current === NESTO_ROOT) break;
    current = dirname(current);
  }
  return null;
}

const GUARD = /\b(require[A-Z]\w*|notFound|forbidden|redirect|assertModule|guard\w*)\s*\(/;

function guardOf(pageFile: string): string {
  const places: string[] = [];
  let current = dirname(pageFile);
  while (current.startsWith(NESTO_ROOT) && current !== NESTO_ROOT) {
    const layout = join(current, "layout.tsx");
    if (existsSync(layout)) {
      const match = readFileSync(layout, "utf8").match(GUARD);
      if (match) places.push(`${relative(NESTO_ROOT, layout)} (${match[1]})`);
    }
    current = dirname(current);
  }
  const page = readFileSync(pageFile, "utf8").match(GUARD);
  if (page) places.unshift(`page (${page[1]})`);
  // The shell's own guard — sign-in, workspace, maintenance, pre-stream contracts — is above every boundary.
  places.push("layout.tsx (requireUserContext)");
  return places.join("; ");
}

function kindOf(route: string, pageFile: string): InventoryRow["kind"] {
  if (OUTCOME_ROUTES.has(route)) return "outcome";
  const source = readFileSync(pageFile, "utf8");
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const returnsJsx = /return\s*\(?\s*</.test(body) || /=>\s*\(?\s*</.test(body);
  return /\bredirect\(/.test(body) && !returnsJsx ? "redirect" : "page";
}

export function buildRouteInventory(): InventoryRow[] {
  return walk(NESTO_ROOT)
    .map((pageFile) => {
      const dir = dirname(pageFile);
      const route = routeOf(dir);
      const loading = nearest(dir, "loading.tsx");
      const variant = loading ? (readFileSync(loading, "utf8").match(/import \{ (\w+) \} from "@\/components\/layout\/page-skeletons"/)?.[1] ?? "custom") : null;
      return {
        route,
        page: relative(process.cwd(), pageFile),
        loading: loading ? relative(NESTO_ROOT, loading) : null,
        variant,
        guard: guardOf(pageFile),
        kind: kindOf(route, pageFile),
        statusContract: STATUS_CONTRACTS[route] ?? null,
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

function render(rows: InventoryRow[]): string {
  const boundaries = new Map<string, number>();
  for (const row of rows) boundaries.set(row.loading ?? "none", (boundaries.get(row.loading ?? "none") ?? 0) + 1);
  const lines = [
    "# NAV-01 route inventory",
    "",
    "Generated by `tsx scripts/navigation/route-inventory.ts --write`; do not edit by hand.",
    "`tests/unit/navigation/route-inventory.test.ts` fails when an authenticated page has no loading ancestor.",
    "",
    `- Authenticated pages: **${rows.length}**`,
    `- Without a loading ancestor: **${rows.filter((row) => !row.loading).length}**`,
    `- Redirect entry points: ${rows.filter((row) => row.kind === "redirect").length}; outcome pages: ${rows.filter((row) => row.kind === "outcome").length}`,
    `- Pages with an asserted document status: ${rows.filter((row) => row.statusContract).length}`,
    "",
    "## Response contract (§2.1)",
    "",
    "`app/(nesto)/layout.tsx` — sign-in, the session's workspace, maintenance — sits above every boundary and still answers",
    "with a real redirect. Module and record guards run below `app/(nesto)/loading.tsx`, so on a document request the shell",
    "can flush first: a refusal found later arrives in the stream under a 200, and the browser still lands on the login,",
    "denied, unavailable or not-found screen. Nothing protected renders before its guard, and API routes keep their real",
    "status codes.",
    "",
    "Measured on a production build: with the boundaries in place, every record 404 below was answered 200 + streamed",
    "not-found. Those routes have a documented contract (their specs assert the document's 404), so the layout runs their",
    "own guard first — `app/(nesto)/pre-stream-guards.ts` — and they answer 404 before any byte. On a hard load that page",
    "is the root not-found screen; client-side navigation keeps the in-shell one.",
    "",
    "## Boundaries",
    "",
    "| Loading boundary | Pages |",
    "|---|---|",
    ...[...boundaries.entries()].sort().map(([file, count]) => `| \`${file}\` | ${count} |`),
    "",
    "## Routes",
    "",
    "| Route | Kind | Nearest loading | Variant | Guard | Pre-stream status |",
    "|---|---|---|---|---|---|",
    ...rows.map((row) => `| \`${row.route}\` | ${row.kind} | \`${row.loading ?? "—"}\` | ${row.variant ?? "—"} | ${row.guard} | ${row.statusContract ?? "—"} |`),
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("route-inventory.ts")) {
  const rows = buildRouteInventory();
  if (process.argv.includes("--write")) {
    writeFileSync(INVENTORY_DOC, render(rows));
    console.log(`Wrote ${relative(process.cwd(), INVENTORY_DOC)} (${rows.length} pages).`);
  }
  const missing = rows.filter((row) => !row.loading);
  console.log(`${rows.length} authenticated pages; ${missing.length} without a loading ancestor.`);
  if (missing.length) {
    for (const row of missing) console.log(`  ${row.route}`);
    process.exitCode = 1;
  }
}
