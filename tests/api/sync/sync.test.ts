import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { UserContext } from "@/lib/context/types";
import { AccessError } from "@/lib/access/guards";
import { buildAuthorizationSnapshot } from "@/lib/core/sync/authorization.service";
import { buildProjectPackage, type KnownTokens } from "@/lib/core/sync/package.service";
import { SYNC_PROTOCOL_VERSION, type SyncOperationEnvelope, type SyncOperationResult } from "@/lib/core/sync/protocol";
import { processSyncBatch } from "@/lib/core/sync/sync.service";
import { documentOfflineStatus } from "@/lib/modules/documents/versions/offline.service";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * The server half of offline sync, against the real database (MOB-09 §129-§131,
 * §145-§149, §155, §157): every queued change goes through the canonical
 * service, exactly once, refused or conflicted on the service's own rules.
 * Fixtures carry the `test09_` prefix and are removed with the file.
 */

const SITE = "test09_yard";
const TASK = "test09_task";
const WORK_DATE = () => new Date().toISOString().slice(0, 10);

let engineer: UserContext;
let hse: UserContext;
let viewer: UserContext;
let counter = 0;

const op = (overrides: Partial<SyncOperationEnvelope> & Pick<SyncOperationEnvelope, "type">): SyncOperationEnvelope => ({
  operationId: `op_test09_${Date.now()}_${(counter += 1)}`,
  claimedCompanyId: COMPANY.a,
  projectId: SITE,
  target: null,
  expectedVersion: null,
  payload: {},
  capturedAt: null,
  ...overrides,
});

async function send(context: UserContext, ...operations: SyncOperationEnvelope[]): Promise<SyncOperationResult[]> {
  return (await processSyncBatch(context, { protocolVersion: SYNC_PROTOCOL_VERSION, operations })).results;
}

async function cleanup() {
  const logs = await prisma.dailyLog.findMany({ where: { projectId: SITE }, select: { id: true } });
  const ids = logs.map((row) => row.id);
  const trail = [...ids, SITE, TASK];
  await prisma.syncOperation.deleteMany({ where: { operationId: { startsWith: "op_test09_" } } });
  await prisma.attentionItem.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notification.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: trail } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: trail } } });
  const threads = await prisma.collaborationThread.findMany({ where: { parentId: { in: trail } }, select: { id: true } });
  const threadIds = threads.map((row) => row.id);
  await prisma.mention.deleteMany({ where: { comment: { threadId: { in: threadIds } } } });
  await prisma.comment.deleteMany({ where: { threadId: { in: threadIds } } });
  await prisma.subscription.deleteMany({ where: { threadId: { in: threadIds } } });
  await prisma.collaborationThread.deleteMany({ where: { id: { in: threadIds } } });
  await prisma.dailyLog.deleteMany({ where: { id: { in: ids } } });
  await prisma.hseIncident.deleteMany({ where: { projectId: SITE } });
}

async function freshTask() {
  await prisma.task.deleteMany({ where: { id: TASK } });
  await prisma.task.create({ data: { id: TASK, companyId: COMPANY.a, projectId: SITE, title: "Facade Inspection", assigneeMemberId: "member_engineer", status: "IN_PROGRESS", createdByMemberId: "member_owner", createdBy: "user_owner" } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.project.deleteMany({ where: { id: SITE } });
  engineer = await loginAs("ENGINEER");
  hse = await loginAs("HSE");
  viewer = await loginAs("VIEWER");
  await prisma.project.create({ data: { id: SITE, companyId: COMPANY.a, code: "T09-YARD", name: "Offline Yard", status: "ACTIVE", projectManagerMemberId: "member_owner", createdBy: "test" } });
  await prisma.projectMember.createMany({ data: ["member_engineer", "member_hse"].map((companyMemberId) => ({ companyId: COMPANY.a, projectId: SITE, companyMemberId, status: "ACTIVE" as const })) });
  await freshTask();
});

beforeEach(freshTask);
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.task.deleteMany({ where: { id: TASK } });
  await prisma.projectMember.deleteMany({ where: { projectId: SITE } });
  await prisma.project.deleteMany({ where: { id: SITE } });
  await cleanupSessions();
});

describe("idempotency (§31, §82, §129, §155)", () => {
  it("answers a retried operation with the first result and does the work once", async () => {
    const create = op({ type: "SITE_DIARY_CREATE", payload: { workDate: WORK_DATE() } });
    const [first] = await send(engineer, create);
    const [again] = await send(engineer, create);

    expect(first!.result).toBe("APPLIED");
    expect(again!.result).toBe("DUPLICATE");
    expect(again!.canonicalEntityId).toBe(first!.canonicalEntityId);
    expect(await prisma.dailyLog.count({ where: { projectId: SITE } })).toBe(1);
    expect(await prisma.syncOperation.count({ where: { operationId: create.operationId } })).toBe(1);
  });

  it("a comment is posted once even when the ledger never recorded the first attempt", async () => {
    const comment = op({ type: "TASK_COMMENT_CREATE", target: { entityType: "Task", entityId: TASK }, payload: { body: "Updated the drawing." } });
    const [first] = await send(engineer, comment);
    expect(first!.result).toBe("APPLIED");
    // The crash window: the service committed, the ledger row was never written.
    await prisma.syncOperation.deleteMany({ where: { operationId: comment.operationId } });
    const [again] = await send(engineer, comment);

    expect(again!.canonicalEntityId).toBe(first!.canonicalEntityId);
    expect(await prisma.comment.count({ where: { clientOperationId: comment.operationId } })).toBe(1);
  });

  it("an incident is reported once even when the ledger never recorded the first attempt", async () => {
    const report = op({ type: "HSE_CREATE", payload: { incidentType: "NEAR_MISS", severity: "LOW", title: "Loose scaffold board", description: "Board not clipped.", occurredAt: new Date().toISOString() } });
    const [first] = await send(hse, report);
    expect(first!.result).toBe("APPLIED");
    await prisma.syncOperation.deleteMany({ where: { operationId: report.operationId } });
    const [again] = await send(hse, report);

    expect(again!.canonicalEntityId).toBe(first!.canonicalEntityId);
    expect(await prisma.hseIncident.count({ where: { projectId: SITE } })).toBe(1);
  });

  it("a critical incident raises its notification event only once the server has it, and only once (MOB-10 §73, §166, §176)", async () => {
    const report = op({ type: "HSE_CREATE", payload: { incidentType: "INCIDENT", severity: "CRITICAL", title: "Fall from height", description: "Worker fell from scaffold.", immediateAction: "Area cordoned off, first aid given.", occurredAt: new Date().toISOString() } });
    // Captured offline: nothing has reached the server, so nothing can have been raised.
    expect(await prisma.notificationEventOutbox.count({ where: { eventType: "HSE_CRITICAL_RISK", projectId: SITE } })).toBe(0);

    const [first] = await send(hse, report);
    expect(first!.result, JSON.stringify(first)).toBe("APPLIED");
    const incidentId = first!.canonicalEntityId!;
    const events = () => prisma.notificationEventOutbox.findMany({ where: { eventType: "HSE_CRITICAL_RISK", entityId: incidentId } });
    expect(await events()).toHaveLength(1);

    // A retry, even after the ledger row was lost, raises nothing new.
    await prisma.syncOperation.deleteMany({ where: { operationId: report.operationId } });
    await send(hse, report);
    expect(await events()).toHaveLength(1);

    await prisma.notification.deleteMany({ where: { entityId: incidentId } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: incidentId } });
  });

  it("refuses one operation id reused for different work", async () => {
    const one = op({ type: "TASK_COMMENT_CREATE", target: { entityType: "Task", entityId: TASK }, payload: { body: "first" } });
    await send(engineer, one);
    const [result] = await send(engineer, { ...one, payload: { body: "something else" } });
    expect(result).toMatchObject({ result: "REJECTED", errorType: "VALIDATION", code: "OPERATION_ID_REUSED" });
  });

  it("a second device starting the same day lands in the same log", async () => {
    const a = op({ type: "SITE_DIARY_CREATE", payload: { workDate: WORK_DATE() } });
    const b = op({ type: "SITE_DIARY_CREATE", payload: { workDate: WORK_DATE() } });
    const [ra, rb] = [(await send(engineer, a))[0]!, (await send(engineer, b))[0]!];
    expect(rb.canonicalEntityId).toBe(ra.canonicalEntityId);
    expect(await prisma.dailyLog.count({ where: { projectId: SITE } })).toBe(1);
  });
});

describe("a site diary through the canonical service (§36-§39, §149)", () => {
  async function startDiary() {
    const [created] = await send(engineer, op({ type: "SITE_DIARY_CREATE", payload: { workDate: WORK_DATE() } }));
    return { id: created!.canonicalEntityId!, version: created!.serverVersion! };
  }

  it("creates, edits, adds a row and submits, carrying the version between changes", async () => {
    const { id, version } = await startDiary();
    const [edited] = await send(engineer, op({ type: "SITE_DIARY_UPDATE_DRAFT", target: { entityType: "DailyLog", entityId: id }, expectedVersion: version, payload: { summary: "Slab poured" } }));
    expect(edited).toMatchObject({ result: "APPLIED", serverVersion: version + 1 });

    const [row] = await send(engineer, op({ type: "SITE_DIARY_ADD_ENTRY", target: { entityType: "DailyLog", entityId: id }, payload: { section: "activities", input: { title: "Pour slab B" } } }));
    expect(row).toMatchObject({ result: "APPLIED", serverVersion: version + 2 });

    const [submitted] = await send(engineer, op({ type: "SITE_DIARY_SUBMIT", target: { entityType: "DailyLog", entityId: id }, expectedVersion: version + 2 }));
    expect(submitted!.result).toBe("APPLIED");
    const log = await prisma.dailyLog.findUniqueOrThrow({ where: { id } });
    expect(log.status).toBe("SUBMITTED");
    expect(log.summary).toBe("Slab poured");
    expect(log.submittedByMemberId).toBe(engineer.membershipId);
  });

  it("a submit that was already applied is not a conflict when it is retried after its record was lost", async () => {
    const { id, version } = await startDiary();
    await send(engineer, op({ type: "SITE_DIARY_ADD_ENTRY", target: { entityType: "DailyLog", entityId: id }, payload: { section: "activities", input: { title: "Work" } } }));
    const submit = op({ type: "SITE_DIARY_SUBMIT", target: { entityType: "DailyLog", entityId: id }, expectedVersion: version + 1 });
    const [first] = await send(engineer, submit);
    expect(first!.result).toBe("APPLIED");
    await prisma.syncOperation.deleteMany({ where: { operationId: submit.operationId } });
    const [again] = await send(engineer, submit);
    expect(again!.result).toBe("APPLIED");
    expect((await prisma.dailyLog.findUniqueOrThrow({ where: { id } })).submissionCount).toBe(1);
  });

  it("does not overwrite a log that moved on: a stale version is a conflict that names what the server holds", async () => {
    const { id, version } = await startDiary();
    await prisma.dailyLog.update({ where: { id }, data: { summary: "Edited in the office", version: { increment: 1 } } });
    const [result] = await send(engineer, op({ type: "SITE_DIARY_UPDATE_DRAFT", target: { entityType: "DailyLog", entityId: id }, expectedVersion: version, payload: { summary: "Mine" } }));
    expect(result).toMatchObject({ result: "CONFLICT", errorType: "CONFLICT", current: { status: "DRAFT", version: version + 1 } });
    expect((await prisma.dailyLog.findUniqueOrThrow({ where: { id } })).summary).toBe("Edited in the office");
  });

  it("the submission rules still apply: an empty diary is not submitted", async () => {
    const { id, version } = await startDiary();
    const [result] = await send(engineer, op({ type: "SITE_DIARY_SUBMIT", target: { entityType: "DailyLog", entityId: id }, expectedVersion: version }));
    expect(result).toMatchObject({ result: "REJECTED", errorType: "VALIDATION" });
    expect((await prisma.dailyLog.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });

  it("requires the version for an edit", async () => {
    const { id } = await startDiary();
    const [result] = await send(engineer, op({ type: "SITE_DIARY_UPDATE_DRAFT", target: { entityType: "DailyLog", entityId: id }, payload: { summary: "x" } }));
    expect(result).toMatchObject({ result: "REJECTED", code: "VERSION_REQUIRED" });
  });
});

describe("tasks (§45-§48, §76, §81)", () => {
  it("completes a task through its own command and leaves it completed", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: TASK } });
    const [result] = await send(engineer, op({ type: "TASK_ALLOWED_UPDATE", target: { entityType: "Task", entityId: TASK }, expectedVersion: task.version, payload: { command: "complete" } }));
    expect(result).toMatchObject({ result: "APPLIED", serverVersion: task.version + 1 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK } })).status).toBe("COMPLETED");
  });

  it("does not complete a task that changed while the device was offline", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: TASK } });
    await prisma.task.update({ where: { id: TASK }, data: { description: "Scope changed" } });
    const [result] = await send(engineer, op({ type: "TASK_ALLOWED_UPDATE", target: { entityType: "Task", entityId: TASK }, expectedVersion: task.version, payload: { command: "complete" } }));
    expect(result).toMatchObject({ result: "CONFLICT", errorType: "CONFLICT", current: { status: "IN_PROGRESS" } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK } })).status).toBe("IN_PROGRESS");
  });

  it("refuses a command that is not queueable", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: TASK } });
    const [result] = await send(engineer, op({ type: "TASK_ALLOWED_UPDATE", target: { entityType: "Task", entityId: TASK }, expectedVersion: task.version, payload: { command: "archive" } }));
    expect(result).toMatchObject({ result: "REJECTED", errorType: "VALIDATION" });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: TASK } })).status).toBe("IN_PROGRESS");
  });
});

describe("authorisation is checked again at sync time (§57, §58, §100, §148)", () => {
  it("refuses a change the person's role no longer allows, as a permission failure", async () => {
    const [result] = await send(viewer, op({ type: "SITE_DIARY_CREATE", payload: { workDate: WORK_DATE() } }));
    expect(result).toMatchObject({ result: "REJECTED", errorType: "PERMISSION" });
    expect(await prisma.dailyLog.count({ where: { projectId: SITE } })).toBe(0);
  });

  it("refuses a change recorded for another company than the session's", async () => {
    const [result] = await send(engineer, op({ type: "SITE_DIARY_CREATE", claimedCompanyId: COMPANY.b, payload: { workDate: WORK_DATE() } }));
    expect(result).toMatchObject({ result: "REJECTED", errorType: "AUTH", code: "WORKSPACE_MISMATCH" });
  });

  it("treats a project the person was removed from as gone", async () => {
    await prisma.projectMember.updateMany({ where: { projectId: SITE, companyMemberId: "member_engineer" }, data: { status: "INACTIVE" } });
    try {
      const [result] = await send(engineer, op({ type: "SITE_DIARY_CREATE", payload: { workDate: WORK_DATE() } }));
      expect(result).toMatchObject({ result: "REJECTED", errorType: "PERMISSION" });
      await expect(buildProjectPackage(engineer, SITE)).rejects.toBeInstanceOf(AccessError);
    } finally {
      await prisma.projectMember.updateMany({ where: { projectId: SITE, companyMemberId: "member_engineer" }, data: { status: "ACTIVE" } });
    }
  });
});

describe("a batch (§146)", () => {
  it("one bad operation does not stop the others", async () => {
    const good = op({ type: "TASK_COMMENT_CREATE", target: { entityType: "Task", entityId: TASK }, payload: { body: "fine" } });
    const results = await processSyncBatch(engineer, {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      operations: [{ operationId: "op_test09_garbage", type: "NOT_A_TYPE" }, op({ type: "TASK_COMMENT_CREATE", target: { entityType: "Task", entityId: "missing_task" }, payload: { body: "lost" } }), good],
    });
    expect(results.results.map((r) => r.result)).toEqual(["REJECTED", "REJECTED", "APPLIED"]);
    expect(results.results[0]!.errorType).toBe("VALIDATION");
    expect(results.results[1]!.errorType).toBe("PERMISSION");
  });

  it("refuses a client below the minimum protocol without applying anything (§109)", async () => {
    process.env.NESTO_MIN_SYNC_PROTOCOL_VERSION = "1";
    const results = await processSyncBatch(engineer, { protocolVersion: 0, operations: [op({ type: "SITE_DIARY_CREATE", payload: { workDate: WORK_DATE() } })] });
    expect(results.results[0]).toMatchObject({ result: "REJECTED", errorType: "UNSUPPORTED_VERSION" });
    expect(await prisma.dailyLog.count({ where: { projectId: SITE } })).toBe(0);
  });
});

describe("the authorisation snapshot (§56, §62)", () => {
  it("names the person, the workspace and the window, and only the permissions the offline screens use", () => {
    const snapshot = buildAuthorizationSnapshot(engineer, new Date("2026-09-30T10:00:00Z"));
    expect(snapshot.user.userId).toBe(engineer.userId);
    expect(snapshot.workspace.companyId).toBe(engineer.companyId);
    expect(new Date(snapshot.offlineAccessExpiresAt).getTime() - new Date(snapshot.validatedAt).getTime()).toBe(72 * 3_600_000);
    expect(snapshot.permissions.length).toBeGreaterThan(0);
    expect(snapshot.permissions.every((permission) => /^(project|task|collaboration|daily_log|hse|document)\./.test(permission))).toBe(true);
    expect(snapshot.permissions).not.toContain("finance.invoice.view");
  });

  it("the window comes from configuration and is clamped", () => {
    process.env.NESTO_OFFLINE_AUTH_HOURS = "9999";
    expect(new Date(buildAuthorizationSnapshot(engineer, new Date(0)).offlineAccessExpiresAt).getTime()).toBe(336 * 3_600_000);
    delete process.env.NESTO_OFFLINE_AUTH_HOURS;
  });
});

describe("the project package (§9, §71, §72)", () => {
  it("holds what the project page would show this person, and nothing more", async () => {
    const pkg = await buildProjectPackage(engineer, SITE);
    expect(pkg.project.id).toBe(SITE);
    expect(pkg.entities.tasks.upserts.map((entry) => entry.id)).toContain(TASK);
    expect(pkg.authorization.user.userId).toBe(engineer.userId);
  });

  it("answers a refresh with only what changed, and what was removed", async () => {
    const first = await buildProjectPackage(engineer, SITE);
    const known: KnownTokens = Object.fromEntries(Object.entries(first.entities).map(([kind, delta]) => [kind, Object.fromEntries(delta.upserts.map((entry) => [entry.id, entry.token]))]));

    const unchanged = await buildProjectPackage(engineer, SITE, known);
    expect(unchanged.entities.tasks.upserts).toHaveLength(0);
    expect(unchanged.entities.tasks.removed).toHaveLength(0);

    await prisma.task.update({ where: { id: TASK }, data: { title: "Facade Inspection (revised)" } });
    const changed = await buildProjectPackage(engineer, SITE, known);
    expect(changed.entities.tasks.upserts.map((entry) => entry.id)).toEqual([TASK]);

    await prisma.task.update({ where: { id: TASK }, data: { status: "COMPLETED" } });
    const gone = await buildProjectPackage(engineer, SITE, known);
    expect(gone.entities.tasks.removed).toEqual([TASK]);
  });

  it("does not hand another company's project to a person outside it", async () => {
    await expect(buildProjectPackage(engineer, "project_b_01")).rejects.toBeInstanceOf(AccessError);
  });
});

describe("documents (§15-§18)", () => {
  it("reports the current version a document is at, through the ordinary document reads", async () => {
    const document = await prisma.document.findFirst({ where: { companyId: COMPANY.a, projectId: { not: null }, currentVersionId: { not: null }, status: "ACTIVE" }, select: { id: true, projectId: true } });
    if (!document) return;
    const viewerOfProject = await loginAs("OWNER");
    const status = await documentOfflineStatus(viewerOfProject, document.id);
    expect(status.documentId).toBe(document.id);
    expect(status.current?.versionNumber).toBeGreaterThanOrEqual(1);
  });
});
