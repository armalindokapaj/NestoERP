import { firstValue } from "@/lib/modules/shared/list-query";
import {
  MEMBERSHIP_STATUSES,
  TEAM_SORT_KEYS,
  teamListQuerySchema,
  type TeamListQuery,
  type TeamSortKey,
} from "./team.schema";

/**
 * Turns URL search parameters into a validated list query (PRD #14 §146).
 *
 * Shared by the pages and the API, so `/team/people?status=ACTIVE` and
 * `GET /api/team?status=ACTIVE` behave identically.
 */
type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: RawParams, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  return firstValue(params[key]);
}

function list<T extends string>(value: string | undefined, allowed: readonly T[]): T[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));
  return values.length > 0 ? values : undefined;
}

export type TeamQueryDefaults = Partial<Pick<TeamListQuery, "status" | "sort">>;

/**
 * `defaults.status` is the section's restriction (People: active and invited;
 * Inactive: inactive and suspended). A `status` in the address narrows within
 * it and can never step outside it — `/team/people?status=INACTIVE` is the
 * People section, not the inactive list (AUD-08 §3, DT-02). The API passes no
 * section and reads the address as before.
 */
export function parseTeamListQuery(
  params: RawParams,
  defaults: TeamQueryDefaults = {},
): TeamListQuery {
  const requested = list(read(params, "status"), MEMBERSHIP_STATUSES);
  const section = defaults.status;
  const within = section && requested ? requested.filter((status) => section.includes(status)) : requested;
  const status = section ? (within?.length ? within : section) : requested;

  const sortValue = read(params, "sort");
  const sort: TeamSortKey = (TEAM_SORT_KEYS as readonly string[]).includes(sortValue ?? "")
    ? (sortValue as TeamSortKey)
    : (defaults.sort ?? "name-asc");

  const page = Number.parseInt(read(params, "page") ?? "1", 10);
  const limit = Number.parseInt(read(params, "limit") ?? "25", 10);

  return teamListQuerySchema.parse({
    search: read(params, "search") || undefined,
    roleId: read(params, "roleId") || undefined,
    departmentId: read(params, "departmentId") || undefined,
    status,
    projectId: read(params, "projectId") || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25,
    sort,
  });
}
