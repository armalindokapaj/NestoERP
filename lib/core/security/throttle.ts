import { DB_NOW } from "@/lib/database/clock";
import { prisma } from "@/lib/database/prisma";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { hashSubject, type RateLimitResult } from "./rate-limit";

/**
 * Distributed throttles for the account flows (PRD #38 §17, §18).
 *
 * The in-memory limiter in `rate-limit.ts` is right for high-volume, low-stakes
 * traffic — search, uploads — where an instance counting on its own is merely
 * generous. It is wrong for sign-in: an attacker spreading guesses across ten
 * instances would get ten times the allowance. These counters live in
 * PostgreSQL, which every instance already shares, and each check is a single
 * atomic upsert, so two instances racing on one key cannot both see room.
 *
 * Each flow is limited along more than one dimension at once — the account and
 * the address it comes from — so neither rotating addresses against one account
 * nor spraying one address across many accounts gets far.
 *
 * Every subject is hashed before it reaches the table or a log (§18). Every
 * check fails closed: if the counter cannot be read, the request is refused
 * rather than waved through.
 */

type Window = { limit: number; windowMs: number };

const MINUTE = 60_000;

export const THROTTLES = {
  /** Counts failed sign-ins only, so an office behind one address can still work. */
  AUTH_LOGIN: {
    account: { limit: 5, windowMs: 15 * MINUTE },
    ip: { limit: 30, windowMs: 15 * MINUTE },
  },
  AUTH_RESET_REQUEST: {
    account: { limit: 3, windowMs: 60 * MINUTE },
    ip: { limit: 10, windowMs: 60 * MINUTE },
  },
  AUTH_RESET_SUBMIT: {
    token: { limit: 5, windowMs: 15 * MINUTE },
    ip: { limit: 10, windowMs: 15 * MINUTE },
  },
  INVITE_RESEND: {
    invite: { limit: 3, windowMs: 60 * MINUTE },
    member: { limit: 20, windowMs: 60 * MINUTE },
  },
  INVITE_ACCEPT: {
    token: { limit: 10, windowMs: 15 * MINUTE },
    ip: { limit: 20, windowMs: 15 * MINUTE },
  },
  /** A signed-in session guessing its own current password. */
  PASSWORD_CHANGE: {
    account: { limit: 5, windowMs: 15 * MINUTE },
  },
} as const satisfies Record<string, Record<string, Window>>;

export type ThrottleName = keyof typeof THROTTLES;
export type ThrottleSubjects<N extends ThrottleName> = Partial<Record<keyof (typeof THROTTLES)[N], string>>;

type Row = { count: number; windowEndsAt: Date };

async function bucketKey(name: string, dimension: string, subject: string): Promise<string> {
  return `${name}:${dimension}:${await hashSubject(subject)}`;
}

function outcome(rows: Array<{ row: Row | null; window: Window }>, counted: boolean): RateLimitResult {
  let allowed = true;
  let remaining = Number.POSITIVE_INFINITY;
  let retryAfterSeconds = 0;
  const now = Date.now();

  for (const { row, window } of rows) {
    const count = row && row.windowEndsAt.getTime() > now ? row.count : 0;
    // A counted hit is allowed up to the limit; a peek asks whether one more would be.
    const exceeded = counted ? count > window.limit : count >= window.limit;
    remaining = Math.min(remaining, Math.max(0, window.limit - count));
    if (exceeded) {
      allowed = false;
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        Math.ceil(((row?.windowEndsAt.getTime() ?? now) - now) / 1000),
      );
    }
  }

  return { allowed, remaining: Number.isFinite(remaining) ? remaining : 0, retryAfterSeconds };
}

async function increment(key: string, windowMs: number): Promise<Row> {
  // One statement: a fresh window starts at 1, a live one increments. The
  // database clock decides, so instances with drifting clocks agree — in UTC,
  // like every other column, so the window read back ends when it says it does
  // (PRD #51 §159, §160).
  const rows = await prisma.$queryRaw<Row[]>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "windowEndsAt", "updatedAt")
    VALUES (${key}, 1, ${DB_NOW} + (${windowMs} * interval '1 millisecond'), ${DB_NOW})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit_buckets"."windowEndsAt" <= ${DB_NOW} THEN 1
                     ELSE "rate_limit_buckets"."count" + 1 END,
      "windowEndsAt" = CASE WHEN "rate_limit_buckets"."windowEndsAt" <= ${DB_NOW} THEN EXCLUDED."windowEndsAt"
                            ELSE "rate_limit_buckets"."windowEndsAt" END,
      "updatedAt" = ${DB_NOW}
    RETURNING "count", "windowEndsAt"`;
  return rows[0];
}

function refused(name: string): RateLimitResult {
  logger.error("security.throttle.failed", { throttle: name });
  return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
}

function report(name: string, result: RateLimitResult): RateLimitResult {
  if (!result.allowed) {
    incrementCounter(Metric.RATE_LIMIT_TRIGGERED, { throttle: name });
    logger.warn("security.throttle.triggered", { throttle: name, retryAfterSeconds: result.retryAfterSeconds });
  }
  return result;
}

/** Counts one attempt against every supplied dimension, and says whether it may proceed. */
export async function hitThrottle<N extends ThrottleName>(
  name: N,
  subjects: ThrottleSubjects<N>,
): Promise<RateLimitResult> {
  try {
    const windows = THROTTLES[name] as Record<string, Window>;
    const rows = await Promise.all(
      Object.entries(subjects)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
        .map(async ([dimension, subject]) => ({
          row: await increment(await bucketKey(name, dimension, subject), windows[dimension].windowMs),
          window: windows[dimension],
        })),
    );
    return report(name, outcome(rows, true));
  } catch {
    return refused(name);
  }
}

/** Whether another attempt would be allowed, without counting one. */
export async function peekThrottle<N extends ThrottleName>(
  name: N,
  subjects: ThrottleSubjects<N>,
): Promise<RateLimitResult> {
  try {
    const windows = THROTTLES[name] as Record<string, Window>;
    const entries = Object.entries(subjects).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    );
    const keys = await Promise.all(entries.map(([dimension, subject]) => bucketKey(name, dimension, subject)));
    const found = await prisma.rateLimitBucket.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(found.map((row) => [row.key, row]));
    const rows = entries.map(([dimension], index) => ({
      row: byKey.get(keys[index]) ?? null,
      window: windows[dimension],
    }));
    return report(name, outcome(rows, false));
  } catch {
    return refused(name);
  }
}

/** Forgets one dimension's count — a successful sign-in clears the account's failures. */
export async function clearThrottle<N extends ThrottleName>(
  name: N,
  subjects: ThrottleSubjects<N>,
): Promise<void> {
  const keys = await Promise.all(
    Object.entries(subjects)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
      .map(([dimension, subject]) => bucketKey(name, dimension, subject)),
  );
  if (keys.length === 0) return;
  await prisma.rateLimitBucket.deleteMany({ where: { key: { in: keys } } });
}

/** Buckets one purge statement removes at most. */
export const THROTTLE_PURGE_BATCH = 1000;

/**
 * Closed windows, for the scheduled worker (PRD #51 §132-§134, §159, §160).
 *
 * Closed by the database's clock, which wrote them: a worker whose own clock
 * ran ahead would otherwise clear lockouts that are still in force. A batch at
 * a time, because an address spray leaves a bucket per address and one
 * statement deleting all of them holds the table for as long as it takes. The
 * window is re-checked outside the subquery, so a bucket a sign-in restarted
 * while the batch waited for its lock is kept.
 */
export async function purgeExpiredThrottles(): Promise<number> {
  let purged = 0;
  for (;;) {
    if (jobStopRequested()) return purged;
    const batch = await prisma.$executeRaw`
      DELETE FROM "rate_limit_buckets"
      WHERE "key" IN (SELECT "key" FROM "rate_limit_buckets" WHERE "windowEndsAt" <= ${DB_NOW} LIMIT ${THROTTLE_PURGE_BATCH})
        AND "windowEndsAt" <= ${DB_NOW}`;
    purged += batch;
    if (batch < THROTTLE_PURGE_BATCH) return purged;
  }
}

/**
 * The client address of a request. Only meaningful behind a proxy that sets
 * `x-forwarded-for` itself (docs/environments.md); the first entry is the
 * client. A forged header only chooses which address bucket a caller lands in —
 * the account dimension still applies.
 */
export function clientAddress(headers: Headers | null | undefined): string {
  if (!headers) return "unknown";
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function userAgentOf(headers: Headers | null | undefined): string | null {
  const agent = headers?.get("user-agent");
  return agent ? agent.slice(0, 255) : null;
}

/** A retry hint a person can act on: minutes, rounded up. */
export function retryAfterMinutes(result: RateLimitResult): number {
  return Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
}
