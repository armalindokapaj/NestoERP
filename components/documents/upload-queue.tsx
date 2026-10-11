"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { UPLOAD_CONCURRENCY, UPLOAD_RETRY_LIMIT } from "@/lib/core/storage";
import {
  abortUploadSession,
  authoriseUpload,
  completeUploadSession,
  isAlreadyUploaded,
  newUploadKey,
  precheckFile,
  putUploadObject,
  settleUpload,
  UploadFailure,
  type UploadGroups,
  type UploadStage,
} from "./upload-client";

/**
 * The direct-upload engine (PRD #29 §9, §119-§121, §166-§170, §339;
 * AUD-09 §8, FV-18, FV-19).
 *
 * Three steps per file, and the middle one does not touch this application:
 *
 *   1. POST /api/documents/uploads          authorise, get a signed URL
 *   2. PUT  <signed url>                    bytes go straight to storage
 *   3. POST .../complete                    the server verifies what arrived
 *
 * One file failing never touches its siblings: each item carries its own
 * state, its own retries and its own abort (PRD #29 §170).
 *
 * AUD-09 made the states honest and the retries safe:
 *
 *   - Each item is one upload key for its whole life (`newUploadKey`). A retry
 *     resumes where the failure happened — re-asks the server after a lost
 *     completion, re-checks a file still being scanned — and never re-uploads
 *     a file that already arrived or files a second document for it.
 *   - Selected, uploading, checking, still-being-checked, ready and failed are
 *     distinct. Only the server's AVAILABLE makes an item `done`; a browser
 *     that stopped waiting says `pending`, never ready and never failed.
 *   - A file the registry refuses is refused before any request, with the
 *     server's own sentence (`precheckFile`).
 *   - Cancelling a file that is still being authorised cancels it: the session
 *     the server opens anyway is aborted, not left holding quota.
 *   - With `persistKey`, the queue outlives a remount of its control. Files
 *     still moving keep moving and show their real state when the control
 *     returns; a failed file whose bytes went with the old control comes back
 *     as its name with "Select this file again" (`lost`), never as attached.
 */

export type UploadItemStatus =
  | "queued"
  | "authorising"
  | "uploading"
  | "verifying"
  | "processing"
  /** The browser stopped waiting (or lost the status read); the server has not said ready. */
  | "pending"
  /** Ready; the caller's `link` step is attaching it to the record. */
  | "linking"
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
  /** The step that failed, so a retry resumes there (AUD-09 FV-18). */
  stage: UploadStage | "link" | null;
};

/** A file whose bytes were lost with a remount: its name, never an attachment (FV-19). */
export type LostUpload = { id: string; fileName: string; fileSize: number };

/** Statuses in which the file is on its way and not yet settled. */
export const UPLOAD_IN_FLIGHT: readonly UploadItemStatus[] = ["queued", "authorising", "uploading", "verifying", "processing", "linking"];

export type UploadContextInput = {
  context: "company" | "project" | "client" | "record";
  projectId?: string;
  clientId?: string;
  entityType?: string;
  entityId?: string;
};

type Metadata = { name: string; description?: string };

type Entry = {
  item: UploadItem;
  key: string;
  parent: UploadContextInput;
  metadata: Metadata;
  announced: boolean;
};

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The queue's state, outside React so it can outlive a remount.
 *
 * Kept in memory only — never browser storage (AUD-09 §7: no form data, file
 * names included, in storage). A reload is a fresh queue; the server's own
 * records say what arrived.
 */
class QueueStore {
  entries: Entry[] = [];
  lost: LostUpload[] = [];
  /** The key and metadata of each lost file, so choosing it again is the same upload. */
  lostKeys = new Map<string, { key: string; metadata: Metadata }>();
  snapshot: { items: UploadItem[]; lost: LostUpload[] } = { items: [], lost: [] };
  requests = new Map<string, XMLHttpRequest>();
  cancelled = new Set<string>();
  running = new Set<string>();
  mounted = 0;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  emit() {
    this.snapshot = { items: this.entries.map((entry) => entry.item), lost: this.lost };
    for (const listener of this.listeners) listener();
  }

  entry(id: string): Entry | undefined {
    return this.entries.find((entry) => entry.item.id === id);
  }

  patch(id: string, changes: Partial<UploadItem>) {
    const entry = this.entry(id);
    if (!entry) return;
    entry.item = { ...entry.item, ...changes };
    this.emit();
  }

  /**
   * The control went away. What is still moving keeps moving, and a file the
   * server is still checking stays visible; a finished, cancelled or refused
   * row has nothing left to say. A retryable failure cannot be retried without
   * its bytes, so it becomes a name to choose again (FV-19).
   */
  release() {
    const kept: Entry[] = [];
    for (const entry of this.entries) {
      const { status, terminal } = entry.item;
      if (UPLOAD_IN_FLIGHT.includes(status) || status === "pending" || this.running.has(entry.item.id)) kept.push(entry);
      else if (status === "failed" && !terminal) {
        this.lost.push({ id: entry.item.id, fileName: entry.item.file.name, fileSize: entry.item.file.size });
        this.lostKeys.set(entry.item.id, { key: entry.key, metadata: entry.metadata });
      }
    }
    this.entries = kept;
    this.emit();
  }
}

/** Queues that outlive their control, by `persistKey`. In memory, per tab. */
const persisted = new Map<string, QueueStore>();

function persistedStore(key: string): QueueStore {
  let store = persisted.get(key);
  if (!store) persisted.set(key, (store = new QueueStore()));
  return store;
}

let counter = 0;
const nextId = () => `upload-${Date.now().toString(36)}-${(counter += 1)}`;

/* -------------------------------------------------------------------------- */
/* The hook                                                                    */
/* -------------------------------------------------------------------------- */

export function useUploadQueue(options: {
  parent: UploadContextInput;
  onUploaded?: (documentId: string, file: File) => void;
  /**
   * Attaches a ready file to the record, when the control does that itself
   * (unit media, project media). Its failure is a failed item whose retry
   * repeats only this step — the file is not uploaded again — so the link
   * must be safe to repeat (the record's unique link answers "already there").
   */
  link?: (documentId: string, file: File) => Promise<void>;
  /** Keeps the queue across a remount of the control (FV-19). */
  persistKey?: string;
  /** The ceiling to pre-check against; the server's own still applies. */
  maxBytes?: number;
  /** Narrows the accepted registry groups (e.g. images only). */
  groups?: UploadGroups;
}) {
  const [localStore] = React.useState(() => new QueueStore());
  const store = options.persistKey ? persistedStore(options.persistKey) : localStore;

  const { items, lost } = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const optionsParent = React.useRef(options.parent);
  optionsParent.current = options.parent;
  const onUploadedRef = React.useRef(options.onUploaded);
  const linkRef = React.useRef(options.link);
  const precheckRef = React.useRef({ maxBytes: options.maxBytes, groups: options.groups });
  onUploadedRef.current = options.onUploaded;
  linkRef.current = options.link;
  precheckRef.current = { maxBytes: options.maxBytes, groups: options.groups };

  React.useEffect(() => {
    store.mounted += 1;
    return () => {
      store.mounted -= 1;
      if (store.mounted === 0) store.release();
    };
  }, [store]);

  const active = items.some((item) => ["authorising", "uploading", "verifying"].includes(item.status));

  /**
   * Leaving mid-upload asks first (PRD #29 §345). The queue takes part in the
   * tab's unsaved-work contract instead of adding its own `beforeunload`
   * (AUD-03 §3): links, Back, closing the dialog it sits in, a workspace
   * switch and a reload all ask while a file is waiting or on its way. A file
   * the server already holds is never deleted by a discard.
   */
  const t = useTranslations("ui");
  const uploads = useUnsavedEditor({ saveKind: "none", label: t("uploadsLabel") });
  const { setPendingUploads } = uploads;
  const inFlight = items.some((item) => ["queued", "authorising", "uploading", "verifying"].includes(item.status));
  React.useEffect(() => setPendingUploads(inFlight), [inFlight, setPendingUploads]);

  /** The server said ready: attach, if the control attaches, then announce once. */
  const finish = React.useCallback(
    async (id: string) => {
      const entry = store.entry(id);
      if (!entry?.item.documentId) return;
      const { documentId, file } = entry.item;
      const link = linkRef.current;
      if (link) {
        store.patch(id, { status: "linking", error: null, stage: null });
        try {
          await link(documentId, file);
        } catch (error) {
          store.patch(id, {
            status: "failed",
            stage: "link",
            terminal: false,
            error: error instanceof Error ? error.message : "The file arrived but could not be added. Retry adds it; it is not uploaded again.",
          });
          return;
        }
      }
      store.patch(id, { status: "done", error: null, stage: null });
      if (!entry.announced) {
        entry.announced = true;
        onUploadedRef.current?.(documentId, file);
      }
    },
    [store],
  );

  /** Waits for the server's verdict on a file it holds (PRD #29 §339). */
  const settle = React.useCallback(
    async (id: string, documentId: string) => {
      store.patch(id, { status: "processing", error: null, stage: null });
      const verdict = await settleUpload(documentId);
      if (verdict.state === "ready") return finish(id);
      if (verdict.state === "rejected") return store.patch(id, { status: "failed", error: verdict.message, terminal: true, stage: "settle" });
      // Neither ready nor refused: the record shows it as being checked too.
      store.patch(id, { status: "pending", error: verdict.message, stage: "settle" });
    },
    [store, finish],
  );

  /** Runs one item from wherever it stands (AUD-09 FV-18). */
  const run = React.useCallback(
    async (id: string) => {
      const entry = store.entry(id);
      if (!entry || store.running.has(id)) return;
      store.running.add(id);
      const { item } = entry;
      try {
        if (store.cancelled.has(id)) return;

        // Ready but not yet attached: only the attachment is repeated.
        if (item.stage === "link" && item.documentId) return await finish(id);
        // Arrived and being checked: only the check is repeated.
        if ((item.stage === "settle" || item.status === "pending") && item.documentId) return await settle(id, item.documentId);

        // The completion's answer was lost: ask again before sending anything.
        if (item.stage === "complete" && item.sessionId && item.documentId) {
          store.patch(id, { status: "verifying", error: null, progress: 100 });
          try {
            const completed = await completeUploadSession({ kind: "new", sessionId: item.sessionId });
            return completed.status === "AVAILABLE" ? await finish(id) : await settle(id, item.documentId);
          } catch (error) {
            // Nothing arrived after all: fall through and send the bytes.
            if (!(error instanceof UploadFailure && error.code === "STORAGE_OBJECT_MISSING")) throw error;
          }
        }

        store.patch(id, { status: "authorising", error: null, progress: 0, stage: null });
        const grant = await authoriseUpload(
          {
            kind: "new",
            body: {
              ...entry.parent,
              name: entry.metadata.name,
              description: entry.metadata.description,
              fileName: item.file.name,
              mimeType: item.file.type || undefined,
              sizeBytes: item.file.size,
            },
          },
          entry.key,
        );

        // The key's upload had already finished — the answer to a lost
        // response. The file is there; nothing is sent twice.
        if (isAlreadyUploaded(grant)) {
          store.patch(id, { documentId: grant.documentId, sessionId: grant.uploadSessionId });
          return await settle(id, grant.documentId);
        }

        store.patch(id, { documentId: grant.documentId, sessionId: grant.uploadSessionId });
        if (store.cancelled.has(id)) {
          // Cancelled while the server was opening the session: close it.
          await abortUploadSession(grant.uploadSessionId);
          return;
        }

        store.patch(id, { status: "uploading" });
        await putUploadObject(grant.upload, item.file, {
          onProgress: (progress) => store.patch(id, { progress }),
          register: (request) => store.requests.set(id, request),
        });
        store.requests.delete(id);

        store.patch(id, { status: "verifying", progress: 100 });
        const completed = await completeUploadSession({ kind: "new", sessionId: grant.uploadSessionId });
        // Only the server may declare a file ready (PRD #29 §342).
        if (completed.status === "AVAILABLE") return await finish(id);
        if (completed.status === "REJECTED" || completed.status === "FAILED") {
          return store.patch(id, { status: "failed", terminal: true, error: "The file was not accepted.", stage: "complete" });
        }
        await settle(id, grant.documentId);
      } catch (error) {
        store.requests.delete(id);
        if (store.cancelled.has(id)) {
          const sessionId = store.entry(id)?.item.sessionId;
          if (sessionId) await abortUploadSession(sessionId);
          store.patch(id, { status: "cancelled", error: null });
          return;
        }
        const failure =
          error instanceof UploadFailure
            ? error
            : new UploadFailure({ message: "Something went wrong during the upload.", code: "UPLOAD_FAILED", stage: "put" });
        store.patch(id, {
          status: "failed",
          error: failure.message,
          // A refused file needs a different file, not another attempt (PRD #29 §335).
          terminal: failure.terminal,
          stage: failure.stage,
        });
      } finally {
        store.running.delete(id);
      }
    },
    [store, finish, settle],
  );

  /** Adds files and starts them, up to the concurrency limit (PRD #29 §168). */
  const enqueue = React.useCallback(
    (files: File[], metadata: (file: File, index: number) => Metadata, reuse?: { key: string; metadata: Metadata }) => {
      const parent = { ...optionsParent.current };
      const added: Entry[] = files.map((file, index) => {
        const check = precheckFile(file, precheckRef.current);
        return {
          key: reuse?.key ?? newUploadKey(),
          parent,
          metadata: reuse?.metadata ?? metadata(file, index),
          announced: false,
          item: {
            id: nextId(),
            file,
            status: check.ok ? "queued" : "failed",
            progress: 0,
            documentId: null,
            sessionId: null,
            error: check.ok ? null : check.message,
            attempts: 0,
            terminal: !check.ok,
            stage: check.ok ? null : "check",
          },
        };
      });
      store.entries = [...store.entries, ...added];
      store.emit();

      const startable = added.filter((entry) => entry.item.status === "queued").map((entry) => entry.item.id);
      void (async () => {
        for (let index = 0; index < startable.length; index += UPLOAD_CONCURRENCY) {
          // A file cancelled while it waited is skipped, not started (§336).
          await Promise.all(startable.slice(index, index + UPLOAD_CONCURRENCY).filter((id) => !store.cancelled.has(id)).map((id) => run(id)));
        }
      })();
    },
    [store, run],
  );

  /**
   * Retries one item, up to three attempts with backoff (PRD #29 §120), from
   * the step that failed. The metadata it was queued with is kept: a retry is
   * the same upload, not a new one named after whatever the form says now.
   */
  const retry = React.useCallback(
    async (id: string, metadata?: Metadata) => {
      const entry = store.entry(id);
      if (!entry || entry.item.terminal || entry.item.attempts >= UPLOAD_RETRY_LIMIT) return;
      if (metadata && !entry.item.documentId) entry.metadata = metadata;
      const attempts = entry.item.attempts + 1;
      store.patch(id, { attempts, status: "queued", error: null });
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempts - 1)));
      await run(id);
    },
    [store, run],
  );

  /** Asks again about a file still being checked; not an upload, not an attempt. */
  const recheck = React.useCallback(
    async (id: string) => {
      const entry = store.entry(id);
      if (!entry?.item.documentId || entry.item.status !== "pending") return;
      await run(id);
    },
    [store, run],
  );

  /**
   * Cancels a transfer and tells the server (PRD #29 §336).
   *
   * Aborting the request alone would leave a session holding quota and an
   * object nobody will ever complete, so the abort endpoint is called too —
   * including for a file cancelled while its session was still being opened.
   */
  const cancel = React.useCallback(
    async (id: string) => {
      const entry = store.entry(id);
      if (!entry || !["queued", "authorising", "uploading"].includes(entry.item.status)) return;
      store.cancelled.add(id);
      const request = store.requests.get(id);
      request?.abort();
      store.requests.delete(id);
      if (!store.running.has(id)) {
        if (entry.item.sessionId) await abortUploadSession(entry.item.sessionId);
        store.patch(id, { status: "cancelled", error: null });
      } else {
        // The runner settles it once its current request returns.
        store.patch(id, { status: "cancelled", error: null });
      }
    },
    [store],
  );

  const clear = React.useCallback(
    (id: string) => {
      store.entries = store.entries.filter((entry) => entry.item.id !== id);
      store.lost = store.lost.filter((entry) => entry.id !== id);
      store.lostKeys.delete(id);
      store.emit();
    },
    [store],
  );

  /**
   * A lost file chosen again (FV-19). The same file (name and size) resumes
   * under its old key, so a session the server still has open is reused and a
   * finished one is found rather than duplicated; a different file is a new
   * upload.
   */
  const reselect = React.useCallback(
    (lostId: string, file: File, metadata: (file: File, index: number) => Metadata) => {
      const previous = store.lost.find((entry) => entry.id === lostId);
      store.lost = store.lost.filter((entry) => entry.id !== lostId);
      store.emit();
      const same = previous && previous.fileName === file.name && previous.fileSize === file.size;
      const reuse = same ? store.lostKeys.get(lostId) : undefined;
      store.lostKeys.delete(lostId);
      enqueue([file], metadata, reuse);
    },
    [store, enqueue],
  );

  return { items, lost, enqueue, retry, recheck, cancel, clear, reselect, active };
}

/** One label per state, the same everywhere a queue is shown (AUD-09 §8). */
export function uploadStatusLabel(item: Pick<UploadItem, "status" | "progress">): string {
  switch (item.status) {
    case "queued":
      return "Selected — waiting to upload";
    case "authorising":
      return "Preparing";
    case "uploading":
      return `Uploading ${item.progress}%`;
    case "verifying":
      return "Checking the file";
    case "processing":
      return "Scanning — not ready yet";
    case "pending":
      return "Still being checked — not ready yet";
    case "linking":
      return "Adding to the record";
    case "done":
      return "Uploaded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}
