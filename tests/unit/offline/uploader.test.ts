import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authoriseUpload = vi.fn();
const putUploadObject = vi.fn();
const completeUploadSession = vi.fn();

vi.mock("@/components/documents/upload-client", () => {
  class UploadFailure extends Error {
    code: string; stage: string; terminal: boolean; status: number;
    constructor(input: { message: string; code: string; stage: string; terminal?: boolean; status?: number }) {
      super(input.message);
      this.code = input.code; this.stage = input.stage; this.terminal = input.terminal ?? false; this.status = input.status ?? 0;
    }
  }
  return {
    UploadFailure,
    authoriseUpload: (...args: unknown[]) => authoriseUpload(...args),
    putUploadObject: (...args: unknown[]) => putUploadObject(...args),
    completeUploadSession: (...args: unknown[]) => completeUploadSession(...args),
    isAlreadyUploaded: (value: { alreadyCompleted?: boolean }) => Boolean(value.alreadyCompleted),
    newUploadKey: () => `upl_${Math.random().toString(36).slice(2)}`,
  };
});

import { UploadFailure } from "@/components/documents/upload-client";
import { OfflineDatabase } from "@/lib/offline/database";
import { addDiaryPhoto, startDiary } from "@/lib/offline/modules/diary";
import { uploadPendingFile } from "@/lib/offline/uploader";

/** Photo upload recovery (MOB-09 §41, §43, §132): a retry is the same upload, never a second document. */

let db: OfflineDatabase;
let fileId: string;
const evidence = vi.fn();

beforeEach(async () => {
  vi.resetAllMocks();
  db = await OfflineDatabase.openFor("u1", new IDBFactory());
  const target = await startDiary(db, { companyId: "c1", projectId: "p1", workDate: "2026-09-30", projectLabel: "EOT" });
  ({ fileId } = await addDiaryPhoto(db, { targetId: target, companyId: "c1", projectId: "p1", label: "Site Diary", file: new Blob([new Uint8Array([1, 2, 3])]), name: "slab.jpg", mime: "image/jpeg" }));
  evidence.mockResolvedValue(new Response(JSON.stringify({ data: { version: 7 } }), { status: 200 }));
  vi.stubGlobal("fetch", evidence);
  authoriseUpload.mockResolvedValue({ documentId: "doc1", uploadSessionId: "s1", upload: { method: "PUT", url: "https://s", headers: {} } });
  completeUploadSession.mockResolvedValue({ documentId: "doc1", status: "AVAILABLE" });
  putUploadObject.mockResolvedValue(undefined);
});

describe("uploading a captured photo", () => {
  it("authorises, puts the bytes, completes, attaches, and reports the log's new version", async () => {
    const outcome = await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1");
    expect(outcome).toEqual({ ok: true, documentId: "doc1", version: 7 });
    expect(authoriseUpload.mock.calls[0]![0]).toMatchObject({ kind: "new", body: { context: "record", entityType: "daily_log", entityId: "log1", projectId: "p1", fileName: "slab.jpg", sizeBytes: 3 } });
    expect(evidence.mock.calls[0]![0]).toBe("/api/daily-logs/log1/evidence/doc1");
    expect((await db.getFile(fileId))!.record.state).toBe("UPLOADED");
  });

  it("an interrupted upload leaves the photo on the device, and the retry uses the same key", async () => {
    putUploadObject.mockRejectedValueOnce(new UploadFailure({ message: "The connection dropped.", code: "NETWORK", stage: "put" }));
    const first = await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1");
    expect(first).toMatchObject({ ok: false, errorType: "NETWORK" });
    expect(await db.getFile(fileId)).not.toBeNull();

    const second = await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1");
    expect(second.ok).toBe(true);
    const keys = authoriseUpload.mock.calls.map((call) => call[1]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("when the server already finished it, the retry does not send the bytes again", async () => {
    authoriseUpload.mockResolvedValueOnce({ alreadyCompleted: true, documentId: "doc1", uploadSessionId: null });
    const outcome = await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1");
    expect(outcome.ok).toBe(true);
    expect(putUploadObject).not.toHaveBeenCalled();
  });

  it("once the document exists, a failure to attach only repeats the attach", async () => {
    evidence.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    const first = await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1");
    expect(first).toMatchObject({ ok: false, errorType: "SERVER_TEMPORARY" });
    const second = await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1");
    expect(second.ok).toBe(true);
    expect(authoriseUpload).toHaveBeenCalledTimes(1);
    expect(putUploadObject).toHaveBeenCalledTimes(1);
  });

  it("classifies a refused file as a file problem and keeps the photo", async () => {
    authoriseUpload.mockRejectedValueOnce(new UploadFailure({ message: "That file is larger than the upload limit.", code: "FILE_TOO_LARGE", stage: "authorise", terminal: true, status: 422 }));
    expect(await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1")).toMatchObject({ ok: false, errorType: "FILE_ERROR", code: "FILE_TOO_LARGE" });
    expect(await db.getFile(fileId)).not.toBeNull();
  });

  it("a permission change is a permission failure, not something to retry", async () => {
    evidence.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "gone" } }), { status: 404 }));
    expect(await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1")).toMatchObject({ ok: false, errorType: "PERMISSION" });
  });

  it("reports a photo that is no longer on the device", async () => {
    await db.removeFile(fileId);
    expect(await uploadPendingFile(db, fileId, { kind: "daily_log", dailyLogId: "log1" }, "p1")).toMatchObject({ ok: false, errorType: "FILE_ERROR", code: "FILE_MISSING" });
  });
});
