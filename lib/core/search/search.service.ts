import type { UserContext } from "@/lib/context/types";
import { logger } from "@/lib/core/observability/logger";
import { searchProviders } from "./search.providers";
import type { GlobalSearchResponseDTO, GlobalSearchResultDTO } from "./search.types";

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

export async function globalSearch(
  context: UserContext,
  rawQuery: string,
  options: { limitPerProvider?: number | string | null; moduleKeys?: string[]; totalLimit?: number | string | null } = {},
): Promise<GlobalSearchResponseDTO> {
  const text = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);

  if (text.length < MIN_QUERY_LENGTH) {
    return { query: text, results: [], groups: [], partial: false, failedModules: [] };
  }

  const totalLimit = clampLimit(options.totalLimit, TOTAL_LIMIT);
  const query = {
    text,
    limitPerProvider: clampLimit(options.limitPerProvider, LIMIT_PER_PROVIDER),
    moduleKeys: options.moduleKeys,
  };

  const active = searchProviders.filter(
    (provider) => !options.moduleKeys?.length || options.moduleKeys.includes(provider.moduleKey),
  );

  const results: GlobalSearchResultDTO[] = [];
  const failedModules: string[] = [];

  for (let i = 0; i < active.length; i += CONCURRENCY) {
    const batch = active.slice(i, i + CONCURRENCY);
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
