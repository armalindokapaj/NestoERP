/**
 * The sync contract shared by the server and the offline client (MOB-09 §29-§31,
 * §85, §147).
 *
 * Pure types and constants — no I/O — so the device's queue and the server's
 * dispatcher cannot disagree about what an operation, an outcome or an error
 * class is. The server never sees a local id: the client resolves those before
 * it sends (`offline/engine`).
 */

/** Bumped when an operation's meaning changes. A client below the server's minimum must not replay (§109). */
export const SYNC_PROTOCOL_VERSION = 1;

/** The lowest protocol a client may replay with. Raise it only when an old client's operations would be misread (§109). */
export function minimumSyncProtocolVersion(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const parsed = Number(env.NESTO_MIN_SYNC_PROTOCOL_VERSION);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, SYNC_PROTOCOL_VERSION) : 1;
}

/** Every write that may be made offline. Nothing else is writable (§30). */
export const MUTATION_TYPES = [
  "SITE_DIARY_CREATE",
  "SITE_DIARY_UPDATE_DRAFT",
  "SITE_DIARY_ADD_ENTRY",
  "SITE_DIARY_SUBMIT",
  "TASK_COMMENT_CREATE",
  "TASK_ALLOWED_UPDATE",
  "HSE_CREATE",
] as const;
export type MutationType = (typeof MUTATION_TYPES)[number];

/** Not a server mutation: the bytes go through the upload flow; the queue still orders and tracks it (§34, §40). */
export const FILE_MUTATION_TYPES = ["ATTACHMENT_CREATE"] as const;
export type FileMutationType = (typeof FILE_MUTATION_TYPES)[number];

export type QueuedMutationType = MutationType | FileMutationType;

/** The Task commands that may be queued. Claim, block, reopen, archive and edits need a live server (§45-§47). */
export const QUEUEABLE_TASK_COMMANDS = ["start", "complete"] as const;
export type QueueableTaskCommand = (typeof QUEUEABLE_TASK_COMMANDS)[number];

/** Error classes and what each means for the queue (§85, §86). */
export const SYNC_ERROR_TYPES = ["NETWORK", "AUTH", "PERMISSION", "VALIDATION", "CONFLICT", "SERVER_TEMPORARY", "FILE_ERROR", "UNSUPPORTED_VERSION"] as const;
export type SyncErrorType = (typeof SYNC_ERROR_TYPES)[number];

/** Whether the queue may try the same operation again by itself. */
export function isAutomaticallyRetryable(type: SyncErrorType): boolean {
  return type === "NETWORK" || type === "SERVER_TEMPORARY";
}

export type SyncEntityRef = { entityType: string; entityId: string };

/** One change, as it crosses the wire. */
export type SyncOperationEnvelope = {
  operationId: string;
  type: MutationType;
  /** The company the device recorded the change under. A claim the server checks against the session, never a grant. */
  claimedCompanyId: string;
  projectId: string | null;
  /** The record this acts on (a diary, a task, a comment's parent); absent for creates. */
  target: SyncEntityRef | null;
  /** The version the device based the change on; carried forward through a chain the device itself made. */
  expectedVersion: number | null;
  payload: Record<string, unknown>;
  /** When the device recorded it. Metadata only — never trusted as server time (§73, §123). */
  capturedAt: string | null;
};

export type SyncBatchRequest = {
  protocolVersion: number;
  operations: SyncOperationEnvelope[];
};

export type SyncOutcome = "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED" | "RETRY";

export type SyncOperationResult = {
  operationId: string;
  result: SyncOutcome;
  entityType?: string;
  canonicalEntityId?: string;
  serverVersion?: number;
  /** The row an entry-style change created inside its target (a diary section row). */
  childId?: string;
  /** What the server now holds, when the device needs it to explain a conflict. */
  current?: { status?: string; version?: number };
  errorType?: SyncErrorType;
  code?: string;
  message?: string;
};

export type SyncBatchResponse = {
  protocolVersion: number;
  serverTime: string;
  results: SyncOperationResult[];
};

/** What an adapter reports after the canonical service has done the work. */
export type AdapterOutcome = {
  entityType: string;
  entityId: string;
  serverVersion?: number;
  childId?: string;
};
