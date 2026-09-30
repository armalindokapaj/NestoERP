import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineDatabase } from "@/lib/offline/database";
import { SyncEngine } from "@/lib/offline/engine";
import { describeQueue, discard, recoverInterrupted, unsyncedCount } from "@/lib/offline/queue";
import { addDiaryEntry, addDiaryPhoto, saveDiaryFields, startDiary, submitDiary, composeDiaries } from "@/lib/offline/modules/diary";
import { queueTaskCommand, queueTaskComment, type OfflineTask } from "@/lib/offline/modules/tasks";
import type { UploadOutcome } from "@/lib/offline/uploader";

import { FakeServer } from "./fake-server";

/** The sync engine end to end against a server stand-in (MOB-09 §150-§157). */

let db: OfflineDatabase;
let server: FakeServer;
let clock: number;
const uploads: Array<{ fileId: string; dailyLogId: string }> = [];
let uploadResult: (() => Promise<UploadOutcome>) | null = null;

const engine = () =>
  new SyncEngine({
    db,
    now: () => clock,
    fetchImpl: server.fetch as typeof fetch,
    uploader: async (database, fileId, target) => {
      uploads.push({ fileId, dailyLogId: target.dailyLogId });
      if (uploadResult) return uploadResult();
      const diary = server.diaries.get(target.dailyLogId);
      if (!diary) return { ok: false, errorType: "PERMISSION", code: "NOT_FOUND", message: "gone" };
      diary.photos += 1;
      diary.version += 1;
      await database.removeFile(fileId).catch(() => undefined);
      return { ok: true, documentId: `doc${diary.photos}`, version: diary.version };
    },
  });

beforeEach(async () => {
  db = await OfflineDatabase.openFor("u1", new IDBFactory());
  server = new FakeServer();
  clock = 1_000_000;
  uploads.length = 0;
  uploadResult = null;
});

const base = { companyId: "c1", projectId: "p1" };
const ctx = { ...base, label: "Site Diary" };
const task = (over: Partial<OfflineTask> = {}): OfflineTask => ({ id: "t1", title: "Facade Inspection", status: "IN_PROGRESS", version: 4, assignee: null, dueDate: null, project: { id: "p1", name: "Eyes of Tirana", code: "EOT" }, priority: "MEDIUM", ...over });

async function buildFieldDay(): Promise<string> {
  const target = await startDiary(db, { ...base, workDate: "2026-09-30", projectLabel: "Eyes of Tirana" });
  await saveDiaryFields(db, { targetId: target, ...base, label: "Site Diary", fields: { summary: "Slab poured" } });
  await addDiaryEntry(db, { targetId: target, ...ctx, section: "activities", entry: { title: "Pour" } });
  await addDiaryPhoto(db, { targetId: target, ...ctx, file: new Blob([new Uint8Array([1, 2, 3])]), name: "a.jpg", mime: "image/jpeg" });
  await submitDiary(db, { targetId: target, ...base, label: "Site Diary" });
  return target;
}

describe("a full field day", () => {
  it("syncs a diary with notes, a row, a photo and a submission, in order, with no duplicates", async () => {
    const target = await buildFieldDay();
    const comment = await queueTaskComment(db, { task: task(), companyId: "c1", body: "Updated the drawing." });
    expect(comment).toBeTruthy();
    expect((await describeQueue(db)).total).toBe(6);

    const report = await engine().runOnce();

    expect(report.status).toBe("idle");
    expect(server.diaries.size).toBe(1);
    const diary = [...server.diaries.values()][0]!;
    expect(diary.status).toBe("SUBMITTED");
    expect(diary.entries).toBe(1);
    expect(diary.photos).toBe(1);
    expect(server.comments).toEqual(["Updated the drawing."]);
    expect(await unsyncedCount(db)).toBe(0);
    // The photo was sent to the canonical log, not the local id.
    expect(uploads[0]!.dailyLogId).toBe(diary.id);
    expect((await db.getEntity(target))?.serverId).toBe(diary.id);
  });

  it("never sends a change before what it depends on", async () => {
    await buildFieldDay();
    await engine().runOnce();
    const order = server.sync.flat().map((op) => op.type);
    expect(order.indexOf("SITE_DIARY_CREATE")).toBeLessThan(order.indexOf("SITE_DIARY_UPDATE_DRAFT"));
    expect(order.indexOf("SITE_DIARY_UPDATE_DRAFT")).toBeLessThan(order.indexOf("SITE_DIARY_SUBMIT"));
  });

  it("says the submission is queued, not submitted, while it waits", async () => {
    const target = await buildFieldDay();
    const [view] = await composeDiaries(db, "p1");
    expect(view!.targetId).toBe(target);
    expect(view!.localOnly).toBe(true);
    expect(view!.syncState).toBe("LOCAL_ONLY");
    expect(view!.submission.queued).toBe(true);
    expect(view!.photos).toHaveLength(1);
  });
});

describe("duplicate protection", () => {
  it("a lost response followed by a retry leaves exactly one record", async () => {
    await startDiary(db, { ...base, workDate: "2026-09-30", projectLabel: "EOT" });
    await queueTaskComment(db, { task: task(), companyId: "c1", body: "Once only" });
    server.dropNextResponse = true;

    const first = await engine().runOnce();
    expect(first.status).toBe("offline");
    // The server committed both; the device does not know.
    expect(server.comments).toEqual(["Once only"]);
    expect(await unsyncedCount(db)).toBe(2);

    clock += 10 * 60_000;
    await engine().runOnce();

    expect(server.comments).toEqual(["Once only"]);
    expect(server.diaries.size).toBe(1);
    expect(await unsyncedCount(db)).toBe(0);
  });

  it("sends a change under the same operation id every time", async () => {
    const id = await queueTaskComment(db, { task: task(), companyId: "c1", body: "x" });
    server.dropNextResponse = true;
    await engine().runOnce();
    clock += 10 * 60_000;
    await engine().runOnce();
    const ids = server.sync.flat().map((op) => op.operationId);
    expect(new Set(ids)).toEqual(new Set([id]));
  });
});

describe("conflicts", () => {
  it("does not overwrite the server: Complete against a task that moved goes to review", async () => {
    server.tasks.set("t1", { id: "t1", version: 6, status: "ARCHIVED" });
    await queueTaskCommand(db, { task: task({ version: 4 }), command: "complete", companyId: "c1", permissions: ["task.complete"] });

    const report = await engine().runOnce();

    expect(report.conflicts).toBe(1);
    expect(server.tasks.get("t1")).toEqual({ id: "t1", version: 6, status: "ARCHIVED" });
    const queue = await describeQueue(db);
    expect(queue.needsReview).toBe(1);
    expect(queue.items[0]!.current).toEqual({ status: "ARCHIVED", version: 6 });
    expect(queue.items[0]!.errorType).toBe("CONFLICT");
  });

  it("holds later changes behind a conflicted one instead of sending them", async () => {
    server.tasks.set("t1", { id: "t1", version: 6, status: "TODO" });
    await queueTaskCommand(db, { task: task({ status: "TODO", version: 4 }), command: "start", companyId: "c1", permissions: ["task.status.update", "task.complete"] });
    await engine().runOnce();
    await queueTaskCommand(db, { task: task({ status: "TODO", version: 4 }), command: "complete", companyId: "c1", permissions: ["task.complete"] });
    await engine().runOnce();
    // Both were refused; nothing slipped through.
    expect(server.tasks.get("t1")!.version).toBe(6);
  });

  it("does not send a diary edit when someone else changed the log in between", async () => {
    // A server draft the device downloaded at version 3.
    const diary = { id: "log9", version: 3, status: "DRAFT" as const, workDate: "2026-09-29", entries: 0, photos: 0 };
    server.diaries.set("log9", diary);
    await db.putCache({ ...base, kind: "dailyLogDrafts", id: "log9", token: "t", syncState: "SYNCED", lastSyncedAt: 1 }, { id: "log9", version: 3, status: "DRAFT", workDate: "2026-09-29" });
    await addDiaryEntry(db, { targetId: "log9", ...ctx, section: "activities", entry: { title: "Mine" } });
    await saveDiaryFields(db, { targetId: "log9", ...base, label: "Site Diary", fields: { summary: "Mine" } });
    // Office staff edit it while the device is offline (version 3 -> 4), then our row lands (-> 5).
    diary.version = 4;

    await engine().runOnce();

    expect(diary.entries).toBe(1);
    const queue = await describeQueue(db);
    expect(queue.needsReview).toBe(1);
    expect(diary.version).toBe(5);
  });
});

describe("failures", () => {
  it("keeps a permission refusal visible and stops retrying it", async () => {
    const id = await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    server.refuse.set(id, { errorType: "PERMISSION", code: "FORBIDDEN", message: "Permission changed" });
    await engine().runOnce();
    clock += 60 * 60_000;
    await engine().runOnce();

    const queue = await describeQueue(db);
    expect(queue.failed).toBe(1);
    expect(queue.items[0]!.message).toBe("Permission changed");
    expect(queue.items[0]!.errorType).toBe("PERMISSION");
    expect(server.sync.flat().filter((op) => op.operationId === id)).toHaveLength(1);
  });

  it("retries a temporary server failure with growing delay, then asks for attention", async () => {
    const id = await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    server.refuse.set(id, { result: "RETRY", errorType: "SERVER_TEMPORARY", code: "INTERNAL_ERROR", message: "busy" } as never);
    // The fake maps refusals to REJECTED; use the ledger-free path with a temporary failure instead.
    server.refuse.delete(id);
    const original = server.fetch;
    let calls = 0;
    server.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/api/sync")) {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { operations: Array<{ operationId: string }> };
        return new Response(JSON.stringify({ data: { protocolVersion: 1, serverTime: "", results: body.operations.map((op) => ({ operationId: op.operationId, result: "RETRY", errorType: "SERVER_TEMPORARY", code: "INTERNAL_ERROR", message: "busy" })) } }), { status: 200 });
      }
      return original(url, init);
    }) as typeof server.fetch;

    const delays: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      await engine().runOnce();
      const item = (await describeQueue(db)).items[0]!;
      if (item.state === "FAILED") break;
      const record = (await db.listMutationRecords())[0]!;
      delays.push(record.nextAttemptAt - clock);
      clock = record.nextAttemptAt + 1;
    }

    const item = (await describeQueue(db)).items[0]!;
    expect(item.state).toBe("FAILED");
    expect(item.errorType).toBe("SERVER_TEMPORARY");
    expect(delays[2]!).toBeGreaterThan(delays[0]!);
    expect(calls).toBeLessThanOrEqual(10);
  });

  it("does not hammer the server before the backoff has passed", async () => {
    await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    server.dropNextResponse = true;
    await engine().runOnce();
    const before = server.sync.length;
    await engine().runOnce();
    expect(server.sync.length).toBe(before);
  });

  it("a failed photo is retryable on its own and does not hide the other photos", async () => {
    const target = await startDiary(db, { ...base, workDate: "2026-09-30", projectLabel: "EOT" });
    await addDiaryPhoto(db, { targetId: target, ...ctx, file: new Blob([new Uint8Array([1])]), name: "a.jpg", mime: "image/jpeg" });
    await addDiaryPhoto(db, { targetId: target, ...ctx, file: new Blob([new Uint8Array([2])]), name: "b.jpg", mime: "image/jpeg" });
    let n = 0;
    uploadResult = async () => {
      n += 1;
      return n === 1 ? { ok: false, errorType: "FILE_ERROR", code: "FILE_TOO_LARGE", message: "Too large" } : { ok: true, documentId: "doc", version: 5 };
    };
    await engine().runOnce();
    const queue = await describeQueue(db);
    expect(queue.failed).toBe(1);
    // Exactly one photo needs attention; the other was delivered and is gone from the queue.
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]!.state).toBe("FAILED");
    expect(queue.items[0]!.errorType).toBe("FILE_ERROR");
    expect(queue.items[0]!.message).toBe("Too large");
  });
});

describe("the session and the person", () => {
  it("pauses, keeping everything, when the session has ended", async () => {
    await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    server.sessionStatus = 401;
    const report = await engine().runOnce();
    expect(report.status).toBe("paused-auth");
    expect(await unsyncedCount(db)).toBe(1);
    expect(server.sync).toHaveLength(0);
  });

  it("never sends one person's work as another", async () => {
    await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    server.userId = "someone-else";
    const report = await engine().runOnce();
    expect(report.status).toBe("identity-mismatch");
    expect(server.sync).toHaveLength(0);
    expect(server.comments).toEqual([]);
  });

  it("does not replay with a client the server no longer supports", async () => {
    await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    server.minimumProtocolVersion = 2;
    const report = await engine().runOnce();
    expect(report.status).toBe("paused-update");
    expect(server.sync).toHaveLength(0);
  });

  it("keeps a change made for another company until that company is the workspace", async () => {
    await queueTaskComment(db, { task: task(), companyId: "c2", body: "other company" });
    await engine().runOnce();
    expect(server.comments).toEqual([]);
    expect(await unsyncedCount(db)).toBe(1);
    server.companyId = "c2";
    await engine().runOnce();
    expect(server.comments).toEqual(["other company"]);
  });

  it("does not send anything while the workspace is the Group", async () => {
    await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    server.scope = "GROUP";
    await engine().runOnce();
    expect(server.sync).toHaveLength(0);
  });
});

describe("the app closing mid-send", () => {
  it("puts a change that was being sent back in the queue", async () => {
    const id = await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    await db.patchMutation(id, { state: "SYNCING" });
    expect(await recoverInterrupted(db)).toBe(1);
    await engine().runOnce();
    expect(server.comments).toEqual(["hello"]);
  });

  it("shares one pass between two triggers", async () => {
    await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    const e = engine();
    await Promise.all([e.runOnce(), e.runOnce(), e.runOnce()]);
    expect(server.comments).toEqual(["hello"]);
  });
});

describe("discarding", () => {
  it("removes the change and everything waiting on it, including photo bytes", async () => {
    const target = await buildFieldDay();
    const create = (await db.listMutations()).find(({ record }) => record.type === "SITE_DIARY_CREATE")!;
    const removed = await discard(db, create.record.id);
    expect(removed.length).toBeGreaterThan(1);
    expect(await unsyncedCount(db)).toBe(0);
    expect(await db.listFiles()).toHaveLength(0);
    void target;
  });

  it("refuses to discard a change that is being sent", async () => {
    const id = await queueTaskComment(db, { task: task(), companyId: "c1", body: "hello" });
    await db.patchMutation(id, { state: "SYNCING" });
    await expect(discard(db, id)).rejects.toThrow(/being sent/);
  });
});

describe("what needs a connection", () => {
  it("refuses to queue a claim, and says why", async () => {
    await expect(queueTaskCommand(db, { task: task({ status: "TODO" }), command: "claim" as never, companyId: "c1", permissions: [] })).rejects.toThrow("Connect to the internet to claim this task.");
  });

  it("queues Start once however many times it is tapped", async () => {
    const a = await queueTaskCommand(db, { task: task({ status: "TODO" }), command: "start", companyId: "c1", permissions: ["task.status.update"] });
    const b = await queueTaskCommand(db, { task: task({ status: "TODO" }), command: "start", companyId: "c1", permissions: ["task.status.update"] });
    expect(a).toBe(b);
  });
});

vi.setConfig({ testTimeout: 20_000 });
