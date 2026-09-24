import { firstValue } from "@/lib/modules/shared/list-query";
import {
  PORTFOLIO_PAGE_SIZE,
  PROJECT_SORT_KEYS,
  portfolioQuerySchema,
  projectListQuerySchema,
  type PortfolioQuery,
  type ProjectListQuery,
  type ProjectSortKey,
} from "./project.schema";

/**
 * Turns URL search parameters into a validated list query (PRD #10 §195).
 *
 * Behind the archived list. Unknown values are dropped rather than passed
 * through to Prisma.
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

const STATUSES = ["PENDING", "ACTIVE", "FINISHED"] as const;

/**
 * Words a bookmark may still carry from before E-05A §62 renamed them, read as
 * the status each became. An unknown word is still dropped.
 */
const LEGACY_STATUS: Record<string, (typeof STATUSES)[number]> = {
  DRAFT: "PENDING",
  ON_HOLD: "ACTIVE",
  COMPLETED: "FINISHED",
};
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .map((entry): string => LEGACY_STATUS[entry] ?? entry)
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return values.length > 0 ? values : undefined;
}

export function parseProjectListQuery(
  params: RawParams,
  defaults: Partial<Pick<ProjectListQuery, "archived" | "mine">> = {},
): ProjectListQuery {
  const sortValue = read(params, "sort");
  const sort: ProjectSortKey = (PROJECT_SORT_KEYS as readonly string[]).includes(sortValue ?? "")
    ? (sortValue as ProjectSortKey)
    : "updated-desc";

  const page = Number.parseInt(read(params, "page") ?? "1", 10);
  const limit = Number.parseInt(read(params, "limit") ?? "25", 10);

  return projectListQuerySchema.parse({
    search: read(params, "search") || undefined,
    status: list(read(params, "status"), STATUSES),
    priority: list(read(params, "priority"), PRIORITIES),
    clientId: read(params, "clientId") || undefined,
    projectManagerMemberId: read(params, "manager") || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25,
    sort,
    archived: defaults.archived ?? read(params, "archived") === "true",
    mine: defaults.mine ?? read(params, "mine") === "true",
  });
}

/**
 * The Projects page query from a URL (Projects Workspace Grid §107, §182).
 *
 * The page and `GET /api/projects` read the same parameters, so the page and
 * the API call behind "Load more" cannot drift. Only the search is read —
 * `q`, or `search` from links written before E-05A. Anything else a URL carries
 * is ignored rather than refused: a stale bookmark should land on the page, and
 * no parameter may choose a company (§108, §184).
 */
export function parsePortfolioQuery(params: RawParams): PortfolioQuery {
  const limit = Number.parseInt(read(params, "limit") ?? String(PORTFOLIO_PAGE_SIZE), 10);
  return portfolioQuerySchema.parse({
    q: (read(params, "q") ?? read(params, "search"))?.trim().slice(0, 200) || undefined,
    cursor: read(params, "cursor") || undefined,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 60) : PORTFOLIO_PAGE_SIZE,
  });
}

/**
 * What the Projects page's URL said before its filters, sort, favorites pill and
 * list view were removed (Projects Workspace Grid §183), plus the old name for
 * the search.
 */
const RETIRED_PAGE_PARAMS = ["status", "favorites", "company", "companyId", "role", "roleId", "type", "projectType", "location", "sort", "view", "search"] as const;

/**
 * The page's canonical address when a URL still carries retired parameters —
 * the search kept, everything else dropped — or null when it is already clean
 * (§184). The page replaces the URL with it, so the address bar never names a
 * filter the page no longer applies.
 */
export function canonicalPortfolioHref(params: RawParams, pathname = "/projects"): string | null {
  const retired = RETIRED_PAGE_PARAMS.some((key) => read(params, key) !== undefined);
  if (!retired) return null;
  const { q } = parsePortfolioQuery(params);
  return q ? `${pathname}?${new URLSearchParams({ q }).toString()}` : pathname;
}
