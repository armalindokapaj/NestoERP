import { Prisma } from "@prisma/client";

/**
 * Whether a failure is the database being too busy rather than the request being
 * wrong: a transaction that outlived its deadline (P2028), a pool with no free
 * connection (P2024), or a lock or statement timeout (55P03, 57014). The caller
 * answers "temporarily unavailable, nothing was saved" — the transaction rolled
 * back — and never "failed validation" (AUD-07 §7, PS-17).
 */
const CONTENTION = new Set(["P2024", "P2028"]);
const CONTENTION_PG = new Set(["55P03", "57014"]);

export function isContention(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (CONTENTION.has(error.code)) return true;
    const pg = (error.meta as { code?: string } | undefined)?.code;
    return typeof pg === "string" && CONTENTION_PG.has(pg);
  }
  // A typed query's lock or statement timeout reaches the client unclassified,
  // with Postgres's code only in the message.
  if (error instanceof Prisma.PrismaClientUnknownRequestError) return /code: "(55P03|57014)"/.test(error.message);
  return false;
}
