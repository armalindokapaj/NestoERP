import { Prisma } from "@prisma/client";

import { prisma } from "./prisma";

/**
 * The database's clock, in the shape Prisma stores time (PRD #51 §159, §160).
 *
 * Prisma writes a `DateTime` as UTC into a `timestamp` column with no zone.
 * Postgres's `now()` is a `timestamptz`, and comparing it with one of those
 * columns converts through the session's `TimeZone` — so on a server set to
 * anything but UTC every lease and every backoff written in raw SQL is off by
 * the offset. `now() AT TIME ZONE 'UTC'` is the same instant spelled the way
 * the columns are, whatever the server is set to.
 *
 * Leases and retry times are compared against this rather than a worker's own
 * clock: two workers on two hosts agree on the database's time even when they
 * disagree with each other.
 */
export const DB_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/**
 * A JavaScript date as a raw-SQL value for those same columns.
 *
 * A bare `${date}` parameter reaches Postgres as a `timestamptz` and is
 * converted through the session zone on its way into a zone-less column — two
 * hours out on a server in Tirane. Every raw statement that writes or compares
 * a `DateTime` column with a date from JavaScript goes through this.
 */
export function sqlTimestamp(date: Date): Prisma.Sql {
  return Prisma.sql`(${date}::timestamptz AT TIME ZONE 'UTC')`;
}

/** The database's current time. */
export async function databaseNow(): Promise<Date> {
  const rows = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT ${DB_NOW} AS "now"`;
  return rows[0]!.now;
}
