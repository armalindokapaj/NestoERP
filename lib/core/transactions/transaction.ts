import { Prisma } from "@prisma/client";

import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { currentRequestContext } from "@/lib/core/observability/request-context";
import { prisma } from "@/lib/database/prisma";
import type { UserContext } from "@/lib/context/types";
import { assertActorCurrent } from "./actor";

/**
 * One atomic business operation (PRD #48 §21, §124, §176, §180).
 *
 * Two things this adds over `prisma.$transaction` directly, and nothing else:
 *
 *   1. **A bounded retry for transient serialisation failures.** Postgres
 *      aborts one of two transactions that deadlock or write the same row
 *      under a stricter isolation level. That is the database asking for the
 *      work to be repeated, not a business conflict, and repeating it is safe
 *      precisely because the first attempt left nothing behind (§124, §245).
 *      A business conflict — a stale version, a record already decided — is
 *      never retried: the caller's intent is out of date and repeating it
 *      would overwrite somebody's change (§244).
 *
 *   2. **The operation's name in the metrics and the log.** Which business
 *      operation is contended is the question conflict metrics exist to answer,
 *      and the name has to be low-cardinality — `procurement.order.approve`,
 *      not an id (§176, §177, §181).
 *
 * And one thing a caller opts into: `actor`. Given the context the request
 * decided under, the transaction first re-reads that actor's membership,
 * account, role and session with a share lock (`assertActorCurrent`), so a
 * revocation that commits between the decision and the write refuses the write
 * instead of following it, and one that arrives later waits for this commit
 * (AUD-06 §7, RP-16). Every attempt re-reads it.
 *
 * The callback must contain only database work. An email, an upload or an
 * external call inside it either happens twice on a retry or happens before a
 * rollback that unhappens everything else (§29, §115).
 */

/** Postgres serialisation failure, deadlock, and Prisma's own write conflict. */
const TRANSIENT = new Set(["P2034"]);
const TRANSIENT_PG = new Set(["40001", "40P01"]);

/**
 * Whether a failure is the database asking for the work to be repeated. Exported
 * so a caller can say "try again" once `runInTransaction` has spent its retries,
 * rather than "something went wrong" (AUD-02 §4).
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (TRANSIENT.has(error.code)) return true;
    const pg = (error.meta as { code?: string } | undefined)?.code;
    return typeof pg === "string" && TRANSIENT_PG.has(pg);
  }
  return false;
}

/**
 * The deadline every interactive transaction has unless its caller sets its own
 * (AUD-07 §7, PS-17). Prisma's defaults, written down so the runbook, the
 * client deadline and the tests read one number: a transaction waits at most
 * `TRANSACTION_MAX_WAIT_MS` for a pooled connection and runs at most
 * `TRANSACTION_DEADLINE_MS`, both inside the 10 s client read deadline
 * (lib/client/api-request.ts) so the server answers before the browser gives up.
 */
export const TRANSACTION_DEADLINE_MS = 5_000;
export const TRANSACTION_MAX_WAIT_MS = 2_000;

export { isContention } from "@/lib/core/transactions/contention";

/**
 * Prisma's transaction timeout does not interrupt a statement already waiting in
 * Postgres: measured, an UPDATE queued behind another connection's row lock
 * waited out the holder's whole minute while its own 5 s deadline had long
 * passed, and the request with it (AUD-07 PS-17, tests/api/jobs/aud07-contention.test.ts).
 * So each attempt tells Postgres the same deadline, local to the transaction:
 * a lock wait gives up at four fifths of it (SQLSTATE 55P03) and any statement
 * at the deadline itself (57014), both before Prisma closes the transaction, so
 * the caller gets a contention error and the rollback is Postgres's own. One
 * round trip, no extra query when the transaction is already doing work.
 */
async function boundWaits(tx: Prisma.TransactionClient, timeoutMs: number): Promise<void> {
  const lock = `${Math.max(100, Math.floor(timeoutMs * 0.8))}ms`;
  const statement = `${Math.max(100, timeoutMs)}ms`;
  await tx.$queryRaw`SELECT set_config('lock_timeout', ${lock}, true), set_config('statement_timeout', ${statement}, true)`;
}

export type TransactionOptions = {
  /** Attempts in total, the first included. */
  attempts?: number;
  timeout?: number;
  maxWait?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** The signed-in actor the operation was authorised for, re-checked at the commit boundary (AUD-06 RP-16). */
  actor?: UserContext;
};

export async function runInTransaction<T>(
  operation: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const timeout = options.timeout ?? TRANSACTION_DEADLINE_MS;
  const started = Date.now();
  const correlationId = currentRequestContext()?.correlationId;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await boundWaits(tx, timeout);
        if (options.actor) await assertActorCurrent(tx, options.actor);
        return run(tx);
      }, {
        timeout,
        maxWait: options.maxWait ?? TRANSACTION_MAX_WAIT_MS,
        isolationLevel: options.isolationLevel,
      });
      incrementCounter(Metric.TRANSACTION_SUCCESS, { operation });
      if (attempt > 1) {
        logger.info("transaction.recovered", { operation, attempt, durationMs: Date.now() - started, correlationId });
      }
      return result;
    } catch (error) {
      if (isTransient(error) && attempt < attempts) {
        incrementCounter(Metric.TRANSACTION_RETRY, { operation });
        // Backing off before the retry, so two transactions that deadlocked
        // do not line up and deadlock again (PRD #48 §246).
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** (attempt - 1) + Math.floor(Math.random() * 25)));
        continue;
      }
      incrementCounter(Metric.TRANSACTION_FAILURE, { operation });
      logger.warn("transaction.failed", {
        operation,
        attempt,
        durationMs: Date.now() - started,
        transient: isTransient(error),
        correlationId,
      });
      throw error;
    }
  }
}
