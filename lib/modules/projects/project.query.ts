import { PROJECT_TYPE_NAME_MAX } from "@/config/project-types";
import { firstValue } from "@/lib/modules/shared/list-query";
import {
  PORTFOLIO_PAGE_SIZE,
  PORTFOLIO_SORT_KEYS,
  PROJECT_SORT_KEYS,
  portfolioQuerySchema,
  projectListQuerySchema,
  type PortfolioQuery,
  type PortfolioSortKey,
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
 * The Projects page query from a URL (E-05A §36, §48).
 *
 * The page and `GET /api/projects` read the same parameters, so a filtered
 * page URL and the API call behind "Load more" cannot drift. The page writes
 * `company`; the API documents `companyId`; both are read. A value that is not
 * one the query knows is dropped rather than refused — a stale bookmark should
 * land on the page, not on an error.
 */
export function parsePortfolioQuery(params: RawParams): PortfolioQuery {
  const statusValue = (read(params, "status") ?? "").trim().toUpperCase();
  const status = LEGACY_STATUS[statusValue] ?? statusValue;
  const sortValue = read(params, "sort") ?? "";
  const typeValue = (read(params, "type") ?? read(params, "projectType") ?? "").trim();
  const location = read(params, "location")?.trim();
  const limit = Number.parseInt(read(params, "limit") ?? String(PORTFOLIO_PAGE_SIZE), 10);
  const favorites = (read(params, "favorites") ?? "").toLowerCase();

  return portfolioQuerySchema.parse({
    q: (read(params, "q") ?? read(params, "search"))?.trim() || undefined,
    status: (STATUSES as readonly string[]).includes(status) ? status : undefined,
    favorites: favorites === "true" || favorites === "1",
    companyId: (read(params, "company") ?? read(params, "companyId"))?.trim() || undefined,
    role: (read(params, "role") ?? read(params, "roleId"))?.trim() || undefined,
    projectType: typeValue && typeValue.length <= PROJECT_TYPE_NAME_MAX ? typeValue : undefined,
    location: location && /^(city|country):.+$/.test(location) && location.length <= 240 ? location : undefined,
    sort: (PORTFOLIO_SORT_KEYS as readonly string[]).includes(sortValue) ? (sortValue as PortfolioSortKey) : "recommended",
    cursor: read(params, "cursor") || undefined,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 60) : PORTFOLIO_PAGE_SIZE,
  });
}

/**
 * How many values narrow the collection — what the "N results" line and the
 * empty-state wording go by (E-05A §53, §74). A sort reorders; it never narrows.
 */
export function activePortfolioFilterCount(query: PortfolioQuery): number {
  return [query.q, query.status, query.favorites || undefined, query.companyId, query.role, query.projectType, query.location].filter(Boolean).length;
}

/**
 * Whether Clear Filters shows: anything narrowing, or a sort other than
 * Recommended — Clear Filters resets both (E-05A §32).
 */
export function portfolioIsCustomised(query: PortfolioQuery): boolean {
  return activePortfolioFilterCount(query) > 0 || query.sort !== "recommended";
}
