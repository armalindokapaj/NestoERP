import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { MIGRATIONS, OfflineDatabase, OFFLINE_SCHEMA_VERSION } from "@/lib/offline/database";
import { destroyKey } from "@/lib/offline/keys";

/** The offline database (MOB-09 §19, §63, §99, §104, §107): persistence, sealing, per-user isolation. */

const body = { label: "Site diary", payload: { workDate: "2026-09-30", summary: "Poured slab B" }, expectedVersion: null, carry: false };
const mutation = (id: string, userId = "u1") => ({
  id, companyId: "c1", projectId: "p1", type: "SITE_DIARY_CREATE" as const, targetType: "DailyLog", targetId: `local:site-diary:${id}`,
  dependsOn: [], state: "PENDING" as const, retryCount: 0, nextAttemptAt: 0, createdAt: Date.now(), userId,
});

describe("OfflineDatabase", () => {
  it("keeps a pending mutation across a close and reopen (app restart)", async () => {
    const factory = new IDBFactory();
    const first = await OfflineDatabase.openFor("u1", factory);
    await first.putMutation(mutation("op-1"), body);
    first.close();

    const second = await OfflineDatabase.openFor("u1", factory);
    const stored = await second.getMutation("op-1");
    expect(stored?.record.state).toBe("PENDING");
    expect(stored?.body.payload.summary).toBe("Poured slab B");
    expect(second.version).toBe(OFFLINE_SCHEMA_VERSION);
  });

  it("does not store business content in the clear", async () => {
    const factory = new IDBFactory();
    const db = await OfflineDatabase.openFor("u1", factory);
    await db.putMutation(mutation("op-2"), body);
    const raw = await new Promise<unknown>((resolve) => {
      const open = factory.open("nesto-offline:u1");
      open.onsuccess = () => {
        const get = open.result.transaction("mutations").objectStore("mutations").get("op-2");
        get.onsuccess = () => resolve(get.result);
      };
    });
    expect(JSON.stringify(raw, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? "[bytes]" : v))).not.toContain("Poured slab B");
  });

  it("isolates two people on one device", async () => {
    const factory = new IDBFactory();
    const a = await OfflineDatabase.openFor("userA", factory);
    const b = await OfflineDatabase.openFor("userB", factory);
    await a.putMutation(mutation("op-a", "userA"), body);
    expect(await b.listMutationRecords()).toHaveLength(0);
    expect(await a.listMutationRecords()).toHaveLength(1);
  });

  it("cannot read sealed data once its key is destroyed", async () => {
    const factory = new IDBFactory();
    const db = await OfflineDatabase.openFor("u9", factory);
    await db.putMutation(mutation("op-9", "u9"), body);
    db.close();
    await destroyKey("u9", factory);
    const reopened = await OfflineDatabase.openFor("u9", factory);
    await expect(reopened.getMutation("op-9")).rejects.toBeTruthy();
  });

  it("clearing a project cache keeps local-only records", async () => {
    const db = await OfflineDatabase.openFor("u1", new IDBFactory());
    const base = { companyId: "c1", projectId: "p1", token: "t", lastSyncedAt: 1 };
    await db.putCache({ ...base, kind: "tasks", id: "t1", syncState: "SYNCED" }, { title: "Synced" });
    await db.putCache({ ...base, kind: "dailyLogDrafts", id: "local:site-diary:x", syncState: "LOCAL_ONLY" }, { summary: "mine" });
    await db.clearProjectCache("p1");
    expect(await db.getCache("p1", "tasks", "t1")).toBeNull();
    expect(await db.getCache("p1", "dailyLogDrafts", "local:site-diary:x")).not.toBeNull();
  });

  it("round-trips a pending photo's bytes", async () => {
    const db = await OfflineDatabase.openFor("u1", new IDBFactory());
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await db.putFile({ id: "f1", companyId: "c1", projectId: "p1", mutationId: "m1", state: "PENDING", uploadKey: "upl_1", size: 4, createdAt: 1, progress: 0 }, { name: "a.jpg", mime: "image/jpeg", category: "PHOTO", caption: null, takenTime: null }, bytes);
    const file = await db.getFile("f1");
    expect(Array.from(new Uint8Array(file!.bytes))).toEqual([1, 2, 3, 4]);
    expect(file!.body.name).toBe("a.jpg");
  });

  describe("schema migration (§107)", () => {
    const v2 = { 1: MIGRATIONS[1]!, 2: (_db: IDBDatabase, tx: IDBTransaction) => { tx.objectStore("mutations").createIndex("byCompany", "companyId"); } };

    it("upgrades v1 to v2 and keeps the pending change and photo", async () => {
      const factory = new IDBFactory();
      const old = await OfflineDatabase.openFor("u1", factory);
      await old.putMutation(mutation("op-1"), body);
      await old.putFile({ id: "f1", companyId: "c1", projectId: "p1", mutationId: "op-1", state: "PENDING", uploadKey: "upl_1", size: 2, createdAt: 1, progress: 0 }, { name: "a.jpg", mime: "image/jpeg", category: "PHOTO", caption: null, takenTime: null }, new Uint8Array([9, 8]).buffer);
      old.close();

      const upgraded = await OfflineDatabase.openFor("u1", factory, { version: 2, migrations: v2 });
      expect(upgraded.version).toBe(2);
      expect((await upgraded.getMutation("op-1"))?.body.payload.summary).toBe("Poured slab B");
      expect(Array.from(new Uint8Array((await upgraded.getFile("f1"))!.bytes))).toEqual([9, 8]);
    });

    it("a failed migration surfaces and leaves the stored work intact", async () => {
      const factory = new IDBFactory();
      const old = await OfflineDatabase.openFor("u1", factory);
      await old.putMutation(mutation("op-1"), body);
      old.close();

      const broken = { 1: MIGRATIONS[1]!, 2: () => { throw new Error("bad migration"); } };
      await expect(OfflineDatabase.openFor("u1", factory, { version: 2, migrations: broken })).rejects.toBeTruthy();

      const again = await OfflineDatabase.openFor("u1", factory);
      expect(again.version).toBe(1);
      expect((await again.getMutation("op-1"))?.record.state).toBe("PENDING");
    });
  });
});
