import { describe, expect, it } from "vitest";

import {
  findRetentionPolicy,
  retentionCutoff,
  retentionPolicies,
} from "@/lib/core/retention/retention-policy.registry";

/**
 * The V0.1 position this guards: core business records and audit evidence are
 * never automatically deleted (PRD #33 §49, §52, §199).
 */
describe("retention policy registry", () => {
  it("registers each policy key once", () => {
    const keys = retentionPolicies().map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never purges audit or business records", () => {
    for (const key of ["audit-events", "business-records"]) {
      const policy = findRetentionPolicy(key);
      expect(policy?.retentionDays, key).toBeNull();
      expect(policy?.deleteMode, key).toBe("NONE");
    }
  });

  it("returns no cutoff for a never-purge policy", () => {
    expect(retentionCutoff(findRetentionPolicy("audit-events")!)).toBeNull();
  });

  it("computes a cutoff in the past for a purging policy", () => {
    const now = new Date("2026-09-11T00:00:00.000Z");
    const cutoff = retentionCutoff(findRetentionPolicy("notifications.read")!, now);
    expect(cutoff?.toISOString()).toBe("2025-09-11T00:00:00.000Z");
  });

  it("only ever hard-deletes operational debris, never a business record", () => {
    const destructive = retentionPolicies().filter((p) => p.deleteMode === "HARD_DELETE");
    const resourceTypes = destructive.map((p) => p.resourceType);

    for (const businessType of ["Invoice", "Project", "Task", "Client", "AuditEvent", "Document"]) {
      expect(resourceTypes, `${businessType} is purgeable`).not.toContain(businessType);
    }
  });

  /** Failed work is what an operator investigates; it outlives work that went through (PRD #51 §227). */
  it("keeps failed events and their failure history longer than delivered events", () => {
    const processed = findRetentionPolicy("notification-outbox.processed")!.retentionDays!;
    const failed = findRetentionPolicy("notification-outbox.failed")!.retentionDays!;
    const failures = findRetentionPolicy("job-failures")!.retentionDays!;
    expect(failed).toBeGreaterThan(processed);
    expect(failures).toBeGreaterThanOrEqual(failed);
  });

  /**
   * A job's record of what it already sent must outlive the notification it
   * sent, or a condition still true a year on is announced again while the
   * first notice can still be read (PRD #51 §15-§19).
   */
  it("keeps job idempotency keys past the purge of read notifications", () => {
    const keys = findRetentionPolicy("job-idempotency-keys")!;
    expect(keys.deleteMode).toBe("HARD_DELETE");
    expect(keys.retentionDays!).toBeGreaterThan(findRetentionPolicy("notifications.read")!.retentionDays!);
  });

  it("gives every purging policy a bounded batch size", () => {
    for (const policy of retentionPolicies().filter((p) => p.deleteMode !== "NONE")) {
      expect(policy.batchSize, policy.key).toBeGreaterThan(0);
      expect(policy.batchSize, policy.key).toBeLessThanOrEqual(5000);
    }
  });
});
