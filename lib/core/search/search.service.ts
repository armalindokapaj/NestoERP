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
  options: { limitPerProvider?: number; moduleKeys?: string[]; totalLimit?: number } = {},
): Promise<GlobalSearchResponseDTO> {
  const text = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);

  if (text.length < MIN_QUERY_LENGTH) {
    return { query: text, results: [], groups: [], partial: false, failedModules: [] };
  }

  const query = {
    text,
    limitPerProvider: options.limitPerProvider ?? 5,
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

  const limited = results.slice(0, options.totalLimit ?? 20);

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
