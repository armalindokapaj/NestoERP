/**
 * Retention policies (PRD #33 §48-§77, §162).
 *
 * The V0.1 position, stated plainly: core business records are never
 * automatically deleted (PRD #33 §49). What expires here is operational debris
 * — dead sessions, spent tokens, abandoned uploads — and nothing whose absence
 * would change what the business can prove (PRD #33 §10).
 */

export type DeleteMode = "NONE" | "SOFT_DELETE" | "HARD_DELETE";

export type RetentionPolicy = {
  key: string;
  resourceType: string;
  /** null means never purge automatically (PRD #33 §67). */
  retentionDays: number | null;
  deleteMode: DeleteMode;
  legalHoldAware: boolean;
  batchSize: number;
  description: string;
};

const POLICIES: RetentionPolicy[] = [
  {
    key: "sessions.expired",
    resourceType: "Session",
    retentionDays: 1,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description: "Sessions are cleaned the day after they expire (PRD #33 §59).",
  },
  {
    key: "password-reset-tokens.used",
    resourceType: "PasswordResetToken",
    retentionDays: 3,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description: "Used or expired reset tokens, after a short diagnostic grace (PRD #33 §60).",
  },
  {
    key: "company-invites.expired",
    resourceType: "CompanyInvite",
    retentionDays: 30,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 500,
    description: "Expired invitations once the team history no longer needs them (PRD #33 §61).",
  },
  {
    key: "notifications.read",
    resourceType: "Notification",
    retentionDays: 365,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description: "Read notifications after twelve months (PRD #33 §57, PRD #25 §161).",
  },
  {
    key: "attention.resolved",
    resourceType: "AttentionItem",
    retentionDays: 180,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description: "Resolved attention items; Activity keeps the history (PRD #33 §58).",
  },
  {
    key: "integration-attempts.completed",
    resourceType: "IntegrationAttempt",
    retentionDays: 90,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description: "Technical retry history, not business evidence (PRD #23 §161).",
  },
  {
    key: "notification-outbox.processed",
    resourceType: "NotificationEventOutbox",
    retentionDays: 30,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description: "Processed outbox rows once delivery is settled.",
  },
  {
    key: "notification-outbox.failed",
    resourceType: "NotificationEventOutbox",
    retentionDays: 180,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description:
      "Events that never delivered, six months after they failed: far longer than delivered ones, because a failed event is what an operator comes looking for (PRD #51 §205, §227).",
  },
  {
    key: "job-failures",
    resourceType: "JobFailure",
    retentionDays: 180,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description:
      "Every failed job run and outbox attempt, kept as long as the failed events they explain. A manual retry marks these rows and never removes them (PRD #51 §36, §39, §227).",
  },
  {
    key: "job-idempotency-keys",
    resourceType: "JobIdempotencyKey",
    retentionDays: 400,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description:
      "What a job has already sent. Kept past the 365-day purge of read notifications, so a condition that stays true for a year — an RFI nobody answers — is not announced a second time while the first notice may still be on somebody's list (PRD #51 §15-§19).",
  },
  {
    key: "sync-operations",
    resourceType: "SyncOperation",
    retentionDays: 90,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description:
      "What the server did for an offline operation id (MOB-09 §82). Kept well past the offline authorisation window (at most 14 days) and the time a locked device may sit on unsynced work, so a late retry is still answered instead of repeated.",
  },
  {
    key: "worker-processes.stopped",
    resourceType: "WorkerProcess",
    retentionDays: 7,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description:
      "Worker processes that stopped, or stopped beating, a week ago. Health only reads the living; a worker also prunes these when it starts (PRD #51 §116-§118, §229).",
  },
  {
    key: "mail-deliveries.settled",
    resourceType: "MailDelivery",
    retentionDays: 180,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 1000,
    description: "Mail delivery metadata after six months; bodies are never stored (PRD #38 §164).",
  },
  {
    key: "rate-limit-buckets.expired",
    resourceType: "RateLimitBucket",
    retentionDays: 1,
    deleteMode: "HARD_DELETE",
    legalHoldAware: false,
    batchSize: 5000,
    description: "Throttle windows a day after they closed (PRD #38 §17).",
  },
  // Everything below is explicitly never purged automatically (PRD #33 §49, §52).
  {
    key: "audit-events",
    resourceType: "AuditEvent",
    retentionDays: null,
    deleteMode: "NONE",
    legalHoldAware: true,
    batchSize: 0,
    description: "Audit is never purged in V0.1; the target policy is seven years (PRD #33 §52).",
  },
  {
    key: "business-records",
    resourceType: "BusinessRecord",
    retentionDays: null,
    deleteMode: "NONE",
    legalHoldAware: true,
    batchSize: 0,
    description: "Core business records are archived, never automatically deleted (PRD #33 §49, §51).",
  },
];

const BY_KEY = new Map<string, RetentionPolicy>();
for (const policy of POLICIES) {
  if (BY_KEY.has(policy.key)) throw new Error(`Duplicate retention policy: ${policy.key}`);
  BY_KEY.set(policy.key, policy);
}

export function findRetentionPolicy(key: string): RetentionPolicy | undefined {
  return BY_KEY.get(key);
}

export function retentionPolicies(): RetentionPolicy[] {
  return [...POLICIES];
}

/** The cutoff a policy applies at, in UTC (PRD #33 §171). */
export function retentionCutoff(policy: RetentionPolicy, now: Date = new Date()): Date | null {
  if (policy.retentionDays === null) return null;
  return new Date(now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Future legal-hold hook. V0.1 has no hold UI, but the check exists so adding
 * one later does not mean revisiting every policy (PRD #33 §75, §76).
 */
export async function isUnderLegalHold(resourceType: string, resourceId: string): Promise<boolean> {
  // No LegalHold model in V0.1. The signature is the point: adding one later
  // means implementing this function, not revisiting every policy.
  void resourceType;
  void resourceId;
  return false;
}
