import { inGroupWorkspace } from "@/config/workspace";
import type { UserContext } from "@/lib/context/types";
import { resolveWorkspaceContexts } from "@/lib/context/workspace-access";
import { logger } from "@/lib/core/observability/logger";
import { searchProviders } from "./search.providers";
import type { GlobalSearchProvider, GlobalSearchQuery, GlobalSearchResponseDTO, GlobalSearchResultDTO } from "./search.types";

/**
 * The global search aggregator (PRD #26 §103-§108).
 *
 * Providers run concurrently but bounded, so one search cannot saturate the
 * database (PRD #26 §104, §105). One failing provider degrades that module's
 * results rather than the whole search (PRD #26 §38, §106).
 */

const CONCURRENCY = 5;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const PROVIDER_TIMEOUT_MS = 700;

/**
 * Result limits, clamped on the server (PRD #26 §104, §218, PRD #47 §175).
 *
 * The limits arrive from a query string. Unclamped, `limitPerProvider=100000`
 * turned every provider into a full-table read — the meeting provider reads
 * twenty times its allowance to collapse a series — which is both a way to
 * saturate the database and a way to enumerate everything a reader can see
 * in one request.
 */
export const LIMIT_PER_PROVIDER = { min: 1, max: 20, fallback: 5 } as const;
export const TOTAL_LIMIT = { min: 1, max: 50, fallback: 20 } as const;

/** A whole number inside the bounds, or the fallback for anything that is not a number. */
export function clampLimit(value: unknown, bounds: { min: number; max: number; fallback: number }): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) return bounds.fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(number)));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type SearchOptions = { limitPerProvider?: number | string | null; moduleKeys?: string[]; totalLimit?: number | string | null };

/** The query as the providers see it, or null when there is nothing to search for (PRD #26 §45). */
function prepare(rawQuery: string, options: SearchOptions) {
  const text = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (text.length < MIN_QUERY_LENGTH) return { text, ready: null };
  return {
    text,
    ready: {
      totalLimit: clampLimit(options.totalLimit, TOTAL_LIMIT),
      query: {
        text,
        limitPerProvider: clampLimit(options.limitPerProvider, LIMIT_PER_PROVIDER),
        moduleKeys: options.moduleKeys,
      } satisfies GlobalSearchQuery,
      active: searchProviders.filter((provider) => !options.moduleKeys?.length || options.moduleKeys.includes(provider.moduleKey)),
    },
  };
}

const empty = (query: string): GlobalSearchResponseDTO => ({ query, results: [], groups: [], partial: false, failedModules: [] });

/** What one reader's providers found: the rows, and the modules that could not answer. */
async function runProviders(context: UserContext, providers: GlobalSearchProvider[], query: GlobalSearchQuery) {
  const results: GlobalSearchResultDTO[] = [];
  const failedModules: string[] = [];

  for (let i = 0; i < providers.length; i += CONCURRENCY) {
    const batch = providers.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (provider) => {
        try {
          return await withTimeout(provider.search(context, query), PROVIDER_TIMEOUT_MS, []);
        } catch (error) {
          // Only modules the user can already see are named, so a failure
          // cannot reveal a module they have no access to (PRD #26 §108).
          failedModules.push(provider.moduleKey);
          logger.warn("search.provider.failed", {
            moduleKey: provider.moduleKey,
            errorMessage: error instanceof Error ? error.message : "unknown",
          });
          return [];
        }
      }),
    );
    for (const batchResults of settled) results.push(...batchResults);
  }

  return { results, failedModules };
}

/** Ranks, limits and groups what the providers found — the same way in either workspace. */
function respond(text: string, found: GlobalSearchResultDTO[], failedModules: string[], totalLimit: number): GlobalSearchResponseDTO {
  const results = [...found];
  // Deterministic order, so the same query twice gives the same answer
  // (PRD #26 §47).
  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.entityId.localeCompare(b.entityId));

  const limited = results.slice(0, totalLimit);

  const counts = new Map<string, number>();
  for (const result of limited) {
    counts.set(result.moduleKey, (counts.get(result.moduleKey) ?? 0) + 1);
  }

  return {
    query: text,
    results: limited,
    groups: [...counts.entries()].map(([moduleKey, count]) => ({ moduleKey, count })),
    partial: failedModules.length > 0,
    failedModules,
  };
}

export async function globalSearch(context: UserContext, rawQuery: string, options: SearchOptions = {}): Promise<GlobalSearchResponseDTO> {
  const { text, ready } = prepare(rawQuery, options);
  if (!ready) return empty(text);

  const { results, failedModules } = await runProviders(context, ready.active, ready.query);
  return respond(text, results, failedModules, ready.totalLimit);
}

/**
 * Search in the active workspace (Workspace Context §40, §99).
 *
 * A company workspace is `globalSearch`, unchanged: the selected company by
 * default. In the Group workspace the search is not a query with the company
 * boundary taken off — it is each company's own search, asked in that company's
 * own context (`resolveWorkspaceContexts`), so every provider applies the
 * module, permission and scope the person holds *there* and a company where a
 * module is off or unreadable simply contributes nothing (§60). The companies
 * run in parallel, each with the same per-provider time allowance, so a group
 * of five is not five times slower.
 *
 * Every company-scoped row carries its company (§45) and is opened through the
 * enter-company hop. Providers that answer for the group — the people
 * directory — are asked once, so a person is found once and carries no company.
 *
 * `companyId` is a filter, not a workspace (§87): it narrows a Group search to
 * one of the companies the person may use, and is ignored in a company
 * workspace (§86) and when it names any other company — it is never the
 * authority for what may be read (§57).
 */
export async function globalSearchForWorkspace(
  session: UserContext,
  rawQuery: string,
  options: SearchOptions & { companyId?: string | null } = {},
): Promise<GlobalSearchResponseDTO> {
  if (!inGroupWorkspace(session)) return globalSearch(session, rawQuery, options);

  const { text, ready } = prepare(rawQuery, options);
  if (!ready) return empty(text);

  const allowed = await resolveWorkspaceContexts(session, {});
  const narrowed = options.companyId ? allowed.filter((context) => context.companyId === options.companyId) : [];
  const contexts = narrowed.length > 0 ? narrowed : allowed;
  const companyId = narrowed.length > 0 ? narrowed[0].companyId : undefined;
  const query: GlobalSearchQuery = { ...ready.query, ...(companyId ? { companyId } : {}) };

  const companyProviders = ready.active.filter((provider) => !provider.groupWide);
  const groupProviders = ready.active.filter((provider) => provider.groupWide);

  const [perCompany, perGroup] = await Promise.all([
    Promise.all(
      contexts.map(async (context) => {
        const found = await runProviders(context, companyProviders, query);
        const company = { id: context.companyId, name: context.company.name };
        return { results: found.results.map((result) => ({ ...result, company })), failedModules: found.failedModules };
      }),
    ),
    // Each group-wide provider is asked once, by the first company that may read
    // it — but in the Group workspace, or a provider that narrows by workspace
    // (the people directory, §46) would answer for that one company instead of
    // the group. The permissions stay that company's; only the workspace is the
    // session's.
    Promise.all(
      groupProviders.map((provider) => {
        const asker = allowed.find((context) => provider.groupWide!.readableBy(context));
        return asker ? runProviders({ ...asker, workspace: session.workspace }, [provider], query) : { results: [], failedModules: [] };
      }),
    ),
  ]);

  const answers = [...perCompany, ...perGroup];
  return respond(
    text,
    answers.flatMap((answer) => answer.results),
    // A module that failed in two companies is one module to name.
    [...new Set(answers.flatMap((answer) => answer.failedModules))],
    ready.totalLimit,
  );
}
