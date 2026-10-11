"use client";

import * as React from "react";

import { uploadErrorText, useDocumentsTranslations } from "@/components/documents/documents-text";
import type { ApiFailure } from "@/components/engineering/engineering-api";
import { useHrTranslations } from "@/components/hr/hr-text";
import {
  authoriseUpload,
  completeUploadSession,
  isAlreadyUploaded,
  newUploadKey,
  precheckFile,
  putUploadObject,
  settleUpload,
  UploadFailure,
} from "@/components/documents/upload-client";

/**
 * Putting a file on an employee's record (E-02 §54, §117): the Documents
 * module's own three steps — authorise, bytes straight to storage, completion —
 * with the employment as the file's parent. There is no employee file store of
 * its own. The promise settles once the server says the file is checked and
 * available, because only then can it be filed (§197).
 *
 * AUD-09 §8, FV-18: the dialogs that call this upload first and file second,
 * so a filing refused for a wrong date used to leave the file uploaded and the
 * next "Add document" upload it again — under the same idempotency key, which
 * the server then refused with a 500. Now one chosen file is one upload for as
 * long as the page holds it: a second submit of the same `File` for the same
 * employment resumes (or simply returns) the first upload's document, and only
 * a file that was never uploaded goes over the wire again. Choosing another
 * file is a new upload. The already-uploaded file waits on the employee's
 * record as unfiled until it is filed — the documented recoverable ownership
 * of E-02 §197 — and nothing here deletes it.
 */

/**
 * What an upload can say, in the reader's language: its own two sentences, and a
 * way to read the upload client's English messages back (`uploadErrorText`).
 */
export type FileWords = { incomplete: string; pending: string; read: (message: string) => string };

export function useFileWords(): FileWords {
  const t = useHrTranslations();
  const tDocuments = useDocumentsTranslations();
  return React.useMemo(
    () => ({ incomplete: t("employeeDocs.uploadFailed"), pending: t("employeeDocs.stillChecking"), read: (message) => uploadErrorText(tDocuments, message) }),
    [t, tDocuments],
  );
}

type Upload = { key: string; documentId: string | null; sessionId: string | null; done: boolean };

/** Per chosen file, per employment: the upload it is (FV-18). */
const uploads = new WeakMap<File, Map<string, Upload>>();

function uploadFor(file: File, scope: string): Upload {
  let byScope = uploads.get(file);
  if (!byScope) uploads.set(file, (byScope = new Map()));
  let upload = byScope.get(scope);
  if (!upload) byScope.set(scope, (upload = { key: newUploadKey(), documentId: null, sessionId: null, done: false }));
  return upload;
}

/** A failure's messages, and the ones it lists per field, read back in the reader's language. */
function readFailure(failure: ApiFailure, words: FileWords): ApiFailure {
  const details = Object.fromEntries(
    Object.entries(failure.details ?? {}).map(([field, value]) => [field, Array.isArray(value) ? value.map((item) => (typeof item === "string" ? words.read(item) : item)) : value]),
  );
  const fields = failure.fields ? Object.fromEntries(Object.entries(failure.fields).map(([field, message]) => [field, words.read(message)])) : undefined;
  const fieldErrors = failure.fieldErrors ? Object.fromEntries(Object.entries(failure.fieldErrors).map(([field, list]) => [field, list.map(words.read)])) : undefined;
  return { ...failure, message: words.read(failure.message), details, ...(fields ? { fields } : {}), ...(fieldErrors ? { fieldErrors } : {}) };
}

function asApiFailure(error: unknown, words: FileWords): ApiFailure {
  if (error instanceof UploadFailure) return readFailure({ status: error.status, code: error.code, message: error.message, details: error.details }, words);
  if (error && typeof error === "object" && "code" in error && "message" in error) return readFailure(error as ApiFailure, words);
  return { status: 0, code: "UPLOAD_FAILED", message: words.incomplete, details: {} };
}

/** Waits for the scan to settle, a minute and a half at most, then gives the file back to the maintenance worker (§197). */
async function settled(documentId: string, words: FileWords): Promise<void> {
  const verdict = await settleUpload(documentId, { windowMs: 90_000 });
  if (verdict.state === "ready") return;
  if (verdict.state === "rejected") throw { status: 0, code: "FILE_REJECTED", message: verdict.message, details: { file: [verdict.message] } } satisfies ApiFailure;
  // Not ready is not refused: the file stays unfiled on the record, and the
  // next submit of this form picks up where this one stopped.
  throw {
    status: 0,
    code: "FILE_PENDING",
    message: words.pending,
    details: {},
  } satisfies ApiFailure;
}

/**
 * The advisory check before any request, from the registry the server
 * enforces (AUD-09 §8). Throws the form's usual failure shape, keyed on
 * `file`, so the dialog shows it beside the file input.
 */
export function checkEmployeeFile(file: File, words: FileWords): void {
  const check = precheckFile(file);
  if (!check.ok) throw { status: 400, code: check.code, message: words.read(check.message), details: { file: [words.read(check.message)] } } satisfies ApiFailure;
}

/** Uploads a file onto an employment and resolves with its canonical document id once it is available. */
export async function uploadToEmployment(employmentId: string, file: File, name: string, words: FileWords): Promise<string> {
  const upload = uploadFor(file, `employment:${employmentId}`);
  if (upload.done && upload.documentId) return upload.documentId;
  checkEmployeeFile(file, words);
  try {
    if (!upload.documentId) {
      const grant = await authoriseUpload(
        {
          kind: "new",
          body: { context: "record", entityType: "employee", entityId: employmentId, name, fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size },
        },
        upload.key,
      );
      if (isAlreadyUploaded(grant)) {
        upload.documentId = grant.documentId;
        upload.sessionId = grant.uploadSessionId;
      } else {
        upload.documentId = grant.documentId;
        upload.sessionId = grant.uploadSessionId;
        await putUploadObject(grant.upload, file);
        const done = await completeUploadSession({ kind: "new", sessionId: grant.uploadSessionId });
        if (done.status === "AVAILABLE") {
          upload.done = true;
          return grant.documentId;
        }
      }
    } else if (upload.sessionId) {
      // A retry after the completion's answer was lost: ask, do not resend.
      const done = await completeUploadSession({ kind: "new", sessionId: upload.sessionId }).catch((error: unknown) => {
        if (error instanceof UploadFailure && error.code === "STORAGE_OBJECT_MISSING") {
          // Nothing arrived: start over under the same key (same session).
          upload.documentId = null;
          upload.sessionId = null;
          return null;
        }
        throw error;
      });
      if (!done) return uploadToEmployment(employmentId, file, name, words);
      if (done.status === "AVAILABLE") {
        upload.done = true;
        return upload.documentId;
      }
    }
    await settled(upload.documentId!, words);
    upload.done = true;
    return upload.documentId!;
  } catch (error) {
    const failure = asApiFailure(error, words);
    // Refused for good: the next submit of the same file must not replay it.
    if (["FILE_REJECTED", "FILE_TYPE_NOT_ALLOWED", "FILE_TYPE_MISMATCH", "FILE_TOO_LARGE", "UPLOAD_KEY_REUSED", "UPLOAD_ABORTED", "UPLOAD_SESSION_EXPIRED"].includes(failure.code)) {
      uploads.get(file)?.delete(`employment:${employmentId}`);
    }
    throw failure;
  }
}

/** A new version of a file already filed (§61): the same logical document, never a second one (§189). */
export async function uploadNewVersion(documentId: string, file: File, words: FileWords): Promise<void> {
  checkEmployeeFile(file, words);
  // One chosen file, one version: a retry after a lost answer is not version N+1.
  const upload = uploadFor(file, `version:${documentId}`);
  if (upload.done) return;
  try {
    const intent = await authoriseUpload({ kind: "version", documentId, body: { fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size } }, upload.key);
    if (!isAlreadyUploaded(intent)) {
      await putUploadObject(intent.upload, file);
      await completeUploadSession({ kind: "version", documentId, sessionId: intent.uploadSessionId });
    }
    upload.done = true;
  } catch (error) {
    throw asApiFailure(error, words);
  }
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
