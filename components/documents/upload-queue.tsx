"use client";

import * as React from "react";

import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { UPLOAD_CONCURRENCY, UPLOAD_RETRY_LIMIT } from "@/lib/core/storage";

/**
 * The direct-upload engine (PRD #29 §9, §119-§121, §166-§170, §339).
 *
 * Three steps per file, and the middle one does not touch this application:
 *
 *   1. POST /api/documents/uploads          authorise, get a signed URL
 *   2. PUT  <signed url>                    bytes go straight to storage
 *   3. POST .../complete                    the server verifies what arrived
 *
 * `XMLHttpRequest` rather than `fetch` for step 2, because `fetch` still has no
 * upload progress event and §166 requires a real 0-100% (PRD #29 §167).
 *
 * One file failing never touches its siblings: each item carries its own state,
 * its own retries and its own abort controller (PRD #29 §170).
 */

export type UploadItemStatus =
  | "queued"
  | "authorising"
  | "uploading"
  | "verifying"
  | "processing"
  | "done"
  | "failed"
  | "cancelled";

export type UploadItem = {
  id: string;
  file: File;
  status: UploadItemStatus;
  /** 0-100, meaningful while `uploading` (PRD #29 §166). */
  progress: number;
  documentId: string | null;
  sessionId: string | null;
  error: string | null;
  attempts: number;
  /** True when a retry would be pointless — a rejected file needs a new one. */
  terminal: boolean;
};

export type UploadContextInput = {
  context: "company" | "project" | "client" | "record";
  projectId?: string;
  clientId?: string;
  entityType?: string;
  entityId?: string;
};

type Metadata = { name: string; description?: string };

/** How long to keep polling a processing document before easing off (§340). */
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
const FAST_POLL_WINDOW_MS = 90_000;

let counter = 0;
const nextId = () => `upload-${(counter += 1)}`;

export function useUploadQueue(options: {
  parent: UploadContextInput;
  onUploaded?: (documentId: string, file: File) => void;
}) {
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const running = React.useRef(new Map<string, XMLHttpRequest>());
  const parentRef = React.useRef(options.parent);
  const onUploadedRef = React.useRef(options.onUploaded);

  parentRef.current = options.parent;
  onUploadedRef.current = options.onUploaded;

  const patch = React.useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  const active = items.some((item) =>
    ["authorising", "uploading", "verifying"].includes(item.status),
  );

  /**
   * Leaving mid-upload asks first (PRD #29 §345). The queue takes part in the
   * tab's unsaved-work contract instead of adding its own `beforeunload`
   * (AUD-03 §3): links, Back, closing the dialog it sits in, a workspace
   * switch and a reload all ask while a file is waiting or on its way. A file
   * the server already holds is never deleted by a discard.
   */
  const uploads = useUnsavedEditor({ saveKind: "none", label: "Files being uploaded" });
  const { setPendingUploads } = uploads;
  const inFlight = items.some((item) =>
    ["queued", "authorising", "uploading", "verifying"].includes(item.status),
  );
  React.useEffect(() => setPendingUploads(inFlight), [inFlight, setPendingUploads]);

  const upload = React.useCallback(
    async (item: UploadItem, metadata: Metadata) => {
      patch(item.id, { status: "authorising", error: null, progress: 0 });

      try {
        const session = await authorise(item.file, metadata, parentRef.current);
        patch(item.id, {
          status: "uploading",
          documentId: session.documentId,
          sessionId: session.uploadSessionId,
        });

        await putObject(session.upload, item.file, {
          onProgress: (progress) => patch(item.id, { progress }),
          register: (request) => running.current.set(item.id, request),
        });
        running.current.delete(item.id);

        patch(item.id, { status: "verifying", progress: 100 });

        const completed = await complete(session.uploadSessionId);

        // Only the server may declare a file ready. Showing it as downloadable
        // before it says AVAILABLE is exactly what §342 forbids.
        if (completed.status === "AVAILABLE") {
          patch(item.id, { status: "done" });
          onUploadedRef.current?.(session.documentId, item.file);
          return;
        }

        patch(item.id, { status: "processing" });
        await pollUntilSettled(session.documentId, (status, message) => {
          if (status === "AVAILABLE") {
            patch(item.id, { status: "done" });
            onUploadedRef.current?.(session.documentId, item.file);
          } else if (status === "REJECTED" || status === "FAILED") {
            patch(item.id, { status: "failed", error: message, terminal: true });
          }
        });
      } catch (error) {
        running.current.delete(item.id);
        const failure = describe(error);
        patch(item.id, {
          status: "failed",
          error: failure.message,
          // A refused file needs a different file, not another attempt
          // (PRD #29 §335).
          terminal: failure.terminal,
        });
      }
    },
    [patch],
  );

  /** Adds files and starts them, up to the concurrency limit (PRD #29 §168). */
  const enqueue = React.useCallback(
    (files: File[], metadata: (file: File, index: number) => Metadata) => {
      const added: UploadItem[] = files.map((file) => ({
        id: nextId(),
        file,
        status: "queued",
        progress: 0,
        documentId: null,
        sessionId: null,
        error: null,
        attempts: 0,
        terminal: false,
      }));

      setItems((current) => [...current, ...added]);

      void (async () => {
        for (let index = 0; index < added.length; index += UPLOAD_CONCURRENCY) {
          const batch = added.slice(index, index + UPLOAD_CONCURRENCY);
          await Promise.all(
            batch.map((item, offset) => upload(item, metadata(item.file, index + offset))),
          );
        }
      })();
    },
    [upload],
  );

  /** Retries one item, up to three attempts with backoff (PRD #29 §120). */
  const retry = React.useCallback(
    async (id: string, metadata: Metadata) => {
      const item = items.find((entry) => entry.id === id);
      if (!item || item.terminal || item.attempts >= UPLOAD_RETRY_LIMIT) return;

      patch(id, { attempts: item.attempts + 1 });
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** item.attempts));
      await upload({ ...item, attempts: item.attempts + 1 }, metadata);
    },
    [items, patch, upload],
  );

  /**
   * Cancels a transfer and tells the server (PRD #29 §336).
   *
   * Aborting the request alone would leave a session holding quota and an
   * object nobody will ever complete, so the abort endpoint is called too.
   */
  const cancel = React.useCallback(
    async (id: string) => {
      const request = running.current.get(id);
      request?.abort();
      running.current.delete(id);

      const item = items.find((entry) => entry.id === id);
      if (item?.sessionId) {
        await fetch(`/api/documents/uploads/${item.sessionId}/abort`, {
          method: "POST",
        }).catch(() => undefined);
      }

      patch(id, { status: "cancelled", error: null });
    },
    [items, patch],
  );

  const clear = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return { items, enqueue, retry, cancel, clear, active };
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

type UploadGrant = {
  documentId: string;
  uploadSessionId: string;
  upload: { method: "PUT"; url: string; headers: Record<string, string>; expiresAt: string };
};

async function authorise(
  file: File,
  metadata: Metadata,
  parent: UploadContextInput,
): Promise<UploadGrant> {
  const response = await fetch("/api/documents/uploads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // A retried authorisation returns the session already open rather than
      // opening a second one (PRD #29 §261). The name is encoded: a header
      // carries only Latin-1, and "Rev A — data.pdf" or "Çelësi.pdf" would
      // otherwise make fetch throw before the request leaves the browser.
      "Idempotency-Key": `${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}`,
    },
    body: JSON.stringify({
      ...parent,
      name: metadata.name,
      description: metadata.description,
      fileName: file.name,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    }),
  });

  if (!response.ok) throw await asError(response);
  return response.json();
}

function putObject(
  grant: UploadGrant["upload"],
  file: File,
  handlers: { onProgress: (progress: number) => void; register: (request: XMLHttpRequest) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    handlers.register(request);

    request.open(grant.method, grant.url, true);
    for (const [header, value] of Object.entries(grant.headers)) {
      request.setRequestHeader(header, value);
    }

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        handlers.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      if (request.status === 413) {
        return reject(new UploadError("That file is larger than the upload limit.", true));
      }
      if (request.status === 403) {
        return reject(new UploadError("This upload took too long. Start it again.", true));
      }
      reject(new UploadError("The upload did not complete. Try again."));
    });

    request.addEventListener("error", () =>
      reject(new UploadError("The upload was interrupted. Try again.")),
    );
    request.addEventListener("abort", () => reject(new UploadError("Upload cancelled.", true)));

    request.send(file);
  });
}

async function complete(sessionId: string): Promise<{ documentId: string; status: string }> {
  const response = await fetch(`/api/documents/uploads/${sessionId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  if (!response.ok) throw await asError(response);
  return response.json();
}

/**
 * Polls until the file settles (PRD #29 §339, §340).
 *
 * Fast for the first minute and a half, then slower — a scan queue that is
 * backed up should not be hammered by every open tab.
 */
async function pollUntilSettled(
  documentId: string,
  onSettled: (status: string, message: string | null) => void,
): Promise<void> {
  const startedAt = Date.now();

  for (;;) {
    const elapsed = Date.now() - startedAt;
    await new Promise((resolve) =>
      setTimeout(resolve, elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS),
    );

    const response = await fetch(`/api/documents/${documentId}/storage-status`);
    if (!response.ok) {
      onSettled("FAILED", "The file could not be verified.");
      return;
    }

    const status = await response.json();
    if (["AVAILABLE", "REJECTED", "FAILED"].includes(status.status)) {
      onSettled(status.status, status.message ?? null);
      return;
    }

    // Five minutes of processing is not a transient hiccup; stop asking and
    // leave the row for the maintenance worker.
    if (elapsed > 5 * 60_000) {
      onSettled("FAILED", "This file is taking longer than expected.");
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

class UploadError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal = false) {
    super(message);
    this.terminal = terminal;
  }
}

/** Codes for which another attempt at the same file cannot help (§335). */
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
]);

async function asError(response: Response): Promise<UploadError> {
  const body = await response.json().catch(() => null);
  const message: string = body?.error?.message ?? "The upload could not be started.";
  const code: string | undefined = body?.error?.details?.code;
  return new UploadError(message, code ? TERMINAL_CODES.has(code) : response.status === 403);
}

function describe(error: unknown): { message: string; terminal: boolean } {
  if (error instanceof UploadError) return { message: error.message, terminal: error.terminal };
  return { message: "Something went wrong during the upload.", terminal: false };
}
