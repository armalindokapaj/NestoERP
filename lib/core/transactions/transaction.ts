import { Prisma } from "@prisma/client";

import { logger } from "@/lib/core/observability/logger";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { currentRequestContext } from "@/lib/core/observability/request-context";
import { prisma } from "@/lib/database/prisma";

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
 * The callback must contain only database work. An email, an upload or an
 * external call inside it either happens twice on a retry or happens before a
 * rollback that unhappens everything else (§29, §115).
 */

/** Postgres serialisation failure, deadlock, and Prisma's own write conflict. */
const TRANSIENT = new Set(["P2034"]);
const TRANSIENT_PG = new Set(["40001", "40P01"]);

function isTransient(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (TRANSIENT.has(error.code)) return true;
    const pg = (error.meta as { code?: string } | undefined)?.code;
    return typeof pg === "string" && TRANSIENT_PG.has(pg);
  }
  return false;
}

export type TransactionOptions = {
  /** Attempts in total, the first included. */
  attempts?: number;
  timeout?: number;
  maxWait?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

export async function runInTransaction<T>(
  operation: string,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const started = Date.now();
  const correlationId = currentRequestContext()?.correlationId;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await prisma.$transaction(run, {
        timeout: options.timeout,
        maxWait: options.maxWait,
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
