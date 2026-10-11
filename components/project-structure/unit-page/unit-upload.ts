"use client";

import {
  authoriseUpload,
  completeUploadSession,
  isAlreadyUploaded,
  newUploadKey,
  precheckFile,
  putUploadObject,
  UploadFailure,
} from "@/components/documents/upload-client";

/**
 * A new version of a document the unit already points at (E-05D §36): the
 * Documents module's own three steps — intent, bytes straight to storage, and
 * completion — so a Sales Plan is replaced by a version, never a second file.
 *
 * AUD-09 §8, FV-18: one chosen file is one version. The upload key is kept
 * with the `File` for as long as the page holds it, so a retry after a lost
 * answer resumes the same session — or is told the version already arrived —
 * instead of allocating the next version number for the same bytes. The file
 * is checked against the registry the server enforces before anything is
 * sent; the server checks it again and then reads its bytes.
 *
 * This file has no reader of its own, so the one sentence it would have to
 * write — an upload that ended with no answer — is handed in by the caller, in
 * the reader's language (`incomplete`). The upload client's own messages pass
 * through as they are raised; the caller reads those back with `uploadErrorText`.
 */

const keys = new WeakMap<File, Map<string, { key: string; sessionId: string | null; status: string | null }>>();

function keyFor(file: File, documentId: string) {
  let byDocument = keys.get(file);
  if (!byDocument) keys.set(file, (byDocument = new Map()));
  let entry = byDocument.get(documentId);
  if (!entry) byDocument.set(documentId, (entry = { key: newUploadKey(), sessionId: null, status: null }));
  return entry;
}

type Failure = { status: number; code: string; message: string; details: Record<string, unknown> };

function asFailure(error: unknown, incomplete: string): Failure {
  if (error instanceof UploadFailure) return { status: error.status, code: error.code, message: error.message, details: error.details };
  return { status: 0, code: "UPLOAD_FAILED", message: incomplete, details: {} };
}

export async function uploadNewVersion(documentId: string, file: File, incomplete: string): Promise<{ status: string }> {
  const check = precheckFile(file);
  if (!check.ok) throw { status: 400, code: check.code, message: check.message, details: { file: [check.message] } } satisfies Failure;
  const entry = keyFor(file, documentId);
  if (entry.status) return { status: entry.status };
  try {
    const intent = await authoriseUpload({ kind: "version", documentId, body: { fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size } }, entry.key);
    if (isAlreadyUploaded(intent)) {
      // It arrived; the answer was what was lost. Its state is the document's.
      entry.status = "RECEIVED";
      return { status: "RECEIVED" };
    }
    entry.sessionId = intent.uploadSessionId;
    await putUploadObject(intent.upload, file);
    const done = await completeUploadSession({ kind: "version", documentId, sessionId: intent.uploadSessionId });
    entry.status = done.status;
    return { status: done.status };
  } catch (error) {
    throw asFailure(error, incomplete);
  }
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
