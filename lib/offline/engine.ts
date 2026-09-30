import {
  isAutomaticallyRetryable,
  SYNC_PROTOCOL_VERSION,
  type SyncBatchResponse,
  type SyncErrorType,
  type SyncOperationEnvelope,
  type SyncOperationResult,
} from "@/lib/core/sync/protocol";
import type { AuthorizationSnapshot } from "@/lib/core/sync/authorization.service";

import type { OfflineDatabase } from "./database";
import { backoffDelay, classifyHttp, MAX_AUTOMATIC_RETRIES } from "./errors";
import { isLocalId, recoverInterrupted, selectReady } from "./queue";
import type { MutationBody, MutationRecord } from "./types";
import { uploadPendingFile, type UploadOutcome } from "./uploader";

/**
 * The sync engine (MOB-09 §67-§70, §143).
 *
 * One loop for every module — no module keeps a retry loop of its own. Order:
 * check the session and authorisation, send what is ready in rounds (a change
 * waits for what it depends on), then pull what changed on the server. The
 * server decides every outcome; the engine only records what it said.
 */

export type SyncStatus = "idle" | "syncing" | "offline" | "paused-auth" | "paused-update" | "identity-mismatch";

export type SyncReport = {
  status: SyncStatus;
  applied: number;
  failed: number;
  conflicts: number;
  retrying: number;
  pulled: boolean;
  startedAt: number;
  finishedAt: number;
};

export type EngineOptions = {
  db: OfflineDatabase;
  isOnline?: () => boolean;
  now?: () => number;
  fetchImpl?: typeof fetch;
  uploader?: typeof uploadPendingFile;
  /** Pulls what changed for the offline projects. Injected so the engine stays free of project screens. */
  pull?: (db: OfflineDatabase, fetchImpl: typeof fetch) => Promise<void>;
  reportUnreachable?: () => void;
  onChange?: () => void;
};

const MAX_ROUNDS = 25;
const MAX_BATCH = 50;

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  private listeners = new Set<() => void>();
  private state: { status: SyncStatus; report: SyncReport | null } = { status: "idle", report: null };

  constructor(private readonly options: EngineOptions) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }
  private get fetchImpl(): typeof fetch {
    return this.options.fetchImpl ?? ((...args) => fetch(...args));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;

  private set(status: SyncStatus, report?: SyncReport): void {
    this.state = { status, report: report ?? this.state.report };
    for (const listener of this.listeners) listener();
    this.options.onChange?.();
  }

  /** Called once when the app starts: anything "being sent" when it closed goes back in the queue (§104). */
  async start(): Promise<void> {
    await recoverInterrupted(this.options.db);
    this.options.onChange?.();
  }

  /** One pass. Concurrent calls share it: two triggers never make two loops (§67). */
  runOnce(): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = this.execute().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async execute(): Promise<SyncReport> {
    const db = this.options.db;
    const report: SyncReport = { status: "syncing", applied: 0, failed: 0, conflicts: 0, retrying: 0, pulled: false, startedAt: this.now, finishedAt: 0 };
    const finish = (status: SyncStatus): SyncReport => {
      report.status = status;
      report.finishedAt = this.now;
      this.set(status === "syncing" ? "idle" : status, report);
      return report;
    };

    if (this.options.isOnline && !this.options.isOnline()) return finish("offline");
    this.set("syncing");

    // 1. Who is signed in, and is this device allowed to speak (§70.1, §70.2, §57).
    const session = await this.validateSession();
    if (session.kind !== "ok") return finish(session.kind === "unreachable" ? "offline" : session.kind);
    const authorization = session.snapshot;

    // 2. Send what is ready, round by round (§70.3-§70.5).
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const all = await db.listMutationRecords();
      const ready = selectReady(all, this.now).filter((row) => row.companyId === authorization.workspace.companyId && authorization.workspace.scope === "COMPANY");
      if (ready.length === 0) break;
      const progress = await this.sendRound(ready, report);
      if (progress.stop) return finish(progress.stop);
      if (!progress.moved) break;
    }

    // 3. Pull what changed on the server, after our own changes are in (§70.6-§70.8).
    const remaining = await db.listMutationRecords();
    if (this.options.pull && !remaining.some((row) => row.state === "SYNCING")) {
      try {
        await this.options.pull(db, this.fetchImpl);
        report.pulled = true;
      } catch {
        // A failed pull leaves the cache as it was; the next pass asks again.
      }
    }
    if (report.failed === 0 && report.conflicts === 0) await db.setMeta("lastSyncAt", this.now);
    return finish("idle");
  }

  /* Session ----------------------------------------------------------------- */

  private async validateSession(): Promise<{ kind: "ok"; snapshot: AuthorizationSnapshot } | { kind: "paused-auth" | "paused-update" | "identity-mismatch" | "unreachable" }> {
    const db = this.options.db;
    let response: Response;
    try {
      response = await this.fetchImpl("/api/sync/authorization", { cache: "no-store" });
    } catch {
      this.options.reportUnreachable?.();
      return { kind: "unreachable" };
    }
    if (response.status === 401) return { kind: "paused-auth" };
    if (response.status === 426) return { kind: "paused-update" };
    if (!response.ok) return { kind: "unreachable" };
    const snapshot = ((await response.json()) as { data: AuthorizationSnapshot }).data;
    // Never send one person's changes as another: the database belongs to one user id (§98, §99).
    if (snapshot.user.userId !== db.userId) return { kind: "identity-mismatch" };
    if (snapshot.minimumProtocolVersion > SYNC_PROTOCOL_VERSION) return { kind: "paused-update" };
    await db.setMeta("authorization", snapshot);
    await db.setMeta("authorizationRefreshedAt", this.now);
    return { kind: "ok", snapshot };
  }

  /* Sending ----------------------------------------------------------------- */

  private async sendRound(ready: MutationRecord[], report: SyncReport): Promise<{ moved: boolean; stop?: SyncStatus }> {
    const db = this.options.db;
    let moved = false;
    const fileOps = ready.filter((row) => row.type === "ATTACHMENT_CREATE");
    const serverOps = ready.filter((row) => row.type !== "ATTACHMENT_CREATE");

    if (serverOps.length > 0) {
      const outcome = await this.sendBatch(serverOps, report);
      if (outcome.stop) return { moved: outcome.moved, stop: outcome.stop };
      moved ||= outcome.moved;
    }
    for (const row of fileOps) {
      const outcome = await this.sendFile(row, report);
      if (outcome.stop) return { moved, stop: outcome.stop };
      moved ||= outcome.moved;
    }
    void db;
    return { moved };
  }

  private async sendBatch(rows: MutationRecord[], report: SyncReport): Promise<{ moved: boolean; stop?: SyncStatus }> {
    const db = this.options.db;
    const built: Array<{ row: MutationRecord; body: MutationBody; envelope: SyncOperationEnvelope }> = [];
    let moved = false;

    for (const row of rows.slice(0, MAX_BATCH)) {
      const stored = await db.getMutation(row.id);
      if (!stored) continue;
      // A change that makes a record has no target yet: the server names it in the answer.
      const makes = row.type === "SITE_DIARY_CREATE" || row.type === "HSE_CREATE";
      const target = makes ? { serverId: row.targetId } : await this.resolveTarget(row);
      if (!target) {
        // A dependency that should have produced this record has not: wait, do not guess.
        await db.patchMutation(row.id, { nextAttemptAt: this.now + backoffDelay(row.retryCount) });
        continue;
      }
      let expectedVersion: number | null = null;
      if (stored.body.carry) {
        const entity = await db.getEntity(target.serverId);
        if (entity?.foreign) {
          // The record changed while we were offline; our change was written against an older one (§76).
          await db.patchMutation(row.id, { state: "NEEDS_REVIEW", errorType: "CONFLICT", errorCode: "CHANGED_WHILE_OFFLINE" }, { errorMessage: "This changed while you were offline.", current: entity.version === null ? undefined : { version: entity.version } });
          report.conflicts += 1;
          continue;
        }
        expectedVersion = entity?.version ?? stored.body.expectedVersion;
      }
      built.push({
        row,
        body: stored.body,
        envelope: {
          operationId: row.id,
          type: row.type as SyncOperationEnvelope["type"],
          claimedCompanyId: row.companyId,
          projectId: row.projectId,
          target: makes ? null : { entityType: row.targetType, entityId: target.serverId },
          expectedVersion,
          payload: stored.body.payload,
          capturedAt: new Date(row.createdAt).toISOString(),
        },
      });
    }
    if (built.length === 0) return { moved: false };

    for (const { row } of built) await db.patchMutation(row.id, { state: "SYNCING" });
    this.options.onChange?.();

    let response: Response;
    try {
      response = await this.fetchImpl("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: SYNC_PROTOCOL_VERSION, operations: built.map((entry) => entry.envelope) }),
      });
    } catch {
      // The request may or may not have arrived. The operation id makes sending it again exact-once (§129, §155).
      for (const { row } of built) await db.patchMutation(row.id, { state: "PENDING", nextAttemptAt: this.now + backoffDelay(row.retryCount) });
      this.options.reportUnreachable?.();
      return { moved: false, stop: "offline" };
    }

    if (!response.ok) {
      const failure = classifyHttp(response.status, await response.json().catch(() => null));
      for (const { row } of built) await this.revertOrRetry(row, failure.errorType, failure.message, report);
      if (failure.errorType === "AUTH") return { moved: false, stop: "paused-auth" };
      if (failure.errorType === "UNSUPPORTED_VERSION") return { moved: false, stop: "paused-update" };
      return { moved: false };
    }

    const answer = ((await response.json()) as { data: SyncBatchResponse }).data;
    const byId = new Map(answer.results.map((result) => [result.operationId, result]));
    let stop: SyncStatus | undefined;
    for (const { row } of built) {
      const result = byId.get(row.id);
      if (!result) {
        await db.patchMutation(row.id, { state: "PENDING", nextAttemptAt: this.now + backoffDelay(row.retryCount) });
        continue;
      }
      const next = await this.applyResult(row, result, report);
      moved ||= next.moved;
      stop ??= next.stop;
    }
    return { moved, stop };
  }

  private async resolveTarget(row: MutationRecord): Promise<{ serverId: string } | null> {
    if (!isLocalId(row.targetId)) return { serverId: (await this.options.db.getEntity(row.targetId))?.serverId ?? row.targetId };
    const entity = await this.options.db.getEntity(row.targetId);
    return entity ? { serverId: entity.serverId } : null;
  }

  private async applyResult(row: MutationRecord, result: SyncOperationResult, report: SyncReport): Promise<{ moved: boolean; stop?: SyncStatus }> {
    const db = this.options.db;
    switch (result.result) {
      case "APPLIED":
      case "DUPLICATE": {
        await this.recordVersion(row, result);
        await db.removeMutation(row.id);
        report.applied += 1;
        return { moved: true };
      }
      case "CONFLICT":
        await db.patchMutation(row.id, { state: "NEEDS_REVIEW", errorType: "CONFLICT", errorCode: result.code }, { errorMessage: result.message, current: result.current });
        report.conflicts += 1;
        return { moved: true };
      case "RETRY":
        await this.revertOrRetry(row, "SERVER_TEMPORARY", result.message ?? "", report, result.code);
        return { moved: false };
      case "REJECTED": {
        const type = result.errorType ?? "VALIDATION";
        if (type === "AUTH") {
          await db.patchMutation(row.id, { state: "PENDING" });
          return { moved: false, stop: "paused-auth" };
        }
        if (type === "UNSUPPORTED_VERSION") {
          await db.patchMutation(row.id, { state: "PENDING" });
          return { moved: false, stop: "paused-update" };
        }
        await db.patchMutation(row.id, { state: "FAILED", errorType: type, errorCode: result.code }, { errorMessage: result.message });
        report.failed += 1;
        return { moved: true };
      }
    }
  }

  /** Tracks the record's identity and version after the server applied a change (§35, §81). */
  private async recordVersion(row: MutationRecord, result: SyncOperationResult): Promise<void> {
    const db = this.options.db;
    if (!result.canonicalEntityId) return;
    if (row.type === "SITE_DIARY_CREATE") {
      const version = result.serverVersion ?? null;
      await db.putEntity({ localId: row.targetId, serverId: result.canonicalEntityId, version, foreign: false });
      if (row.targetId !== result.canonicalEntityId) await db.putEntity({ localId: result.canonicalEntityId, serverId: result.canonicalEntityId, version, foreign: false });
      return;
    }
    if (row.type === "TASK_COMMENT_CREATE" || row.type === "HSE_CREATE") return;
    await this.trackVersion(row.targetId, result.canonicalEntityId, result.serverVersion ?? null, result.result === "DUPLICATE");
  }

  /** The device's own change moves a version by exactly one; any larger jump means someone else changed the record too. */
  async trackVersion(targetId: string, serverId: string, version: number | null, duplicate = false): Promise<void> {
    const db = this.options.db;
    const existing = (await db.getEntity(targetId)) ?? (await db.getEntity(serverId));
    const previous = existing?.version ?? null;
    const foreign = Boolean(existing?.foreign) || (!duplicate && previous !== null && version !== null && version > previous + 1);
    const record = { localId: targetId, serverId, version: version ?? previous, foreign };
    await db.putEntity(record);
    if (targetId !== serverId) await db.putEntity({ ...record, localId: serverId });
  }

  private async revertOrRetry(row: MutationRecord, errorType: SyncErrorType, message: string, report: SyncReport, code?: string): Promise<void> {
    const db = this.options.db;
    if (errorType === "AUTH" || errorType === "UNSUPPORTED_VERSION") {
      await db.patchMutation(row.id, { state: "PENDING" });
      return;
    }
    if (isAutomaticallyRetryable(errorType)) {
      const retryCount = row.retryCount + (errorType === "SERVER_TEMPORARY" ? 1 : 0);
      if (retryCount > MAX_AUTOMATIC_RETRIES) {
        await db.patchMutation(row.id, { state: "FAILED", errorType, errorCode: code, retryCount }, { errorMessage: message || "The server could not finish this." });
        report.failed += 1;
        return;
      }
      await db.patchMutation(row.id, { state: "PENDING", retryCount, nextAttemptAt: this.now + backoffDelay(retryCount) });
      report.retrying += 1;
      return;
    }
    await db.patchMutation(row.id, { state: "FAILED", errorType, errorCode: code }, { errorMessage: message });
    report.failed += 1;
  }

  /* Photos ------------------------------------------------------------------ */

  private async sendFile(row: MutationRecord, report: SyncReport): Promise<{ moved: boolean; stop?: SyncStatus }> {
    const db = this.options.db;
    const target = await this.resolveTarget(row);
    const files = await db.listFiles();
    const file = files.find((entry) => entry.record.mutationId === row.id);
    if (!target || !file) {
      if (!file) {
        // Nothing left to send: the photo was removed by the person.
        await db.removeMutation(row.id);
        return { moved: true };
      }
      await db.patchMutation(row.id, { nextAttemptAt: this.now + backoffDelay(row.retryCount) });
      return { moved: false };
    }
    await db.patchMutation(row.id, { state: "SYNCING" });
    const uploader = this.options.uploader ?? uploadPendingFile;
    let outcome: UploadOutcome;
    try {
      outcome = await uploader(db, file.record.id, { kind: "daily_log", dailyLogId: target.serverId }, row.projectId ?? "");
    } catch {
      outcome = { ok: false, errorType: "NETWORK", code: "NETWORK", message: "The connection dropped." };
    }

    if (outcome.ok) {
      if (outcome.version !== undefined) await this.trackVersion(row.targetId, target.serverId, outcome.version);
      await db.removeFile(file.record.id);
      await db.removeMutation(row.id);
      report.applied += 1;
      return { moved: true };
    }
    await db.patchFile(file.record.id, { state: outcome.errorType === "NETWORK" || outcome.errorType === "SERVER_TEMPORARY" ? "PENDING" : "FAILED" }, { errorMessage: outcome.message });
    if (outcome.errorType === "NETWORK") {
      await db.patchMutation(row.id, { state: "PENDING", nextAttemptAt: this.now + backoffDelay(row.retryCount) });
      this.options.reportUnreachable?.();
      return { moved: false, stop: "offline" };
    }
    if (outcome.errorType === "AUTH") {
      await db.patchMutation(row.id, { state: "PENDING" });
      return { moved: false, stop: "paused-auth" };
    }
    await this.revertOrRetry(row, outcome.errorType, outcome.message, report, outcome.code);
    if (outcome.errorType === "PERMISSION" || outcome.errorType === "FILE_ERROR") await db.patchMutation(row.id, {}, { errorMessage: outcome.message });
    return { moved: false };
  }
}
