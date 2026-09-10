import { firstValue } from "@/lib/modules/shared/list-query";
import {
  PROJECT_SORT_KEYS,
  projectListQuerySchema,
  type ProjectListQuery,
  type ProjectSortKey,
} from "./project.schema";

/**
 * Turns URL search parameters into a validated list query (PRD #10 §195).
 *
 * Shared by the pages and the API so `/projects/all?status=ACTIVE` and
 * `GET /api/projects?status=ACTIVE` behave identically. Unknown values are
 * dropped rather than passed through to Prisma.
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

const STATUSES = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
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
