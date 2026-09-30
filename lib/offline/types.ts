import type { QueuedMutationType, SyncErrorType } from "@/lib/core/sync/protocol";

import type { Sealed } from "./crypto";

/**
 * The offline database's records (MOB-09 §20-§23).
 *
 * Five concerns, five kinds of store — server cache, pending mutations,
 * pending files, sync metadata, workspace metadata — never one JSON blob.
 * Fields used to find or order a record are plain; everything a person wrote
 * or read is in a `Sealed` value.
 */

/** Synchronisation states. They are not business statuses and are never mixed into them (§22, §23). */
export type SyncState = "SYNCED" | "LOCAL_ONLY" | "PENDING" | "SYNCING" | "FAILED" | "CONFLICT" | "STALE";

export type MutationState = "PENDING" | "SYNCING" | "APPLIED" | "FAILED" | "NEEDS_REVIEW" | "BLOCKED";

/** The kinds of server data kept per project (mirrors `PACKAGE_KINDS`). */
export type CacheKind = "tasks" | "units" | "dailyLogs" | "dailyLogDrafts" | "documents" | "comments";

export type CacheRecord = {
  userId: string;
  companyId: string;
  projectId: string;
  kind: CacheKind;
  id: string;
  /** The server's content token, so a refresh asks only for what changed. */
  token: string;
  syncState: SyncState;
  lastSyncedAt: number;
  sealed: Sealed;
};

export type MutationRecord = {
  /** The operation id: one identity for the change, for ever (§29, §31). */
  id: string;
  userId: string;
  companyId: string;
  projectId: string | null;
  type: QueuedMutationType;
  /** The record it acts on: a server id, or `local:<kind>:<uuid>` until the server has made it. */
  targetType: string;
  targetId: string;
  dependsOn: string[];
  state: MutationState;
  retryCount: number;
  nextAttemptAt: number;
  /** When the device recorded it. Display and metadata only — never trusted as time (§73). */
  createdAt: number;
  errorType?: SyncErrorType;
  errorCode?: string;
  /** Content: payload, label, expected version, conflict detail. */
  sealed: Sealed;
};

/** What is inside a mutation's sealed value. */
export type MutationBody = {
  label: string;
  payload: Record<string, unknown>;
  /** The version the change is based on; `carry` means "whatever the last change in this chain produced". */
  expectedVersion: number | null;
  carry: boolean;
  errorMessage?: string;
  current?: { status?: string; version?: number };
  result?: { entityId: string; version?: number };
};

export type FileState = "PENDING" | "UPLOADING" | "UPLOADED" | "FAILED";

export type PendingFileRecord = {
  id: string;
  userId: string;
  companyId: string;
  projectId: string;
  /** The mutation (`ATTACHMENT_CREATE`) that delivers it. */
  mutationId: string;
  state: FileState;
  /** One chosen file, one upload key, for every retry (PRD #29 §261). */
  uploadKey: string;
  size: number;
  createdAt: number;
  progress: number;
  sealed: Sealed;
};

export type PendingFileBody = {
  name: string;
  mime: string;
  category: string;
  caption: string | null;
  takenTime: string | null;
  documentId?: string;
  sessionId?: string;
  errorMessage?: string;
};

export type OfflineProjectStatus = "NOT_DOWNLOADED" | "PREPARING" | "DOWNLOADING" | "AVAILABLE" | "UPDATE_AVAILABLE" | "UPDATING" | "FAILED";

export type OfflineProjectRecord = {
  userId: string;
  companyId: string;
  projectId: string;
  status: OfflineProjectStatus;
  lastSyncedAt: number | null;
  sizeBytes: number;
  sealed: Sealed;
};

export type OfflineProjectBody = {
  name: string;
  code: string;
  /** Tokens by kind and id, as last received. */
  tokens: Record<string, Record<string, string>>;
  diary: { today: string | null; canCreate: boolean };
  errorMessage?: string;
  /** Set when the server stopped recognising this person's access to the project (§58). Cached data is gone; unsynced work is kept. */
  revokedAt?: number;
};

export type DownloadedDocumentRecord = {
  userId: string;
  companyId: string;
  projectId: string;
  documentId: string;
  versionId: string;
  versionNumber: number;
  downloadedAt: number;
  serverUpdatedAt: string;
  size: number;
  sealed: Sealed;
  /** The file's bytes, sealed separately so a list never decrypts them. */
  bytes: Sealed;
};

export type DownloadedDocumentBody = { name: string; fileName: string; mime: string };

export type MetaRecord = { key: string; sealed: Sealed };

/**
 * What the device knows about one record it writes to (§21, §35, §81).
 * Keyed by the id the device used (`local:…` until the server made the record).
 * `version` is the last version the device saw or produced; `foreign` is set when
 * it jumped by more than the device's own change, meaning someone else changed
 * the record in between.
 */
export type IdMapRecord = {
  localId: string;
  serverId: string;
  version: number | null;
  foreign: boolean;
};
