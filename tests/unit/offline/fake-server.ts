import type { SyncOperationEnvelope, SyncOperationResult } from "@/lib/core/sync/protocol";

/**
 * A stand-in for `/api/sync` with the behaviour the engine depends on: an
 * operation ledger, versions that move by one per change, optimistic
 * concurrency, and refusals of each class. The real dispatcher is tested
 * against the real services in tests/integration/sync.
 */

type Diary = { id: string; version: number; status: "DRAFT" | "SUBMITTED"; workDate: string; entries: number; photos: number };
type Task = { id: string; version: number; status: string };

export class FakeServer {
  userId = "u1";
  companyId = "c1";
  scope = "COMPANY";
  minimumProtocolVersion = 1;
  diaries = new Map<string, Diary>();
  tasks = new Map<string, Task>();
  comments: string[] = [];
  incidents: string[] = [];
  ledger = new Map<string, SyncOperationResult>();
  /** Operation ids to refuse, and how. */
  refuse = new Map<string, Partial<SyncOperationResult>>();
  /** When set, the next sync request is processed and then its response is lost. */
  dropNextResponse = false;
  sessionStatus = 200;
  sync: Array<SyncOperationEnvelope[]> = [];
  private seq = 0;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/sync/authorization")) {
      if (this.sessionStatus !== 200) return new Response("{}", { status: this.sessionStatus });
      return json({ data: { protocolVersion: 1, minimumProtocolVersion: this.minimumProtocolVersion, validatedAt: new Date().toISOString(), offlineAccessExpiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), user: { userId: this.userId, membershipId: "m1", fullName: "Field User" }, workspace: { parentGroupId: "g1", companyId: this.companyId, companyName: "Acme", scope: this.scope }, permissions: [], fingerprint: "f" } });
    }
    if (url.endsWith("/api/sync")) {
      const body = JSON.parse(String(init?.body)) as { operations: SyncOperationEnvelope[] };
      this.sync.push(body.operations);
      const results = body.operations.map((operation) => this.apply(operation));
      if (this.dropNextResponse) {
        this.dropNextResponse = false;
        throw new TypeError("network dropped after the server committed");
      }
      return json({ data: { protocolVersion: 1, serverTime: new Date().toISOString(), results } });
    }
    return new Response("{}", { status: 404 });
  };

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  private apply(operation: SyncOperationEnvelope): SyncOperationResult {
    const base = { operationId: operation.operationId };
    const recorded = this.ledger.get(operation.operationId);
    if (recorded) return { ...recorded, result: "DUPLICATE" };
    const refusal = this.refuse.get(operation.operationId);
    if (refusal) return { ...base, result: "REJECTED", ...refusal } as SyncOperationResult;

    let result: SyncOperationResult;
    switch (operation.type) {
      case "SITE_DIARY_CREATE": {
        const workDate = String(operation.payload.workDate);
        const existing = [...this.diaries.values()].find((diary) => diary.workDate === workDate);
        const diary = existing ?? { id: this.next("log"), version: 1, status: "DRAFT" as const, workDate, entries: 0, photos: 0 };
        this.diaries.set(diary.id, diary);
        result = { ...base, result: "APPLIED", entityType: "DailyLog", canonicalEntityId: diary.id, serverVersion: diary.version };
        break;
      }
      case "SITE_DIARY_UPDATE_DRAFT":
      case "SITE_DIARY_SUBMIT": {
        const diary = this.diaries.get(operation.target!.entityId);
        if (!diary) return { ...base, result: "REJECTED", errorType: "PERMISSION", code: "NOT_FOUND", message: "That daily log could not be found." };
        if (operation.expectedVersion !== diary.version || diary.status !== "DRAFT") {
          return { ...base, result: "CONFLICT", errorType: "CONFLICT", code: "DAILY_LOG_STALE", message: "This log changed.", current: { status: diary.status, version: diary.version } };
        }
        diary.version += 1;
        if (operation.type === "SITE_DIARY_SUBMIT") diary.status = "SUBMITTED";
        result = { ...base, result: "APPLIED", entityType: "DailyLog", canonicalEntityId: diary.id, serverVersion: diary.version };
        break;
      }
      case "SITE_DIARY_ADD_ENTRY": {
        const diary = this.diaries.get(operation.target!.entityId)!;
        diary.entries += 1;
        diary.version += 1;
        result = { ...base, result: "APPLIED", entityType: "DailyLog", canonicalEntityId: diary.id, serverVersion: diary.version };
        break;
      }
      case "TASK_COMMENT_CREATE": {
        this.comments.push(String(operation.payload.body));
        result = { ...base, result: "APPLIED", entityType: "Comment", canonicalEntityId: this.next("cmt") };
        break;
      }
      case "TASK_ALLOWED_UPDATE": {
        const task = this.tasks.get(operation.target!.entityId)!;
        if (operation.expectedVersion !== task.version) return { ...base, result: "CONFLICT", errorType: "CONFLICT", code: "TASK_STALE", message: "This task changed.", current: { status: task.status, version: task.version } };
        task.version += 1;
        task.status = operation.payload.command === "complete" ? "COMPLETED" : "IN_PROGRESS";
        result = { ...base, result: "APPLIED", entityType: "Task", canonicalEntityId: task.id, serverVersion: task.version };
        break;
      }
      case "HSE_CREATE": {
        this.incidents.push(String(operation.payload.title));
        result = { ...base, result: "APPLIED", entityType: "HseIncident", canonicalEntityId: this.next("hse") };
        break;
      }
    }
    this.ledger.set(operation.operationId, result);
    return result;
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
