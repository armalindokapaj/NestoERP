import { currentJobRun, jobStopRequested } from "@/lib/core/jobs/job.context";
import { logger, serialiseError } from "@/lib/core/observability/logger";

/**
 * How the storage jobs walk their queues (PRD #51 §133-§138, §30-§36).
 *
 * The scan queue, upload sessions and stored objects are RECORD-scoped: every
 * row carries its own company, so one pass over the table serves every
 * company, suspended ones included, and nothing is written with a company the
 * row does not already have.
 */

/** Rows fetched per query. Small, so a large backlog is never held in memory at once. */
export const SWEEP_BATCH_SIZE = 100;

/** An operator's `--company`, applied to a queue whose rows carry their own company (§164). */
export function sweepCompanyScope(): { companyId?: { in: string[] } } {
  const companyIds = currentJobRun()?.companyIds;
  return companyIds ? { companyId: { in: [...companyIds] } } : {};
}

/**
 * Walks a queue in id order, a batch at a time, until it runs dry or the run
 * is told to stop.
 *
 * The cursor is the id, which never changes, so a row whose state the handler
 * moves is not met again in the same pass and a row that keeps failing cannot
 * hold the rest of the queue behind it. Each row is handled on its own: one
 * that throws is logged by id and counted, and the rows after it still get
 * their turn. What to do about the count is the caller's decision.
 */
export async function sweep<T extends { id: string; companyId?: string }>(
  event: string,
  page: (after: { id?: { gt: string } }, take: number) => Promise<T[]>,
  handle: (row: T) => Promise<void>,
  batchSize = SWEEP_BATCH_SIZE,
): Promise<{ failed: number }> {
  let failed = 0;
  let cursor: string | undefined;
  for (;;) {
    if (jobStopRequested()) return { failed };
    const rows = await page(cursor ? { id: { gt: cursor } } : {}, batchSize);
    for (const row of rows) {
      if (jobStopRequested()) return { failed };
      try {
        await handle(row);
      } catch (error) {
        failed += 1;
        logger.error(event, { id: row.id, companyId: row.companyId, ...serialiseError(error) });
      }
    }
    if (rows.length < batchSize) return { failed };
    cursor = rows[rows.length - 1].id;
  }
}
