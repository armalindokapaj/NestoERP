import { z } from "zod";

/**
 * Shared list-query handling (PRD #7 §29, PRD #8 §83–§86).
 *
 * Query values arrive from the browser and are never passed to Prisma raw: the
 * page is bounded, the limit has a ceiling the server enforces, and sorting is
 * restricted to an explicit map of safe keys (PRD #8 §86).
 */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).catch(DEFAULT_LIMIT),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function paginationMeta(total: number, page: number, limit: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page: Math.min(page, totalPages),
    limit,
    total,
    totalPages,
  };
}

export function skipFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Case-insensitive "contains" search across a set of fields (PRD #8 §85).
 * Returns undefined when there is nothing to search for, so the caller can
 * spread it into a `where` without an empty OR.
 */
export function searchClause<T extends string>(
  term: string | undefined,
  fields: readonly T[],
): { OR: Record<string, { contains: string; mode: "insensitive" }>[] } | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;

  return {
    OR: fields.map((field) => ({
      [field]: { contains: trimmed, mode: "insensitive" as const },
    })),
  };
}

/** Reads a single query-string value, ignoring repeats. */
export function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Turns a comma-separated query value into a validated enum list. */
export function enumList<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
): T[] | undefined {
  const raw = firstValue(value);
  if (!raw) return undefined;

  const values = raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is T => (allowed as readonly string[]).includes(entry));

  return values.length > 0 ? values : undefined;
}
