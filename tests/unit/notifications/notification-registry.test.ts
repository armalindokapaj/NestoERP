import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isPermission } from "@/config/permissions";
import {
  ATTENTION_CONDITIONS,
  attentionConditionDefinitions,
  attentionDedupeKey,
  findAttentionCondition,
} from "@/lib/core/notifications/attention.conditions";
import {
  findNotificationEvent,
  NOTIFICATION_CATEGORIES,
  NotificationEvent,
  notificationEventDefinitions,
  type OutboxEvent,
} from "@/lib/core/notifications/notification.events";
import { mailTemplateKeys } from "@/lib/mail/templates";
import { JOB_HANDLERS } from "@/lib/core/jobs/job.handlers";
import { JOBS, WORKER_GROUPS } from "@/lib/core/jobs/job.registry";

/**
 * Notification, attention and job registries (PRD #38 §75, §83, §93, §158, §159).
 */

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, files);
    else if (/\.(ts|tsx)$/.test(path)) files.push(path);
  }
  return files;
}

const event = (overrides: Partial<OutboxEvent> = {}): OutboxEvent => ({
  id: "evt_1",
  companyId: "co_1",
  eventType: "TASK_ASSIGNED",
  moduleKey: "tasks",
  entityType: "task",
  entityId: "task_1",
  actorMemberId: null,
  projectId: null,
  payloadJson: {},
  ...overrides,
});

describe("notification event registry", () => {
  it("defines every declared event once, in a known category", () => {
    const definitions = notificationEventDefinitions();
    expect(new Set(definitions.map((row) => row.eventType)).size).toBe(definitions.length);
    for (const key of Object.values(NotificationEvent)) {
      const definition = findNotificationEvent(key);
      expect(definition, key).toBeDefined();
      expect(NOTIFICATION_CATEGORIES).toContain(definition!.category);
    }
  });

  it("emails only through templates that exist", () => {
    const templates = new Set<string>(mailTemplateKeys());
    for (const definition of notificationEventDefinitions()) {
      if (definition.email) expect(templates.has(definition.email.templateKey), definition.eventType).toBe(true);
    }
  });

  it("marks only critical safety events and critical announcements mandatory", () => {
    const mandatory = notificationEventDefinitions().filter((row) => row.mandatory);
    // A critical announcement cannot be silenced in-app either (PRD #45 §45, §249).
    expect(mandatory.map((row) => row.eventType).sort()).toEqual([NotificationEvent.ANNOUNCEMENT_CRITICAL, NotificationEvent.HSE_CRITICAL_RISK].sort());
    expect(mandatory.every((row) => row.priority === "CRITICAL")).toBe(true);
  });

  it("gives each recipient of one event a distinct dedupe key", () => {
    for (const definition of notificationEventDefinitions()) {
      const payload = { dueDate: "2026-09-01", reviewId: "r1", assignmentVersion: "v1" };
      const a = definition.dedupe(event({ eventType: definition.eventType }), "member_a", payload);
      const b = definition.dedupe(event({ eventType: definition.eventType }), "member_b", payload);
      expect(a, definition.eventType).not.toBe(b);
      // Replaying the same event for the same person gives the same key.
      expect(definition.dedupe(event({ eventType: definition.eventType }), "member_a", payload)).toBe(a);
    }
  });

  it("takes the approval permission from the producer only when it is a real permission", () => {
    const approval = findNotificationEvent(NotificationEvent.APPROVAL_REQUESTED)!;
    const procurement = event({ eventType: "APPROVAL_REQUESTED", moduleKey: "procurement" });
    expect(approval.permission!(procurement, { approvePermissions: ["procurement.request.approve"] })).toEqual([
      "procurement.request.approve",
    ]);
    // A made-up permission never widens the audience: the module floor applies.
    expect(approval.permission!(procurement, { approvePermissions: ["everyone.everything"] })).toBe("procurement.approval.decide");
  });

  /** Every `NotificationEvent.X` a producer enqueues must be registered (PRD #38 §158). */
  it("registers every event type the code enqueues", () => {
    const used = new Set<string>();
    for (const file of sourceFiles("lib").concat(sourceFiles("app"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/eventType: NotificationEvent\.([A-Z_]+)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    for (const key of used) expect(findNotificationEvent(key), key).toBeDefined();
  });
});

describe("attention condition registry", () => {
  it("defines every condition once", () => {
    const keys = attentionConditionDefinitions().map((row) => row.key);
    expect([...keys].sort()).toEqual([...ATTENTION_CONDITIONS].sort());
    for (const key of ATTENTION_CONDITIONS) expect(findAttentionCondition(key)?.key).toBe(key);
  });

  it("keys an item by condition, record and episode", () => {
    const key = attentionDedupeKey("OVERDUE_TASK", { entityType: "task", entityId: "t1", episode: "2026-09-01" });
    expect(key).toBe("OVERDUE_TASK:task:t1:2026-09-01");
    expect(attentionDedupeKey("OVERDUE_TASK", { entityType: "task", entityId: "t1", episode: "2026-09-08" })).not.toBe(key);
  });
});

describe("job registry", () => {
  it("has a handler for every scheduled job, in a known group", () => {
    expect(new Set(JOBS.map((job) => job.key)).size).toBe(JOBS.length);
    for (const job of JOBS) {
      expect(JOB_HANDLERS[job.key], job.key).toBeTypeOf("function");
      expect(WORKER_GROUPS).toContain(job.group);
      expect(job.leaseSeconds, job.key).toBeGreaterThan(0);
      // A MANUAL job has no schedule to fall behind (PRD #51 §163).
      if (job.trigger !== "MANUAL") expect(job.staleAfterSeconds, job.key).toBeGreaterThan(job.intervalSeconds);
    }
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual(JOBS.map((job) => job.key).sort());
  });

  it("covers every responsibility the deployment depends on (PRD #38 §93)", () => {
    const keys = JOBS.map((job) => job.key);
    for (const required of ["notifications.dispatch", "documents.scan", "storage.cleanup", "storage.orphans", "retention.run", "attention.reconcile"]) {
      expect(keys).toContain(required);
    }
  });

  it("names only real permissions in attention recipients", async () => {
    // Holders are declared inline; a typo would silently reach nobody.
    const source = readFileSync("lib/core/notifications/attention.conditions.ts", "utf8");
    const names = [...source.matchAll(/"([a-z_]+\.[a-z_.]+)"/g)].map((match) => match[1]).filter((name) => name.split(".").length >= 3);
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) expect(isPermission(name), name).toBe(true);
  });
});
