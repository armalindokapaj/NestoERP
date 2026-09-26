import { PrismaClient, type Prisma } from "@prisma/client";

/**
 * The application's Prisma client, with every query reported (AUD-01 §10).
 *
 * `lib/database/prisma` reuses a client already on `globalThis`, so importing
 * this first — before anything that imports the application — makes the
 * product's own queries countable and their SQL available to EXPLAIN, without
 * changing a line of the code under measurement.
 */
export type CapturedQuery = { query: string; params: string; durationMs: number };

const holder = globalThis as unknown as { prisma?: PrismaClient; __capturedQueries?: CapturedQuery[] };

const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
(client as unknown as { $on(event: "query", listener: (event: Prisma.QueryEvent) => void): void }).$on("query", (event) => {
  holder.__capturedQueries?.push({ query: event.query, params: event.params, durationMs: event.duration });
});
holder.prisma = client;

/** Starts recording; the returned function stops and hands back what ran. */
export function captureQueries(): () => CapturedQuery[] {
  const captured: CapturedQuery[] = [];
  holder.__capturedQueries = captured;
  return () => {
    holder.__capturedQueries = undefined;
    return captured;
  };
}

/** A captured query with its parameters written in as literals, for EXPLAIN. */
export function withLiterals(query: CapturedQuery): string {
  const params = JSON.parse(query.params) as unknown[];
  return query.query.replace(/\$(\d+)/g, (_, index: string) => {
    const value = params[Number(index) - 1];
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  });
}

export const countingPrisma = client;
