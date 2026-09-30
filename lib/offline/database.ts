import { open, openJson, seal, sealJson, type Sealed } from "./crypto";
import { committed, openDatabase, request } from "./idb";
import { databaseKey } from "./keys";
import type {
  CacheRecord,
  DownloadedDocumentBody,
  DownloadedDocumentRecord,
  IdMapRecord,
  MetaRecord,
  MutationBody,
  MutationRecord,
  OfflineProjectBody,
  OfflineProjectRecord,
  PendingFileBody,
  PendingFileRecord,
} from "./types";

/**
 * The offline database (MOB-09 §19-§21, §106-§108).
 *
 * One IndexedDB per signed-in person (`nesto-offline:<userId>`): identities on
 * one device share nothing, and a query never has to remember to filter by
 * user (§99, §100). The schema is versioned explicitly; an upgrade runs
 * `MIGRATIONS[n]` in order and never drops a store that holds pending work.
 */

export const OFFLINE_SCHEMA_VERSION = 1;

export const STORES = {
  cache: "cache",
  mutations: "mutations",
  files: "files",
  projects: "projects",
  documents: "documents",
  idmap: "idmap",
  meta: "meta",
} as const;

/** Schema steps by the version they produce. Each only adds; none may discard pending work. */
export const MIGRATIONS: Record<number, (db: IDBDatabase, tx: IDBTransaction) => void> = {
  1: (db) => {
    const cache = db.createObjectStore(STORES.cache, { keyPath: ["projectId", "kind", "id"] });
    cache.createIndex("byProject", "projectId");
    const mutations = db.createObjectStore(STORES.mutations, { keyPath: "id" });
    mutations.createIndex("byState", "state");
    mutations.createIndex("byTarget", "targetId");
    mutations.createIndex("byProject", "projectId");
    const files = db.createObjectStore(STORES.files, { keyPath: "id" });
    files.createIndex("byMutation", "mutationId");
    files.createIndex("byProject", "projectId");
    db.createObjectStore(STORES.projects, { keyPath: "projectId" });
    const documents = db.createObjectStore(STORES.documents, { keyPath: ["projectId", "documentId"] });
    documents.createIndex("byProject", "projectId");
    db.createObjectStore(STORES.idmap, { keyPath: "localId" });
    db.createObjectStore(STORES.meta, { keyPath: "key" });
  },
};

export function databaseName(userId: string): string {
  return `nesto-offline:${userId}`;
}

type Migrations = Record<number, (db: IDBDatabase, tx: IDBTransaction) => void>;

function upgradeWith(migrations: Migrations, target: number) {
  return (db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void => {
    for (let version = oldVersion + 1; version <= target; version += 1) migrations[version]!(db, tx);
  };
}

export class OfflineDatabase {
  private constructor(
    readonly userId: string,
    private readonly db: IDBDatabase,
    private readonly key: CryptoKey,
  ) {}

  /** Opens (creating or migrating) the person's database. A failed migration surfaces; it never recreates a store with work in it (§108). */
  static async openFor(userId: string, factory?: IDBFactory, schema: { version: number; migrations: Migrations } = { version: OFFLINE_SCHEMA_VERSION, migrations: MIGRATIONS }): Promise<OfflineDatabase> {
    const key = await databaseKey(userId, factory);
    const db = await openDatabase(databaseName(userId), schema.version, upgradeWith(schema.migrations, schema.version), factory);
    return new OfflineDatabase(userId, db, key);
  }

  close(): void {
    this.db.close();
  }

  get version(): number {
    return this.db.version;
  }

  /* Sealing ---------------------------------------------------------------- */
  sealJson = (value: unknown): Promise<Sealed> => sealJson(this.key, value);
  openJson = <T>(sealed: Sealed): Promise<T> => openJson<T>(this.key, sealed);
  private sealBytes = (bytes: ArrayBuffer): Promise<Sealed> => seal(this.key, bytes);
  private openBytes = (sealed: Sealed): Promise<ArrayBuffer> => open(this.key, sealed);

  /* Generic helpers -------------------------------------------------------- */
  private async getAll<T>(store: string, index?: string, query?: IDBValidKey): Promise<T[]> {
    const source = this.db.transaction(store, "readonly").objectStore(store);
    return (await request((index ? source.index(index) : source).getAll(query))) as T[];
  }
  private async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return (await request(this.db.transaction(store, "readonly").objectStore(store).get(key))) as T | undefined;
  }
  private async put(store: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await committed(tx);
  }
  private async remove(store: string, key: IDBValidKey): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await committed(tx);
  }
  async count(store: string): Promise<number> {
    return request(this.db.transaction(store, "readonly").objectStore(store).count());
  }

  /* Metadata --------------------------------------------------------------- */
  async getMeta<T>(key: string): Promise<T | null> {
    const row = await this.get<MetaRecord>(STORES.meta, key);
    return row ? this.openJson<T>(row.sealed) : null;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.put(STORES.meta, { key, sealed: await this.sealJson(value) } satisfies MetaRecord);
  }

  /* Server cache ----------------------------------------------------------- */
  async putCache<T>(input: Omit<CacheRecord, "sealed" | "userId">, data: T): Promise<void> {
    await this.put(STORES.cache, { ...input, userId: this.userId, sealed: await this.sealJson(data) } satisfies CacheRecord);
  }
  async getCache<T>(projectId: string, kind: CacheRecord["kind"], id: string): Promise<{ record: CacheRecord; data: T } | null> {
    const record = await this.get<CacheRecord>(STORES.cache, [projectId, kind, id]);
    return record ? { record, data: await this.openJson<T>(record.sealed) } : null;
  }
  async listCache<T>(projectId: string, kind: CacheRecord["kind"]): Promise<Array<{ record: CacheRecord; data: T }>> {
    const rows = (await this.getAll<CacheRecord>(STORES.cache, "byProject", projectId)).filter((row) => row.kind === kind);
    return Promise.all(rows.map(async (record) => ({ record, data: await this.openJson<T>(record.sealed) })));
  }
  async removeCache(projectId: string, kind: CacheRecord["kind"], id: string): Promise<void> {
    await this.remove(STORES.cache, [projectId, kind, id]);
  }
  /** Deletes synchronised cache for a project. Local-only records are the user's unsynced work and stay. */
  async clearProjectCache(projectId: string): Promise<void> {
    const rows = await this.getAll<CacheRecord>(STORES.cache, "byProject", projectId);
    const tx = this.db.transaction(STORES.cache, "readwrite");
    for (const row of rows) if (row.syncState === "SYNCED" || row.syncState === "STALE") tx.objectStore(STORES.cache).delete([row.projectId, row.kind, row.id]);
    await committed(tx);
  }

  /* Mutations -------------------------------------------------------------- */
  async putMutation(record: Omit<MutationRecord, "sealed" | "userId">, body: MutationBody): Promise<void> {
    await this.put(STORES.mutations, { ...record, userId: this.userId, sealed: await this.sealJson(body) } satisfies MutationRecord);
  }
  async patchMutation(id: string, patch: Partial<Omit<MutationRecord, "sealed" | "id" | "userId">>, body?: Partial<MutationBody>): Promise<void> {
    const current = await this.get<MutationRecord>(STORES.mutations, id);
    if (!current) return;
    const nextBody = body ? { ...(await this.openJson<MutationBody>(current.sealed)), ...body } : null;
    await this.put(STORES.mutations, { ...current, ...patch, sealed: nextBody ? await this.sealJson(nextBody) : current.sealed });
  }
  async getMutation(id: string): Promise<{ record: MutationRecord; body: MutationBody } | null> {
    const record = await this.get<MutationRecord>(STORES.mutations, id);
    return record ? { record, body: await this.openJson<MutationBody>(record.sealed) } : null;
  }
  async listMutations(): Promise<Array<{ record: MutationRecord; body: MutationBody }>> {
    const rows = (await this.getAll<MutationRecord>(STORES.mutations)).sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(rows.map(async (record) => ({ record, body: await this.openJson<MutationBody>(record.sealed) })));
  }
  async listMutationRecords(): Promise<MutationRecord[]> {
    return (await this.getAll<MutationRecord>(STORES.mutations)).sort((a, b) => a.createdAt - b.createdAt);
  }
  async removeMutation(id: string): Promise<void> {
    await this.remove(STORES.mutations, id);
  }

  /* Files ------------------------------------------------------------------ */
  async putFile(record: Omit<PendingFileRecord, "sealed" | "userId">, body: PendingFileBody, bytes?: ArrayBuffer, existingBytes?: Sealed): Promise<void> {
    const fileRow = { ...record, userId: this.userId, sealed: await this.sealJson(body) } satisfies PendingFileRecord;
    const sealedBytes = bytes ? await this.sealBytes(bytes) : existingBytes;
    const tx = this.db.transaction([STORES.files], "readwrite");
    tx.objectStore(STORES.files).put({ ...fileRow, bytes: sealedBytes });
    await committed(tx);
  }
  async getFile(id: string): Promise<{ record: PendingFileRecord; body: PendingFileBody; bytes: ArrayBuffer } | null> {
    const row = await this.get<PendingFileRecord & { bytes: Sealed }>(STORES.files, id);
    if (!row) return null;
    return { record: row, body: await this.openJson<PendingFileBody>(row.sealed), bytes: await this.openBytes(row.bytes) };
  }
  async patchFile(id: string, patch: Partial<Pick<PendingFileRecord, "state" | "progress">>, body?: Partial<PendingFileBody>): Promise<void> {
    const row = await this.get<PendingFileRecord & { bytes: Sealed }>(STORES.files, id);
    if (!row) return;
    const nextBody = body ? { ...(await this.openJson<PendingFileBody>(row.sealed)), ...body } : null;
    await this.put(STORES.files, { ...row, ...patch, sealed: nextBody ? await this.sealJson(nextBody) : row.sealed });
  }
  async listFiles(): Promise<Array<{ record: PendingFileRecord; body: PendingFileBody }>> {
    const rows = (await this.getAll<PendingFileRecord>(STORES.files)).sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(rows.map(async (record) => ({ record, body: await this.openJson<PendingFileBody>(record.sealed) })));
  }
  async removeFile(id: string): Promise<void> {
    await this.remove(STORES.files, id);
  }

  /* Offline projects ------------------------------------------------------- */
  async putProject(record: Omit<OfflineProjectRecord, "sealed" | "userId">, body: OfflineProjectBody): Promise<void> {
    await this.put(STORES.projects, { ...record, userId: this.userId, sealed: await this.sealJson(body) } satisfies OfflineProjectRecord);
  }
  async getProject(projectId: string): Promise<{ record: OfflineProjectRecord; body: OfflineProjectBody } | null> {
    const record = await this.get<OfflineProjectRecord>(STORES.projects, projectId);
    return record ? { record, body: await this.openJson<OfflineProjectBody>(record.sealed) } : null;
  }
  async listProjects(): Promise<Array<{ record: OfflineProjectRecord; body: OfflineProjectBody }>> {
    const rows = await this.getAll<OfflineProjectRecord>(STORES.projects);
    return Promise.all(rows.map(async (record) => ({ record, body: await this.openJson<OfflineProjectBody>(record.sealed) })));
  }
  async removeProject(projectId: string): Promise<void> {
    await this.remove(STORES.projects, projectId);
  }

  /* Downloaded documents --------------------------------------------------- */
  async putDocument(record: Omit<DownloadedDocumentRecord, "sealed" | "bytes" | "userId">, body: DownloadedDocumentBody, bytes: ArrayBuffer): Promise<void> {
    await this.put(STORES.documents, { ...record, userId: this.userId, sealed: await this.sealJson(body), bytes: await this.sealBytes(bytes) } satisfies DownloadedDocumentRecord);
  }
  async getDocument(projectId: string, documentId: string): Promise<{ record: DownloadedDocumentRecord; body: DownloadedDocumentBody; bytes: () => Promise<ArrayBuffer> } | null> {
    const record = await this.get<DownloadedDocumentRecord>(STORES.documents, [projectId, documentId]);
    return record ? { record, body: await this.openJson<DownloadedDocumentBody>(record.sealed), bytes: () => this.openBytes(record.bytes) } : null;
  }
  async listDocuments(projectId?: string): Promise<Array<{ record: DownloadedDocumentRecord; body: DownloadedDocumentBody }>> {
    const rows = projectId ? await this.getAll<DownloadedDocumentRecord>(STORES.documents, "byProject", projectId) : await this.getAll<DownloadedDocumentRecord>(STORES.documents);
    return Promise.all(rows.map(async (record) => ({ record, body: await this.openJson<DownloadedDocumentBody>(record.sealed) })));
  }
  async removeDocument(projectId: string, documentId: string): Promise<void> {
    await this.remove(STORES.documents, [projectId, documentId]);
  }

  /* Local → server identity and version tracking -------------------------- */
  async putEntity(record: IdMapRecord): Promise<void> {
    await this.put(STORES.idmap, record);
  }
  async getEntity(id: string): Promise<IdMapRecord | null> {
    return (await this.get<IdMapRecord>(STORES.idmap, id)) ?? null;
  }
  async listEntities(): Promise<IdMapRecord[]> {
    return this.getAll<IdMapRecord>(STORES.idmap);
  }
  async removeEntity(id: string): Promise<void> {
    await this.remove(STORES.idmap, id);
  }

  /* Sizes ------------------------------------------------------------------ */
  /** Bytes held, by concern, for Offline & Storage (§91). Sealed sizes, which is what the device stores. */
  async usage(): Promise<{ projects: Record<string, number>; pendingFiles: number; cache: number }> {
    const projects: Record<string, number> = {};
    const add = (id: string, n: number) => void (projects[id] = (projects[id] ?? 0) + n);
    for (const row of await this.getAll<CacheRecord>(STORES.cache)) add(row.projectId, row.sealed.ct.byteLength);
    for (const row of await this.getAll<DownloadedDocumentRecord>(STORES.documents)) add(row.projectId, row.size);
    let pendingFiles = 0;
    for (const row of await this.getAll<PendingFileRecord>(STORES.files)) pendingFiles += row.size;
    return { projects, pendingFiles, cache: 0 };
  }
}
