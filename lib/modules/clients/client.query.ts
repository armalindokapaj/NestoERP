import { firstValue } from "@/lib/modules/shared/list-query";
import {
  CLIENT_SORT_KEYS,
  clientListQuerySchema,
  type ClientListQuery,
  type ClientSortKey,
} from "./client.schema";

/**
 * Turns URL search parameters into a validated list query (PRD #12 §154).
 *
 * Shared by the pages and the API so `/clients/all?type=COMPANY` and
 * `GET /api/clients?type=COMPANY` behave identically. Unknown values are
 * dropped rather than passed through to Prisma.
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

const TYPES = ["INDIVIDUAL", "COMPANY", "PUBLIC_ENTITY", "OTHER"] as const;
const STATUSES = ["ACTIVE", "INACTIVE"] as const;

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return values.length > 0 ? values : undefined;
}

export type ClientQueryDefaults = Partial<Pick<ClientListQuery, "archived" | "status">>;

export function parseClientListQuery(
  params: RawParams,
  defaults: ClientQueryDefaults = {},
): ClientListQuery {
  const sortValue = read(params, "sort");
  const sort: ClientSortKey = (CLIENT_SORT_KEYS as readonly string[]).includes(sortValue ?? "")
    ? (sortValue as ClientSortKey)
    : "updated-desc";

  const page = Number.parseInt(read(params, "page") ?? "1", 10);
  const limit = Number.parseInt(read(params, "limit") ?? "25", 10);

  const hasActiveProject = read(params, "hasActiveProject");

  return clientListQuerySchema.parse({
    search: read(params, "search") || undefined,
    type: list(read(params, "type"), TYPES),
    status: defaults.status ?? list(read(params, "status"), STATUSES),
    country: read(params, "country") || undefined,
    projectId: read(params, "projectId") || undefined,
    hasActiveProject:
      hasActiveProject === "yes" ? true : hasActiveProject === "no" ? false : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25,
    sort,
    archived: defaults.archived ?? read(params, "archived") === "true",
  });
}
