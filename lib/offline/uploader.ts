import {
  authoriseUpload,
  completeUploadSession,
  isAlreadyUploaded,
  putUploadObject,
  UploadFailure,
} from "@/components/documents/upload-client";

import type { OfflineDatabase } from "./database";

/**
 * Sends one pending photo through the ordinary upload flow (MOB-09 §40-§43).
 *
 * Authorise → put the bytes → complete → attach to the record. The file keeps
 * the one upload key it was given when it was captured, so a retry — after a
 * dropped connection, a killed app, a response that never arrived — is the
 * same upload, and the server answers with the document it already made.
 * The upload is a single PUT (resumable upload is not built): an interrupted
 * one starts again, safely (§43).
 */

export type UploadOutcome =
  | { ok: true; documentId: string; version?: number }
  | { ok: false; errorType: "NETWORK" | "FILE_ERROR" | "PERMISSION" | "SERVER_TEMPORARY" | "AUTH"; code: string; message: string };

export type UploadTarget = { kind: "daily_log"; dailyLogId: string };

export async function uploadPendingFile(db: OfflineDatabase, fileId: string, target: UploadTarget, projectId: string): Promise<UploadOutcome> {
  const stored = await db.getFile(fileId);
  if (!stored) return { ok: false, errorType: "FILE_ERROR", code: "FILE_MISSING", message: "This photo is no longer on the device." };
  const { record, body } = stored;
  const file = new File([stored.bytes], body.name, { type: body.mime });
  await db.patchFile(fileId, { state: "UPLOADING", progress: 0 });

  try {
    let documentId = body.documentId;
    if (!documentId) {
      const grant = await authoriseUpload(
        {
          kind: "new",
          body: { context: "record", entityType: "daily_log", entityId: target.dailyLogId, projectId, name: body.name.replace(/\.[^.]+$/, "") || "Site photo", fileName: body.name, mimeType: body.mime, sizeBytes: file.size },
        },
        record.uploadKey,
      );
      if (isAlreadyUploaded(grant)) {
        documentId = grant.documentId;
      } else {
        await putUploadObject(grant.upload, file, { onProgress: (progress) => void db.patchFile(fileId, { progress }) });
        const completed = await completeUploadSession({ kind: "new", sessionId: grant.uploadSessionId });
        documentId = completed.documentId;
      }
      await db.patchFile(fileId, { progress: 100 }, { documentId });
    }

    // How the file sits in the day's evidence. Repeating it is harmless: it sets the same values.
    const response = await fetch(`/api/daily-logs/${target.dailyLogId}/evidence/${documentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: body.category, caption: body.caption, takenTime: body.takenTime }),
    });
    if (!response.ok) return fromStatus(response.status, await response.json().catch(() => null));
    const answer = (await response.json().catch(() => null)) as { data?: { version?: number }; version?: number } | null;
    await db.patchFile(fileId, { state: "UPLOADED", progress: 100 });
    return { ok: true, documentId, version: answer?.data?.version ?? answer?.version };
  } catch (error) {
    if (error instanceof UploadFailure) return fromFailure(error);
    return { ok: false, errorType: "NETWORK", code: "NETWORK", message: "The connection dropped." };
  }
}

function fromFailure(error: UploadFailure): UploadOutcome {
  if (error.code === "NETWORK" || error.status === 0) return { ok: false, errorType: "NETWORK", code: "NETWORK", message: error.message };
  if (error.status === 401) return { ok: false, errorType: "AUTH", code: error.code, message: error.message };
  if (error.status === 403 || error.status === 404) return { ok: false, errorType: "PERMISSION", code: error.code, message: error.message };
  if (error.terminal) return { ok: false, errorType: "FILE_ERROR", code: error.code, message: error.message };
  return { ok: false, errorType: "SERVER_TEMPORARY", code: error.code, message: error.message };
}

function fromStatus(status: number, body: unknown): UploadOutcome {
  const error = (body as { error?: { code?: string; message?: string; details?: { code?: string } } } | null)?.error;
  const code = error?.details?.code ?? error?.code ?? `HTTP_${status}`;
  const message = error?.message ?? "The photo could not be attached.";
  if (status === 401) return { ok: false, errorType: "AUTH", code, message };
  if (status === 403 || status === 404) return { ok: false, errorType: "PERMISSION", code, message };
  if (status === 409 || status === 422) return { ok: false, errorType: "FILE_ERROR", code, message };
  return { ok: false, errorType: "SERVER_TEMPORARY", code, message };
}
