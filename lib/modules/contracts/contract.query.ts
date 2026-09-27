import { firstValue } from "@/lib/modules/shared/list-query";
import {
  CONTRACT_SORT_KEYS,
  CONTRACT_TYPES,
  CONTRACT_VIEWS,
  RENEWAL_TYPES,
  contractListQuerySchema,
  type ContractListQuery,
  type ContractView,
} from "./contracts/contract.schema";
import { CONTRACT_STATUSES } from "./contracts/contract.status";
import {
  OBLIGATION_STATUSES,
  OBLIGATION_TYPES,
} from "./obligations/obligation.status";
import {
  obligationListQuerySchema,
  type ObligationListQuery,
} from "./obligations/obligation.schema";

/**
 * URL search parameters → validated list queries (PRD #18 §253, §297, §451).
 *
 * Shared by the pages and the API, so `/contracts/all?status=ACTIVE` and
 * `GET /api/contracts?status=ACTIVE` behave identically. An unknown sort key or
 * status is dropped rather than rejected: a stale bookmark should show the
 * list, not an error page.
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

function text(params: RawParams, key: string): string | undefined {
  const value = read(params, key);
  return value && value.trim() !== "" ? value : undefined;
}

function date(params: RawParams, key: string): Date | undefined {
  const raw = text(params, key);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function flag(params: RawParams, key: string): boolean {
  const value = read(params, key);
  return value === "1" || value === "true";
}

function page(params: RawParams): number {
  const value = Number.parseInt(read(params, "page") ?? "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function limit(params: RawParams, fallback = 25): number {
  const value = Number.parseInt(read(params, "limit") ?? String(fallback), 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : fallback;
}

function sortKey(value: string | undefined, fallback: ContractListQuery["sort"]) {
  return (CONTRACT_SORT_KEYS as readonly string[]).includes(value ?? "")
    ? (value as ContractListQuery["sort"])
    : fallback;
}

export type ContractQueryDefaults = Partial<Pick<ContractListQuery, "view" | "sort" | "limit">>;

/**
 * `defaults.view` is a section page's own view (`/contracts/drafts` passes
 * "drafts"), and it wins over any `view` in the address: a section is a
 * restriction, not a default a link can swap for another (AUD-08 §3, DT-02).
 * A named section other than "all" also ignores a `status` in the address — it
 * offers no Status filter, and its restriction is the status. Without a
 * section (the API, the export) the address's `view` is read as before.
 */
export function parseContractQuery(
  params: RawParams,
  defaults: ContractQueryDefaults = {},
): ContractListQuery {
  const view = (defaults.view ??
    ((CONTRACT_VIEWS as readonly string[]).includes(read(params, "view") ?? "")
      ? (read(params, "view") as ContractView)
      : "all")) as ContractView;
  const sectionStatus = defaults.view !== undefined && defaults.view !== "all";

  const within = Number.parseInt(read(params, "within") ?? "", 10);

  return contractListQuerySchema.parse({
    search: text(params, "search"),
    view,
    status: sectionStatus ? undefined : list(read(params, "status"), CONTRACT_STATUSES),
    contractType: list(read(params, "type"), CONTRACT_TYPES),
    renewalType: list(read(params, "renewal"), RENEWAL_TYPES),
    clientId: text(params, "clientId"),
    projectId: text(params, "projectId"),
    ownerMemberId: text(params, "owner"),
    currency: text(params, "currency"),
    effectiveFrom: date(params, "effectiveFrom"),
    effectiveTo: date(params, "effectiveTo"),
    expiryFrom: date(params, "expiryFrom"),
    expiryTo: date(params, "expiryTo"),
    expiringWithin: Number.isFinite(within) && within > 0 ? Math.min(within, 365) : undefined,
    mine: flag(params, "mine"),
    page: page(params),
    limit: limit(params, defaults.limit ?? 25),
    sort: sortKey(read(params, "sort"), defaults.sort ?? "updated-desc"),
  });
}

/**
 * A section page's list as an address for its export (AUD-08 §3, DT-02): the
 * filters in the address plus the section's own `view`, so the file from
 * `/contracts/active` is the active contracts, not every contract. The page
 * number is dropped — an export is all matching records, never one page.
 */
export function contractSectionSearch(
  params: Record<string, string | string[] | undefined>,
  view: ContractView,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && key !== "page" && key !== "view") search.set(key, value);
  }
  if (view !== "all") search.delete("status");
  search.set("view", view);
  return search.toString();
}

export function parseObligationQuery(params: RawParams): ObligationListQuery {
  return obligationListQuerySchema.parse({
    status: list(read(params, "status"), OBLIGATION_STATUSES),
    obligationType: list(read(params, "type"), OBLIGATION_TYPES),
    responsibleMemberId: text(params, "responsible"),
    contractId: text(params, "contractId"),
    overdueOnly: flag(params, "overdue"),
    page: page(params),
    limit: limit(params),
  });
}
