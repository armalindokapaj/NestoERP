"use client";

import {
  assertDeclaredFileAllowed,
  checkFileName,
  DEFAULT_MAX_FILE_BYTES,
  FILE_TYPES,
  StorageError,
} from "@/lib/core/storage";

/**
 * The browser half of the Documents upload pipeline, in one place
 * (PRD #29 §9, §119-§121; AUD-09 §8, FV-18, FV-19).
 *
 * Every upload control in the product — the Documents uploader and its queue,
 * the employee-file and qualification adapters, a unit's Sales Plan and media,
 * a document's new version — goes through the same three steps: authorise,
 * put the bytes straight at storage, ask the server to verify. Before AUD-09
 * each adapter carried its own copy of the steps, and the copies disagreed on
 * what a retry meant. They now share these, and one rule:
 *
 *   One chosen file is one upload key (`newUploadKey`), kept for every retry
 *   of that file. The server answers a retry under the key with the same open
 *   session, or with UPLOAD_ALREADY_COMPLETED and the document it already made
 *   — never a second document, never a second version number.
 *
 * What the browser checks before a byte moves is advisory and comes from the
 * *same* registry and ceiling the server enforces (`lib/core/storage`), never a
 * second list: an unsupported file is refused with the server's own sentence,
 * and the server still checks everything again, and then reads the bytes.
 */

/* -------------------------------------------------------------------------- */
/* What is accepted, before selection                                          */
/* -------------------------------------------------------------------------- */

/** The registry groups a control accepts; all of them unless narrowed. */
export type UploadGroups = readonly string[] | undefined;

function typesFor(groups: UploadGroups) {
  return groups ? FILE_TYPES.filter((type) => groups.includes(type.key)) : FILE_TYPES;
}

/** The `accept` attribute for a file input, from the registry the server enforces. */
export function uploadAccept(groups?: UploadGroups): string {
  return typesFor(groups)
    .flatMap((type) => type.extensions.map((extension) => `.${extension}`))
    .join(",");
}

/** "PDF, Image (JPG, JPEG, PNG, WEBP), …" — what a person reads before choosing. */
export function acceptedTypesText(groups?: UploadGroups): string {
  return typesFor(groups)
    .map((type) =>
      type.extensions.length === 1 && type.extensions[0].toUpperCase() === type.label.toUpperCase()
        ? type.label
        : `${type.label} (${type.extensions.map((extension) => extension.toUpperCase()).join(", ")})`,
    )
    .join(", ");
}

/** Whole megabytes, as the server's own refusal words them. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/** The product ceiling, the one the server applies when a company has no stricter row. */
export const DEFAULT_UPLOAD_MAX_BYTES = DEFAULT_MAX_FILE_BYTES;

export type PrecheckResult = { ok: true } | { ok: false; code: string; message: string };

/**
 * The server's declared-file check, run in the browser first (AUD-09 §8).
 *
 * `checkFileName` and `assertDeclaredFileAllowed` are what `createUploadSession` calls, so
 * the refusal is word for word the one the server would give — only sooner,
 * and without opening a session. Advisory: a company ceiling below the default
 * is still the server's to apply, and the bytes are still read after upload.
 */
export function precheckFile(file: File, options: { maxBytes?: number; groups?: UploadGroups } = {}): PrecheckResult {
  // The name first, as the server checks it first (`checkFileName`).
  const name = checkFileName(file.name);
  if (!name.ok) return { ok: false, code: "INVALID_FILE_NAME", message: name.reason };
  try {
    const type = assertDeclaredFileAllowed({
      fileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      maxBytes: options.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES,
    });
    if (options.groups && !options.groups.includes(type.key)) {
      return { ok: false, code: "FILE_TYPE_NOT_ALLOWED", message: `Choose ${acceptedTypesText(options.groups)}.` };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof StorageError) return { ok: false, code: error.storageCode, message: error.message };
    return { ok: false, code: "FILE_TYPE_NOT_ALLOWED", message: "That file cannot be uploaded." };
  }
}

/* -------------------------------------------------------------------------- */
/* Keys and failures                                                           */
/* -------------------------------------------------------------------------- */

/** One chosen file, one key, for all of its retries (PRD #29 §261; AUD-09 FV-18). */
export function newUploadKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `upl_${crypto.randomUUID()}`;
  return `upl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Where in the three steps a failure happened, so a retry resumes there. */
export type UploadStage = "check" | "authorise" | "put" | "complete" | "settle";

/**
 * A failure the queue can reason about.
 *
 * `terminal` means another attempt at the same file cannot help (a refused
 * type, a rejected scan); `uncertain` means the request may have landed — the
 * next step is to ask, not to repeat (AUD-03 §6, AUD-09 §6).
 */
export class UploadFailure extends Error {
  readonly code: string;
  readonly stage: UploadStage;
  readonly terminal: boolean;
  readonly uncertain: boolean;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(input: { message: string; code: string; stage: UploadStage; terminal?: boolean; uncertain?: boolean; status?: number; details?: Record<string, unknown> }) {
    super(input.message);
    this.name = "UploadFailure";
    this.code = input.code;
    this.stage = input.stage;
    this.terminal = input.terminal ?? false;
    this.uncertain = input.uncertain ?? false;
    this.status = input.status ?? 0;
    this.details = input.details ?? {};
  }
}

/** Codes for which another attempt at the same file cannot help (PRD #29 §335). */
const TERMINAL_CODES = new Set([
  "FILE_TOO_LARGE",
  "FILE_TYPE_NOT_ALLOWED",
  "FILE_TYPE_MISMATCH",
  "INVALID_FILE_NAME",
  "INVALID_FILE_SIZE",
  "STORAGE_QUOTA_EXCEEDED",
  "FILE_REJECTED_MALWARE",
  "CHECKSUM_MISMATCH",
  "UPLOAD_ABORTED",
  "UPLOAD_KEY_REUSED",
  "ENGINEERING_FILE_FROZEN",
]);

type ErrorBody = { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;

async function failureFrom(response: Response, stage: UploadStage, fallback: string): Promise<UploadFailure> {
  const body = (await response.json().catch(() => null)) as ErrorBody;
  const details = body?.error?.details ?? {};
  const code = typeof details.code === "string" ? details.code : (body?.error?.code ?? "UPLOAD_FAILED");
  return new UploadFailure({
    message: body?.error?.message ?? fallback,
    code,
    stage,
    status: response.status,
    details,
    terminal: TERMINAL_CODES.has(code) || response.status === 403 || response.status === 404,
    // A server error on a write may have committed (AUD-03 §6).
    uncertain: response.status >= 500,
  });
}

function offline(stage: UploadStage, uncertain: boolean): UploadFailure {
  return new UploadFailure({ message: "The connection dropped. Check it, then retry this file.", code: "NETWORK", stage, uncertain });
}

/* -------------------------------------------------------------------------- */
/* The three steps                                                             */
/* -------------------------------------------------------------------------- */

export type UploadGrant = {
  documentId: string;
  uploadSessionId: string;
  upload: { method: "PUT"; url: string; headers: Record<string, string>; expiresAt?: string };
};

/** What the server said when the key's upload had already finished. */
export type AlreadyUploaded = { alreadyCompleted: true; documentId: string; uploadSessionId: string | null };

export type AuthoriseTarget =
  | { kind: "new"; body: Record<string, unknown> }
  | { kind: "version"; documentId: string; body: Record<string, unknown> };

/**
 * Step 1: authorise (PRD #29 §75). A retry under the same key is the same
 * session with a fresh URL, or — when that upload already finished — the
 * document it made (AUD-09 FV-18).
 */
export async function authoriseUpload(target: AuthoriseTarget, key: string): Promise<UploadGrant | AlreadyUploaded> {
  const url = target.kind === "new" ? "/api/documents/uploads" : `/api/documents/${target.documentId}/versions/upload-intent`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(target.body),
    });
  } catch {
    // Harmless to repeat: the key makes a second authorisation the first.
    throw offline("authorise", false);
  }
  if (response.ok) {
    const grant = (await response.json()) as UploadGrant & { data?: UploadGrant };
    return grant.data ?? grant;
  }
  const failure = await failureFrom(response, "authorise", "The upload could not be started.");
  if (failure.code === "UPLOAD_ALREADY_COMPLETED" && typeof failure.details.documentId === "string") {
    return {
      alreadyCompleted: true,
      documentId: failure.details.documentId,
      uploadSessionId: typeof failure.details.uploadSessionId === "string" ? failure.details.uploadSessionId : null,
    };
  }
  throw failure;
}

export function isAlreadyUploaded(value: UploadGrant | AlreadyUploaded): value is AlreadyUploaded {
  return "alreadyCompleted" in value;
}

/**
 * Step 2: the bytes, straight to storage (PRD #29 §10). `XMLHttpRequest`
 * because `fetch` still has no upload progress (PRD #29 §167).
 */
export function putUploadObject(
  grant: UploadGrant["upload"],
  file: File,
  handlers: { onProgress?: (progress: number) => void; register?: (request: XMLHttpRequest) => void } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    handlers.register?.(request);
    request.open(grant.method, grant.url, true);
    for (const [header, value] of Object.entries(grant.headers)) request.setRequestHeader(header, value);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) handlers.onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      if (request.status === 413) {
        return reject(new UploadFailure({ message: "That file is larger than the upload limit.", code: "FILE_TOO_LARGE", stage: "put", terminal: true, status: 413 }));
      }
      if (request.status === 403) {
        // The grant ran out; a retry re-authorises under the same key and gets a fresh one.
        return reject(new UploadFailure({ message: "This upload took too long. Retry it.", code: "UPLOAD_URL_EXPIRED", stage: "put", status: 403 }));
      }
      reject(new UploadFailure({ message: "The upload did not complete. Retry this file.", code: "UPLOAD_FAILED", stage: "put", status: request.status }));
    });
    request.addEventListener("error", () => reject(offline("put", false)));
    request.addEventListener("abort", () =>
      reject(new UploadFailure({ message: "Upload cancelled.", code: "UPLOAD_CANCELLED", stage: "put", terminal: true })),
    );
    request.send(file);
  });
}

/**
 * Step 3: the server verifies what arrived (PRD #29 §79-§81). Repeating it is
 * safe — a finished session answers with the document's state — so a lost
 * response is resolved by asking again, not by uploading again.
 */
export async function completeUploadSession(
  target: { kind: "new"; sessionId: string } | { kind: "version"; documentId: string; sessionId: string },
): Promise<{ documentId: string; status: string }> {
  const url = target.kind === "new" ? `/api/documents/uploads/${target.sessionId}/complete` : `/api/documents/${target.documentId}/versions/complete`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: target.kind === "new" ? "{}" : JSON.stringify({ uploadSessionId: target.sessionId }),
    });
  } catch {
    throw offline("complete", true);
  }
  if (!response.ok) throw await failureFrom(response, "complete", "The file could not be verified.");
  const body = (await response.json()) as { documentId: string; status: string; data?: { documentId: string; status: string } };
  return body.data ?? body;
}

/** Cancels an open session: the partial object and the placeholder go (PRD #29 §207, §336). */
export async function abortUploadSession(sessionId: string): Promise<void> {
  await fetch(`/api/documents/uploads/${sessionId}/abort`, { method: "POST" }).catch(() => undefined);
}

export type Settled =
  | { state: "ready" }
  | { state: "rejected"; message: string }
  /** Still being checked when the browser stopped waiting; the file is not ready. */
  | { state: "pending"; message: string }
  /** The status could not be read — not a verdict on the file. */
  | { state: "unknown"; message: string };

const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
const FAST_POLL_WINDOW_MS = 90_000;

/**
 * Waits for the server's verdict (PRD #29 §339, §340).
 *
 * Only AVAILABLE is ready. Running out of patience is "pending" and a failed
 * status read is "unknown": neither is a rejection, and neither is ready — the
 * record keeps showing the file as being checked (AUD-09 §8, FV-19).
 */
export async function settleUpload(
  documentId: string,
  options: { windowMs?: number; signal?: { cancelled: boolean } } = {},
): Promise<Settled> {
  const startedAt = Date.now();
  const windowMs = options.windowMs ?? 5 * 60_000;
  for (;;) {
    const elapsed = Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS));
    if (options.signal?.cancelled) return { state: "pending", message: "Still being checked. It is not ready yet." };

    let status: { status?: string; message?: string | null; data?: { status?: string; message?: string | null } };
    try {
      const response = await fetch(`/api/documents/${documentId}/storage-status`);
      if (!response.ok) return { state: "unknown", message: "Its status could not be read. Check again." };
      status = await response.json();
    } catch {
      return { state: "unknown", message: "The connection dropped while the file was being checked. Check again." };
    }
    const value = status.data ?? status;
    if (value.status === "AVAILABLE") return { state: "ready" };
    if (value.status === "REJECTED" || value.status === "FAILED") {
      return { state: "rejected", message: value.message ?? "The file was not accepted." };
    }
    if (Date.now() - startedAt > windowMs) {
      return { state: "pending", message: "Still being checked. It is not ready yet — check again shortly." };
    }
  }
}
