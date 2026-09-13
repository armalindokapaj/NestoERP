import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { retentionCutoff, retentionPolicies, type RetentionPolicy } from "./retention-policy.registry";

/**
 * Retention execution (PRD #33 §68-§74).
 *
 * Batched, idempotent and restartable: never a single transaction deleting
 * millions of rows (PRD #33 §71, §72). Dry run reports what would go without
 * touching anything, because that is the only safe way to review a destructive
 * policy (PRD #33 §74).
 */

export type RetentionRunResult = {
  policyKey: string;
  candidateCount: number;
  deletedCount: number;
  dryRun: boolean;
  skipped?: string;
};

async function countAndDelete(
  policy: RetentionPolicy,
  cutoff: Date,
  dryRun: boolean,
): Promise<{ candidates: number; deleted: number }> {
  switch (policy.key) {
    case "sessions.expired": {
      const where = { expiresAt: { lt: cutoff } };
      const candidates = await prisma.session.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.session.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "password-reset-tokens.used": {
      const where = { OR: [{ usedAt: { not: null, lt: cutoff } }, { expiresAt: { lt: cutoff } }] };
      const candidates = await prisma.passwordResetToken.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.passwordResetToken.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "company-invites.expired": {
      const where = { expiresAt: { lt: cutoff }, status: { not: "ACCEPTED" as const } };
      const candidates = await prisma.companyInvite.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.companyInvite.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "notifications.read": {
      const where = { readState: "READ" as const, readAt: { lt: cutoff } };
      const candidates = await prisma.notification.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.notification.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "attention.resolved": {
      const where = { status: "RESOLVED" as const, resolvedAt: { lt: cutoff } };
      const candidates = await prisma.attentionItem.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.attentionItem.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "integration-attempts.completed": {
      const where = { completedAt: { not: null, lt: cutoff } };
      const candidates = await prisma.integrationAttempt.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.integrationAttempt.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "notification-outbox.processed": {
      const where = { status: "PROCESSED" as const, processedAt: { lt: cutoff } };
      const candidates = await prisma.notificationEventOutbox.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.notificationEventOutbox.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "mail-deliveries.settled": {
      const where = { createdAt: { lt: cutoff }, status: { not: "QUEUED" as const } };
      const candidates = await prisma.mailDelivery.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.mailDelivery.deleteMany({ where });
      return { candidates, deleted: count };
    }
    case "rate-limit-buckets.expired": {
      const where = { windowEndsAt: { lt: cutoff } };
      const candidates = await prisma.rateLimitBucket.count({ where });
      if (dryRun) return { candidates, deleted: 0 };
      const { count } = await prisma.rateLimitBucket.deleteMany({ where });
      return { candidates, deleted: count };
    }
    default:
      return { candidates: 0, deleted: 0 };
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

  const { candidates, deleted } = await countAndDelete(policy, cutoff, dryRun);

  logger.info("retention.policy.run", {
    policyKey,
    dryRun,
    candidateCount: candidates,
    deletedCount: deleted,
  });

  return { policyKey, candidateCount: candidates, deletedCount: deleted, dryRun };
}

/** Runs every purging policy. Defaults to a dry run (PRD #33 §74). */
export async function runAllRetentionPolicies(
  options: { dryRun?: boolean } = {},
): Promise<RetentionRunResult[]> {
  const results: RetentionRunResult[] = [];
  for (const policy of retentionPolicies()) {
    if (policy.deleteMode === "NONE") continue;
    results.push(await runRetentionPolicy(policy.key, { dryRun: options.dryRun ?? true }));
  }
  return results;
}
