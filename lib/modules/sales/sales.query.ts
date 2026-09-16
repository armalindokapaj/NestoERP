import { DEFAULT_LIMIT, firstValue, MAX_LIMIT } from "@/lib/modules/shared/list-query";
import {
  LEAD_SORT_KEYS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  leadListQuerySchema,
  type LeadListQuery,
} from "./leads/lead.schema";
import {
  OPPORTUNITY_OUTCOMES,
  OPPORTUNITY_SORT_KEYS,
  OPPORTUNITY_STAGE_VALUES,
  opportunityListQuerySchema,
  type OpportunityListQuery,
} from "./opportunities/opportunity.schema";
import {
  PROPOSAL_SORT_KEYS,
  PROPOSAL_STATUSES,
  proposalListQuerySchema,
  type ProposalListQuery,
} from "./proposals/proposal.schema";

/**
 * URL search parameters → validated list queries (PRD #17 §346, §361).
 *
 * Shared by the pages and the API, so `/sales/leads?status=QUALIFIED` and
 * `GET /api/sales/leads?status=QUALIFIED` behave identically. An unknown sort
 * key or status is dropped rather than rejected: a stale bookmark should show
 * the list, not an error page.
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

function sortKey<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

function page(params: RawParams): number {
  const value = Number.parseInt(read(params, "page") ?? "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function limit(params: RawParams): number {
  const value = Number.parseInt(read(params, "limit") ?? "25", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : 25;
}

function flag(params: RawParams, key: string): boolean {
  const value = read(params, key);
  return value === "1" || value === "true";
}

function text(params: RawParams, key: string): string | undefined {
  const value = read(params, key);
  return value && value.trim() !== "" ? value : undefined;
}

/** A numeric filter that ignores anything that is not a number. */
function number(params: RawParams, key: string): number | undefined {
  const raw = text(params, key);
  if (raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export type LeadQueryDefaults = Partial<Pick<LeadListQuery, "status" | "sort" | "archived" | "mine">>;

export function parseLeadQuery(
  params: RawParams,
  defaults: LeadQueryDefaults = {},
): LeadListQuery {
  return leadListQuerySchema.parse({
    search: text(params, "search"),
    status: list(read(params, "status"), LEAD_STATUSES) ?? defaults.status,
    source: list(read(params, "source"), LEAD_SOURCES),
    ownerMemberId: text(params, "owner"),
    currency: text(params, "currency"),
    minValue: text(params, "minValue"),
    maxValue: text(params, "maxValue"),
    createdFrom: text(params, "createdFrom"),
    createdTo: text(params, "createdTo"),
    mine: defaults.mine ?? flag(params, "mine"),
    archived: defaults.archived ?? flag(params, "archived"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), LEAD_SORT_KEYS, defaults.sort ?? "updated-desc"),
  });
}

export type OpportunityQueryDefaults = Partial<
  Pick<OpportunityListQuery, "stage" | "outcome" | "sort" | "archived" | "mine" | "limit">
>;

export function parseOpportunityQuery(
  params: RawParams,
  defaults: OpportunityQueryDefaults = {},
): OpportunityListQuery {
  return opportunityListQuerySchema.parse({
    search: text(params, "search"),
    stage: list(read(params, "stage"), OPPORTUNITY_STAGE_VALUES) ?? defaults.stage,
    outcome: list(read(params, "outcome"), OPPORTUNITY_OUTCOMES) ?? defaults.outcome,
    ownerMemberId: text(params, "owner"),
    clientId: text(params, "clientId"),
    currency: text(params, "currency"),
    minValue: text(params, "minValue"),
    maxValue: text(params, "maxValue"),
    minProbability: number(params, "minProbability"),
    maxProbability: number(params, "maxProbability"),
    closeFrom: text(params, "closeFrom"),
    closeTo: text(params, "closeTo"),
    mine: defaults.mine ?? flag(params, "mine"),
    archived: defaults.archived ?? flag(params, "archived"),
    page: page(params),
    limit: defaults.limit ?? limit(params),
    sort: sortKey(read(params, "sort"), OPPORTUNITY_SORT_KEYS, defaults.sort ?? "updated-desc"),
  });
}

export type ProposalQueryDefaults = Partial<
  Pick<ProposalListQuery, "status" | "sort" | "archived">
>;

export function parseProposalQuery(
  params: RawParams,
  defaults: ProposalQueryDefaults = {},
): ProposalListQuery {
  return proposalListQuerySchema.parse({
    search: text(params, "search"),
    status: list(read(params, "status"), PROPOSAL_STATUSES) ?? defaults.status,
    opportunityId: text(params, "opportunityId"),
    clientId: text(params, "clientId"),
    currency: text(params, "currency"),
    archived: defaults.archived ?? flag(params, "archived"),
    page: page(params),
    limit: limit(params),
    sort: sortKey(read(params, "sort"), PROPOSAL_SORT_KEYS, defaults.sort ?? "updated-desc"),
  });
}

/**
 * Pagination a service accepts from any caller.
 *
 * The routes parse `page` and `limit` loosely, and a service is also reached
 * from pages and actions — so the bound lives where the query is run. A page
 * of ten thousand rows, or a negative `take` that Prisma reads backwards, is
 * not a page.
 */
export function boundedPage(value: number | undefined): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : 1;
}

export function boundedLimit(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}
