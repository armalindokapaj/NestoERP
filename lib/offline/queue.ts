import type { QueuedMutationType, SyncErrorType } from "@/lib/core/sync/protocol";

import type { OfflineDatabase } from "./database";
import type { MutationBody, MutationRecord, MutationState } from "./types";

/**
 * The mutation queue (MOB-09 §29-§35, §93, §99, §101).
 *
 * Every offline write is one record with its own identity, its owner, the
 * company and project it was made for, and what it waits on. It is never an
 * HTTP request to replay: the server dispatches by type (`lib/core/sync`).
 */

/** Changes that state a version and are refused if the record moved. They never share a round with another change to the same record. */
export const VERSIONED_TYPES: ReadonlySet<QueuedMutationType> = new Set(["SITE_DIARY_UPDATE_DRAFT", "SITE_DIARY_SUBMIT", "TASK_ALLOWED_UPDATE"]);

export function newOperationId(): string {
  return `op_${globalThis.crypto.randomUUID()}`;
}

export function newLocalId(kind: string): string {
  return `local:${kind}:${globalThis.crypto.randomUUID()}`;
}

export const isLocalId = (id: string): boolean => id.startsWith("local:");

export type EnqueueInput = {
  type: QueuedMutationType;
  companyId: string;
  projectId: string | null;
  targetType: string;
  targetId: string;
  label: string;
  payload: Record<string, unknown>;
  /** The version the change is based on, for a record that already exists on the server. */
  expectedVersion?: number | null;
  dependsOn?: string[];
  id?: string;
};

export async function enqueue(db: OfflineDatabase, input: EnqueueInput, now: number = Date.now()): Promise<Omit<MutationRecord, "sealed">> {
  const id = input.id ?? newOperationId();
  const expectedVersion = input.expectedVersion ?? null;
  // A record the server already holds is tracked from the version the device saw, so a change made by someone else is told from our own (§81).
  if (!isLocalId(input.targetId) && expectedVersion !== null && !(await db.getEntity(input.targetId))) {
    await db.putEntity({ localId: input.targetId, serverId: input.targetId, version: expectedVersion, foreign: false });
  }
  const record: Omit<MutationRecord, "sealed" | "userId"> = {
    id,
    companyId: input.companyId,
    projectId: input.projectId,
    type: input.type,
    targetType: input.targetType,
    targetId: input.targetId,
    dependsOn: input.dependsOn ?? [],
    state: "PENDING",
    retryCount: 0,
    nextAttemptAt: 0,
    createdAt: now,
  };
  const body: MutationBody = { label: input.label, payload: input.payload, expectedVersion, carry: VERSIONED_TYPES.has(input.type) };
  await db.putMutation(record, body);
  return { ...record, userId: db.userId };
}

/** The changes on one record that have not reached the server yet, oldest first. */
export async function unsettledFor(db: OfflineDatabase, targetId: string, types?: readonly QueuedMutationType[]): Promise<MutationRecord[]> {
  return (await db.listMutationRecords()).filter((row) => row.targetId === targetId && (!types || types.includes(row.type)));
}

/**
 * What can be sent now (§34, §70): pending, due, every dependency finished
 * (a dependency that is no longer in the queue has been applied). One versioned
 * change per record per round, and it waits for that record's other changes.
 */
export function selectReady(records: MutationRecord[], now: number): MutationRecord[] {
  const present = new Set(records.map((row) => row.id));
  const due = records.filter((row) => row.state === "PENDING" && row.nextAttemptAt <= now && row.dependsOn.every((dep) => !present.has(dep)));
  const inFlight = new Set(records.filter((row) => row.state === "SYNCING").map((row) => row.targetId));
  const chosen: MutationRecord[] = [];
  const versionedTargets = new Set<string>();
  const plainTargets = new Set<string>();
  for (const row of due) {
    if (inFlight.has(row.targetId)) continue;
    if (!VERSIONED_TYPES.has(row.type)) {
      chosen.push(row);
      plainTargets.add(row.targetId);
    }
  }
  for (const row of due) {
    if (inFlight.has(row.targetId) || !VERSIONED_TYPES.has(row.type)) continue;
    if (plainTargets.has(row.targetId) || versionedTargets.has(row.targetId)) continue;
    // Earlier pending changes on the same record go first, so the version it carries is the one they produce.
    // Only changes that will still run count: a failed one waits for a person and does not hold the rest back (a submit names its dependencies explicitly).
    const earlierPending = records.some((other) => other.id !== row.id && other.targetId === row.targetId && other.createdAt < row.createdAt && (other.state === "PENDING" || other.state === "SYNCING"));
    if (earlierPending) continue;
    chosen.push(row);
    versionedTargets.add(row.targetId);
  }
  return chosen.sort((a, b) => a.createdAt - b.createdAt);
}

/** Whether something earlier on the same record failed, so this one cannot go until a person resolves it. */
export function isBlocked(row: MutationRecord, records: MutationRecord[]): boolean {
  if (row.state !== "PENDING") return false;
  const byId = new Map(records.map((other) => [other.id, other]));
  return row.dependsOn.some((dep) => {
    const parent = byId.get(dep);
    return parent ? parent.state === "FAILED" || parent.state === "NEEDS_REVIEW" || isBlocked(parent, records) : false;
  });
}

export type QueueItemState = MutationState;
export type QueueItem = {
  id: string;
  type: QueuedMutationType;
  label: string;
  projectId: string | null;
  targetId: string;
  state: QueueItemState;
  errorType?: SyncErrorType;
  errorCode?: string;
  message?: string;
  current?: { status?: string; version?: number };
  retryCount: number;
  createdAt: number;
  /** For a photo: its upload progress. */
  progress?: number;
};

export type QueueSummary = { total: number; pending: number; syncing: number; failed: number; needsReview: number; blocked: number; items: QueueItem[] };

export async function describeQueue(db: OfflineDatabase): Promise<QueueSummary> {
  const all = await db.listMutations();
  const records = all.map((row) => row.record);
  const files = new Map((await db.listFiles()).map((file) => [file.record.mutationId, file]));
  const items: QueueItem[] = all.map(({ record, body }) => {
    const file = files.get(record.id);
    const blocked = isBlocked(record, records);
    return {
      id: record.id,
      type: record.type,
      label: body.label,
      projectId: record.projectId,
      targetId: record.targetId,
      state: blocked ? "BLOCKED" : record.state,
      errorType: record.errorType,
      errorCode: record.errorCode,
      message: body.errorMessage ?? file?.body.errorMessage,
      current: body.current,
      retryCount: record.retryCount,
      createdAt: record.createdAt,
      ...(file ? { progress: file.record.progress } : {}),
    };
  });
  const count = (state: MutationState) => items.filter((item) => item.state === state).length;
  return { total: items.length, pending: count("PENDING"), syncing: count("SYNCING"), failed: count("FAILED"), needsReview: count("NEEDS_REVIEW"), blocked: count("BLOCKED"), items };
}

/** Everything the person has not yet delivered — what logout, switching account and removing a project must protect (§93, §97). */
export async function unsyncedCount(db: OfflineDatabase, projectId?: string): Promise<number> {
  const records = await db.listMutationRecords();
  return records.filter((row) => !projectId || row.projectId === projectId).length;
}

/** The change and everything that waited on it. Refused while one of them is being sent. */
export async function discard(db: OfflineDatabase, id: string): Promise<string[]> {
  const records = await db.listMutationRecords();
  const doomed = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of records) if (!doomed.has(row.id) && row.dependsOn.some((dep) => doomed.has(dep))) {
        doomed.add(row.id);
        grew = true;
      }
  }
  if (records.some((row) => doomed.has(row.id) && row.state === "SYNCING")) throw new Error("This change is being sent right now.");
  const files = await db.listFiles();
  for (const gone of doomed) {
    await db.removeMutation(gone);
    for (const file of files) if (file.record.mutationId === gone) await db.removeFile(file.record.id);
  }
  return [...doomed];
}

/** Puts a failed change back in the queue for another try, without waiting out its backoff. */
export async function retry(db: OfflineDatabase, id: string): Promise<void> {
  await db.patchMutation(id, { state: "PENDING", retryCount: 0, nextAttemptAt: 0, errorType: undefined, errorCode: undefined }, { errorMessage: undefined });
  const files = await db.listFiles();
  for (const file of files) if (file.record.mutationId === id && file.record.state === "FAILED") await db.patchFile(file.record.id, { state: "PENDING" });
}

/** A change left "being sent" by a closed app is safe to send again: the operation id makes a repeat exact-once (§31, §104). */
export async function recoverInterrupted(db: OfflineDatabase): Promise<number> {
  let recovered = 0;
  for (const row of await db.listMutationRecords()) {
    if (row.state === "SYNCING") {
      await db.patchMutation(row.id, { state: "PENDING", nextAttemptAt: 0 });
      recovered += 1;
    }
  }
  for (const file of await db.listFiles()) if (file.record.state === "UPLOADING") await db.patchFile(file.record.id, { state: "PENDING" });
  return recovered;
}
