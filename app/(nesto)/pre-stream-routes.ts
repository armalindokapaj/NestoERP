/**
 * The routes with a pre-stream status contract (NAV-01 §2.1), and how a path
 * is matched to one. Pure, so the route inventory and its test read the same
 * list the shell's layout runs; the guards themselves are in
 * `pre-stream-guards.ts`.
 */

export const PRE_STREAM_ROUTES = [
  "/clients/[clientId]",
  "/documents/[documentId]",
  "/tasks/[taskId]",
  "/hr/employees/[employeeId]",
  "/hr/employees/[employeeId]/compensation",
  "/projects/[projectId]/units/[unitId]",
  "/projects/types",
  "/people/[personId]",
  "/support/[section]/[recordId]",
  "/qaqc/inspections/[inspectionId]",
] as const;

export type PreStreamRoute = (typeof PRE_STREAM_ROUTES)[number];

/**
 * Static siblings of a dynamic segment above: `/tasks/new` is a page of its
 * own, not a task called "new". The route inventory test fails when a static
 * sibling appears that is missing here.
 */
export const STATIC_SIBLINGS = new Set([
  "/clients/new", "/clients/active", "/clients/all", "/clients/archived",
  "/documents/new", "/documents/all", "/documents/archived", "/documents/recent",
  "/tasks/new", "/tasks/all", "/tasks/archived", "/tasks/completed", "/tasks/my-tasks", "/tasks/overdue",
  "/hr/employees/new", "/hr/employees/import",
  "/people/me", "/people/employee", "/people/member", "/people/user",
  "/qaqc/inspections/new",
]);

function toPattern(route: string): RegExp {
  const source = route.replace(/\[[^\]]+\]/g, "([^/?#]+)").replace(/\//g, "\\/");
  return new RegExp(`^${source}$`);
}

const PATTERNS = PRE_STREAM_ROUTES.map((route) => ({ route, pattern: toPattern(route) }));

export function matchPreStreamRoute(pathname: string): { route: PreStreamRoute; match: RegExpMatchArray } | null {
  if (STATIC_SIBLINGS.has(pathname)) return null;
  for (const { route, pattern } of PATTERNS) {
    const match = pathname.match(pattern);
    if (match) return { route, match };
  }
  return null;
}
