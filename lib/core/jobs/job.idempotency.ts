import type { Prisma } from "@prisma/client";

/**
 * "Has this job already done this, for this company?" (PRD #51 §15-§19).
 *
 * Call it inside the transaction that produces the effect — the outbox event,
 * the reminder — and act only when it returns true. The row and the effect
 * commit together or not at all, and the primary key is what makes a second
 * run, a second worker or an old and a new worker overlapping in a deploy
 * produce one effect between them: the loser's insert is skipped, and it
 * returns false.
 *
 * `key` names the logical work item without the job or the company, which the
 * row already carries: `rfi_123:2026-09-16`, `member_9:2026-09-14`. It must
 * say everything that makes the effect one effect — the due date as well as
 * the record, when a moved due date deserves a new reminder.
 */
export async function claimIdempotencyKey(
  tx: Prisma.TransactionClient,
  input: { companyId: string; jobKey: string; key: string },
): Promise<boolean> {
  const inserted = await tx.jobIdempotencyKey.createMany({
    data: [{ companyId: input.companyId, jobKey: input.jobKey, key: input.key.slice(0, 500) }],
    skipDuplicates: true,
  });
  return inserted.count === 1;
}

/** Whether a key has been claimed, for a job that must decide before it opens a transaction. */
export async function idempotencyKeyClaimed(
  client: Prisma.TransactionClient,
  input: { companyId: string; jobKey: string; key: string },
): Promise<boolean> {
  const row = await client.jobIdempotencyKey.findUnique({
    where: { companyId_jobKey_key: { companyId: input.companyId, jobKey: input.jobKey, key: input.key.slice(0, 500) } },
    select: { key: true },
  });
  return row !== null;
}
