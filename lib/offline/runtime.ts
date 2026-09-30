import { getPlatformServices } from "@/lib/device/registry";

import { connectivity } from "./connectivity";
import { OfflineDatabase } from "./database";
import { collectDiagnostics, type SyncDiagnostics } from "./diagnostics";
import { SyncEngine, type SyncStatus } from "./engine";
import { requestPersistentStorage, storageEstimate } from "./idb";
import { sweepOrphanFiles } from "./modules/diary";
import { refreshOfflineProjects } from "./projects";
import { describeQueue, unsyncedCount, type QueueSummary } from "./queue";
import { authorizationState, lastKnownUser, recordPending, rememberUser, type AuthorizationState } from "./security";
import type { OfflineProjectStatus } from "./types";

/**
 * The one place the offline layer is assembled for a signed-in person
 * (MOB-09 §142): database, engine and connectivity, plus the triggers that start
 * a pass — connection returning, the app coming to the foreground, the person
 * asking. Nothing polls. A module never starts a loop of its own (§143).
 */

export type OfflineProjectView = {
  projectId: string;
  companyId: string;
  name: string;
  code: string;
  status: OfflineProjectStatus;
  lastSyncedAt: number | null;
  sizeBytes: number;
  pending: number;
  revoked: boolean;
  message: string | null;
};

export type RuntimeState = {
  /** The database is open and the queue recovered. */
  ready: boolean;
  /** This device cannot keep offline data (no IndexedDB / WebCrypto). */
  unsupported: boolean;
  userId: string | null;
  online: boolean;
  engine: SyncStatus;
  queue: QueueSummary;
  unsynced: number;
  projects: OfflineProjectView[];
  lastSyncAt: number | null;
  authorization: AuthorizationState | null;
  /** Shown briefly when the connection returns (§25). */
  restore: "syncing" | "synced" | null;
  storage: { usage: number; quota: number } | null;
  autoSync: boolean;
};

const EMPTY_QUEUE: QueueSummary = { total: 0, pending: 0, syncing: 0, failed: 0, needsReview: 0, blocked: 0, items: [] };
const AUTO_SYNC_KEY = "nesto.offline.autoSync";

const INITIAL: RuntimeState = {
  ready: false,
  unsupported: false,
  userId: null,
  online: true,
  engine: "idle",
  queue: EMPTY_QUEUE,
  unsynced: 0,
  projects: [],
  lastSyncAt: null,
  authorization: null,
  restore: null,
  storage: null,
  autoSync: true,
};

type Listener = () => void;

export class OfflineRuntime {
  private state: RuntimeState = INITIAL;
  private listeners = new Set<Listener>();
  private db: OfflineDatabase | null = null;
  private engine: SyncEngine | null = null;
  private stops: Array<() => void> = [];
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRestorations = 0;
  private starting: Promise<void> | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getState = (): RuntimeState => this.state;
  getServerState = (): RuntimeState => INITIAL;

  private set(patch: Partial<RuntimeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  get database(): OfflineDatabase | null {
    return this.db;
  }

  /** Opens the person's database and starts listening. Safe to call again for the same person. */
  start(userId: string | null): Promise<void> {
    const id = userId ?? lastKnownUser();
    if (!id) return Promise.resolve();
    if (this.db?.userId === id) return this.starting ?? Promise.resolve();
    this.stop();
    this.starting = this.open(id).finally(() => void (this.starting = null));
    return this.starting;
  }

  private async open(userId: string): Promise<void> {
    if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) {
      this.set({ unsupported: true, userId });
      return;
    }
    try {
      this.db = await OfflineDatabase.openFor(userId);
    } catch {
      // A database that cannot be opened is reported, never silently recreated: it may hold unsynced work (§108).
      this.set({ unsupported: true, userId });
      return;
    }
    rememberUser(userId);
    const db = this.db;
    this.engine = new SyncEngine({
      db,
      isOnline: () => connectivity().getSnapshot().online,
      reportUnreachable: () => connectivity().reportUnreachable(),
      onChange: () => void this.refresh(),
      pull: (database, fetchImpl) => refreshOfflineProjects(database, fetchImpl),
    });
    await this.engine.start();
    await sweepOrphanFiles(db).catch(() => 0);
    this.set({ userId, autoSync: readAutoSync() });

    const service = connectivity();
    service.start();
    this.lastRestorations = service.getSnapshot().restorations;
    this.stops.push(
      service.subscribe(() => this.onConnectivity()),
      this.engine.subscribe(() => this.set({ engine: this.engine!.getSnapshot().status })),
    );
    try {
      this.stops.push(getPlatformServices().lifecycle.onResume(() => void this.syncNow("resume")));
    } catch {
      // No lifecycle service in a browser.
    }
    const onVisible = () => document.visibilityState === "visible" && void this.syncNow("foreground");
    document.addEventListener("visibilitychange", onVisible);
    this.stops.push(() => document.removeEventListener("visibilitychange", onVisible));

    // What the screens show is read before they are told the database is ready: a count of zero must mean none, not "not read yet".
    await this.refresh();
    this.set({ ready: true, online: service.getSnapshot().online });
    if (this.state.unsynced > 0) void requestPersistentStorage();
    void this.syncNow("start");
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.db?.close();
    this.db = null;
    this.engine = null;
    this.state = INITIAL;
    for (const listener of this.listeners) listener();
  }

  private onConnectivity(): void {
    const snapshot = connectivity().getSnapshot();
    this.set({ online: snapshot.online });
    if (snapshot.online && snapshot.restorations > this.lastRestorations) {
      this.lastRestorations = snapshot.restorations;
      void this.syncNow("connection-restored", { announce: true });
    }
  }

  setAutoSync(enabled: boolean): void {
    try {
      localStorage.setItem(AUTO_SYNC_KEY, enabled ? "1" : "0");
    } catch {
      // The choice lasts for this session only.
    }
    this.set({ autoSync: enabled });
    if (enabled) void this.syncNow("setting");
  }

  /**
   * Starts a pass now. A manual request always runs; an automatic one respects
   * the Auto Sync setting (§67, §68, §141).
   */
  async syncNow(reason: string, options: { announce?: boolean; manual?: boolean } = {}): Promise<void> {
    const engine = this.engine;
    if (!engine || !this.db) return;
    const manual = options.manual ?? reason === "manual";
    if (!manual && !this.state.autoSync) return;
    if (!connectivity().getSnapshot().online) {
      if (manual) await connectivity().check();
      if (!connectivity().getSnapshot().online) return;
    }
    if (options.announce && this.state.unsynced > 0) this.announce("syncing");
    await engine.runOnce();
    await this.refresh();
    if (options.announce && this.state.unsynced === 0) this.announce("synced");
    else if (options.announce) this.announce(null);
  }

  /** A module changed the queue: show it, and send it soon if there is a connection (§67). */
  notifyChanged(): void {
    void this.refresh();
    if (!this.state.autoSync || !connectivity().getSnapshot().online) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncNow("change"), 600);
  }

  private announce(restore: RuntimeState["restore"]): void {
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.set({ restore });
    if (restore === "synced") this.restoreTimer = setTimeout(() => this.set({ restore: null }), 4_000);
  }

  /** Rebuilds what the screens show from the database. Coalesced: bursts of change cost one read. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = this.read().finally(() => {
      this.refreshing = null;
      if (this.refreshAgain) {
        this.refreshAgain = false;
        void this.refresh();
      }
    });
    return this.refreshing;
  }

  private async read(): Promise<void> {
    const db = this.db;
    if (!db) return;
    try {
      const [queue, unsynced, projects, lastSyncAt, authorization, storage, usage] = await Promise.all([
        describeQueue(db),
        unsyncedCount(db),
        db.listProjects(),
        db.getMeta<number>("lastSyncAt"),
        authorizationState(db),
        storageEstimate(),
        db.usage(),
      ]);
      const perProject = new Map<string, number>();
      for (const item of queue.items) if (item.projectId) perProject.set(item.projectId, (perProject.get(item.projectId) ?? 0) + 1);
      recordPending(db.userId, unsynced);
      this.set({
        queue,
        unsynced,
        lastSyncAt,
        authorization,
        storage,
        projects: projects.map(({ record, body }) => ({
          projectId: record.projectId,
          companyId: record.companyId,
          name: body.name,
          code: body.code,
          status: record.status,
          lastSyncedAt: record.lastSyncedAt,
          sizeBytes: usage.projects[record.projectId] ?? record.sizeBytes,
          pending: perProject.get(record.projectId) ?? 0,
          revoked: Boolean(body.revokedAt),
          message: body.errorMessage ?? null,
        })),
      });
    } catch {
      // A read that fails leaves the screens as they were.
    }
  }

  async diagnostics(): Promise<SyncDiagnostics | null> {
    if (!this.db) return null;
    const app = await getPlatformServices().platform.appVersion().catch(() => null);
    return collectDiagnostics(this.db, { platform: getPlatformServices().platform.platform, version: app?.version ?? null });
  }

  /** Runs a change against the database, then refreshes and schedules a send. */
  async run<T>(work: (db: OfflineDatabase) => Promise<T>): Promise<T> {
    if (!this.db) throw new Error("Offline storage is not available on this device.");
    const result = await work(this.db);
    this.notifyChanged();
    return result;
  }
}

function readAutoSync(): boolean {
  try {
    return localStorage.getItem(AUTO_SYNC_KEY) !== "0";
  } catch {
    return true;
  }
}

let shared: OfflineRuntime | null = null;
export function offlineRuntime(): OfflineRuntime {
  shared ??= new OfflineRuntime();
  return shared;
}
