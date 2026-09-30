import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { jobStopRequested } from "@/lib/core/jobs/job.context";
import { JobError } from "@/lib/core/jobs/job.errors";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { retentionCutoff, retentionPolicies, type RetentionPolicy } from "./retention-policy.registry";

/**
 * Retention execution (PRD #33 §68-§74, PRD #51 §132-§137, §226-§230).
 *
 * Batched, idempotent and restartable: never a single transaction deleting
 * millions of rows (PRD #33 §71, §72). Each batch removes at most the policy's
 * `batchSize` rows, so no lock outlives a batch, and a run told to stop between
 * batches — shutdown, timeout — loses nothing: whatever it did not reach is
 * still past the cutoff next time. Dry run reports what would go without
 * touching anything, because that is the only safe way to review a destructive
 * policy (PRD #33 §74).
 *
 * One policy failing does not cost the others their run; the run still fails,
 * after all of them, so the failure is seen (PRD #51 §30-§36).
 */

export type RetentionRunResult = {
  policyKey: string;
  candidateCount: number;
  deletedCount: number;
  dryRun: boolean;
  skipped?: string;
};

type Purge = {
  count(): Promise<number>;
  /** Chooses up to `take` rows past the cutoff and deletes those still past it. */
  deleteBatch(take: number): Promise<{ chosen: number; deleted: number }>;
};

/**
 * A policy's rows, as three calls on its model.
 *
 * The delete repeats the condition beside the chosen keys, so a row that
 * changed after it was chosen — a failed event an operator retried, a throttle
 * window a sign-in restarted — is judged as it is now.
 */
function purge<Where, Key>(
  where: Where,
  calls: {
    count(where: Where): Promise<number>;
    choose(where: Where, take: number): Promise<Key[]>;
    remove(where: Where, keys: Key[]): Promise<number>;
  },
): Purge {
  return {
    count: () => calls.count(where),
    async deleteBatch(take) {
      const keys = await calls.choose(where, take);
      return { chosen: keys.length, deleted: keys.length === 0 ? 0 : await calls.remove(where, keys) };
    },
  };
}

/** What each purging policy removes. A purging policy missing here fails its run rather than quietly deleting nothing. */
function purgeFor(policyKey: string, cutoff: Date): Purge | null {
  switch (policyKey) {
    case "sessions.expired":
      return purge<Prisma.SessionWhereInput, string>({ expiresAt: { lt: cutoff } }, {
        count: (where) => prisma.session.count({ where }),
        choose: async (where, take) => (await prisma.session.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.session.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "password-reset-tokens.used":
      return purge<Prisma.PasswordResetTokenWhereInput, string>({ OR: [{ usedAt: { not: null, lt: cutoff } }, { expiresAt: { lt: cutoff } }] }, {
        count: (where) => prisma.passwordResetToken.count({ where }),
        choose: async (where, take) => (await prisma.passwordResetToken.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.passwordResetToken.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "company-invites.expired":
      return purge<Prisma.CompanyInviteWhereInput, string>({ expiresAt: { lt: cutoff }, status: { not: "ACCEPTED" } }, {
        count: (where) => prisma.companyInvite.count({ where }),
        choose: async (where, take) => (await prisma.companyInvite.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.companyInvite.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "notifications.read":
      return purge<Prisma.NotificationWhereInput, string>({ readState: "READ", readAt: { lt: cutoff } }, {
        count: (where) => prisma.notification.count({ where }),
        choose: async (where, take) => (await prisma.notification.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.notification.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "attention.resolved":
      return purge<Prisma.AttentionItemWhereInput, string>({ status: "RESOLVED", resolvedAt: { lt: cutoff } }, {
        count: (where) => prisma.attentionItem.count({ where }),
        choose: async (where, take) => (await prisma.attentionItem.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.attentionItem.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "integration-attempts.completed":
      return purge<Prisma.IntegrationAttemptWhereInput, string>({ completedAt: { not: null, lt: cutoff } }, {
        count: (where) => prisma.integrationAttempt.count({ where }),
        choose: async (where, take) => (await prisma.integrationAttempt.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.integrationAttempt.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "notification-outbox.processed":
      return purge<Prisma.NotificationEventOutboxWhereInput, string>({ status: "PROCESSED", processedAt: { lt: cutoff } }, {
        count: (where) => prisma.notificationEventOutbox.count({ where }),
        choose: async (where, take) => (await prisma.notificationEventOutbox.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.notificationEventOutbox.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "notification-outbox.failed":
      // An event an operator sends round again is PENDING, and out of reach, from the moment it is retried.
      return purge<Prisma.NotificationEventOutboxWhereInput, string>({ status: "FAILED", failedAt: { lt: cutoff } }, {
        count: (where) => prisma.notificationEventOutbox.count({ where }),
        choose: async (where, take) => (await prisma.notificationEventOutbox.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.notificationEventOutbox.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "job-failures":
      return purge<Prisma.JobFailureWhereInput, string>({ failedAt: { lt: cutoff } }, {
        count: (where) => prisma.jobFailure.count({ where }),
        choose: async (where, take) => (await prisma.jobFailure.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.jobFailure.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "job-idempotency-keys":
      return purge<Prisma.JobIdempotencyKeyWhereInput, Prisma.JobIdempotencyKeyWhereInput>({ createdAt: { lt: cutoff } }, {
        count: (where) => prisma.jobIdempotencyKey.count({ where }),
        choose: (where, take) => prisma.jobIdempotencyKey.findMany({ where, select: { companyId: true, jobKey: true, key: true }, take }),
        remove: async (where, keys) => (await prisma.jobIdempotencyKey.deleteMany({ where: { AND: [where, { OR: keys }] } })).count,
      });
    case "sync-operations":
      return purge<Prisma.SyncOperationWhereInput, string>({ createdAt: { lt: cutoff } }, {
        count: (where) => prisma.syncOperation.count({ where }),
        choose: async (where, take) => (await prisma.syncOperation.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.syncOperation.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "worker-processes.stopped":
      // A running worker beats every few seconds, so a week-old heartbeat is a process that stopped or died.
      return purge<Prisma.WorkerProcessWhereInput, string>({ lastHeartbeatAt: { lt: cutoff } }, {
        count: (where) => prisma.workerProcess.count({ where }),
        choose: async (where, take) => (await prisma.workerProcess.findMany({ where, select: { workerId: true }, take })).map((row) => row.workerId),
        remove: async (where, ids) => (await prisma.workerProcess.deleteMany({ where: { AND: [where, { workerId: { in: ids } }] } })).count,
      });
    case "mail-deliveries.settled":
      return purge<Prisma.MailDeliveryWhereInput, string>({ createdAt: { lt: cutoff }, status: { not: "QUEUED" } }, {
        count: (where) => prisma.mailDelivery.count({ where }),
        choose: async (where, take) => (await prisma.mailDelivery.findMany({ where, select: { id: true }, take })).map((row) => row.id),
        remove: async (where, ids) => (await prisma.mailDelivery.deleteMany({ where: { AND: [where, { id: { in: ids } }] } })).count,
      });
    case "rate-limit-buckets.expired":
      return purge<Prisma.RateLimitBucketWhereInput, string>({ windowEndsAt: { lt: cutoff } }, {
        count: (where) => prisma.rateLimitBucket.count({ where }),
        choose: async (where, take) => (await prisma.rateLimitBucket.findMany({ where, select: { key: true }, take })).map((row) => row.key),
        remove: async (where, keys) => (await prisma.rateLimitBucket.deleteMany({ where: { AND: [where, { key: { in: keys } }] } })).count,
      });
    default:
      return null;
  }
}

/** Batch after batch until one comes back short, or the run is told to stop. */
async function deleteInBatches(policy: RetentionPolicy, rows: Purge): Promise<number> {
  let deleted = 0;
  for (;;) {
    if (jobStopRequested()) return deleted;
    const batch = await rows.deleteBatch(policy.batchSize);
    deleted += batch.deleted;
    if (batch.chosen < policy.batchSize) return deleted;
  }
}

export async function runRetentionPolicy(
  policyKey: string,
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<RetentionRunResult> {
  const policy = retentionPolicies().find((p) => p.key === policyKey);
  if (!policy) throw new Error(`UNKNOWN_RETENTION_POLICY:${policyKey}`);

  const dryRun = options.dryRun ?? true;
  const cutoff = retentionCutoff(policy, options.now);

  // A NONE policy is a deliberate decision, not an oversight (PRD #33 §49).
  if (cutoff === null || policy.deleteMode === "NONE") {
    return {
      policyKey,
      candidateCount: 0,
      deletedCount: 0,
      dryRun,
      skipped: "Policy never purges automatically.",
    };
  }

  const rows = purgeFor(policy.key, cutoff);
  if (!rows) throw new JobError("CONFIGURATION", `Retention policy ${policy.key} purges, but nothing says which rows`);
  if (!Number.isInteger(policy.batchSize) || policy.batchSize < 1) {
    throw new JobError("CONFIGURATION", `Retention policy ${policy.key} has no batch size`);
  }

  const candidates = await rows.count();
  const deleted = dryRun || candidates === 0 ? 0 : await deleteInBatches(policy, rows);

  logger.info("retention.policy.run", {
    policyKey,
    dryRun,
    candidateCount: candidates,
    deletedCount: deleted,
  });

  return { policyKey, candidateCount: candidates, deletedCount: deleted, dryRun };
}

/**
 * Runs every purging policy. Defaults to a dry run (PRD #33 §74).
 *
 * Throws PARTIAL_FAILURE once every policy has had its turn if any of them
 * failed; stops starting new policies once the run is told to stop.
 */
export async function runAllRetentionPolicies(
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<RetentionRunResult[]> {
  const results: RetentionRunResult[] = [];
  const failed: string[] = [];
  for (const policy of retentionPolicies()) {
    if (policy.deleteMode === "NONE") continue;
    if (jobStopRequested()) break;
    try {
      results.push(await runRetentionPolicy(policy.key, { dryRun: options.dryRun ?? true, now: options.now }));
    } catch (error) {
      logger.error("retention.run.item_failed", { policyKey: policy.key, ...serialiseError(error) });
      failed.push(policy.key);
    }
  }
  if (failed.length > 0) {
    throw new JobError("PARTIAL_FAILURE", `retention failed for ${failed.length} of ${failed.length + results.length} policies: ${failed.join(", ")}`);
  }
  return results;
}
