import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { OfflineDatabase } from "@/lib/offline/database";
import { listOfflineDocuments, checkDocumentVersions, removeOfflineDocument } from "@/lib/offline/documents";
import { downloadProject, handleRevokedProject, prepareProject, refreshOfflineProjects, removeProjectDownload, UnsyncedWorkError } from "@/lib/offline/projects";
import { enqueue } from "@/lib/offline/queue";

/** Offline projects and documents (MOB-09 §7-§18, §58, §59, §93, §94), against a stand-in for the package endpoints. */

type Entry = { id: string; token: string; data: unknown };
const delta = (upserts: Entry[] = [], removed: string[] = []) => ({ upserts, removed });

function pkg(over: { tasks?: Entry[]; removedTasks?: string[]; documents?: Entry[] } = {}) {
  return {
    protocolVersion: 1,
    serverTime: "2026-09-30T10:00:00Z",
    project: { id: "p1", code: "EOT", name: "Eyes of Tirana" },
    authorization: { workspace: { companyId: "c1" } },
    diary: { today: "2026-09-30", canCreate: true },
    entities: { tasks: delta(over.tasks, over.removedTasks), units: delta(), dailyLogs: delta(), dailyLogDrafts: delta(), documents: delta(over.documents), comments: delta() },
  };
}

const doc = (version: number, over: Record<string, unknown> = {}) => ({ documentId: "d1", name: "Facade Detail.pdf", fileName: "facade.pdf", mimeType: "application/pdf", sizeBytes: "5", current: { versionId: `v${version}`, versionNumber: version, checksumSha256: null, supersededAt: null, updatedAt: "2026-09-28T16:42:00Z" }, downloadable: true, archived: false, ...over });

class FakeApi {
  package = pkg();
  status = 200;
  documentVersion = 3;
  documentsAvailable = true;
  calls: string[] = [];
  bodies: unknown[] = [];
  fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    this.calls.push(url);
    if (url.includes("/package")) {
      this.bodies.push(JSON.parse(String(init?.body)));
      return this.status === 200 ? json({ data: this.package }) : new Response("{}", { status: this.status });
    }
    if (url.endsWith("/api/sync/documents")) {
      return json({ data: [{ documentId: "d1", status: this.documentsAvailable ? doc(this.documentVersion) : null }] });
    }
    if (url.includes("/versions/") && url.endsWith("/download")) return json({ data: { url: "https://storage.test/file" } });
    if (url === "https://storage.test/file") return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

let db: OfflineDatabase;
let api: FakeApi;
beforeEach(async () => {
  db = await OfflineDatabase.openFor("u1", new IDBFactory());
  api = new FakeApi();
});

const task = (id: string, title: string) => ({ id, token: `t-${title}`, data: { id, title, status: "TODO", version: 1 } });

describe("taking a project offline", () => {
  it("estimates before it stores anything, and stores the package and chosen documents", async () => {
    api.package = pkg({ tasks: [task("t1", "Facade")], documents: [{ id: "d1", token: "x", data: doc(3) }] });
    const prepared = await prepareProject("p1", api.fetch);
    expect(prepared.estimate.dataBytes).toBeGreaterThan(100);
    expect(prepared.estimate.documents).toEqual([{ documentId: "d1", name: "Facade Detail.pdf", sizeBytes: 5, available: true }]);
    expect(await db.listProjects()).toHaveLength(0);

    await downloadProject(db, prepared, ["d1"], { fetchImpl: api.fetch, now: () => 1_000 });

    const project = await db.getProject("p1");
    expect(project?.record.status).toBe("AVAILABLE");
    expect(project?.record.lastSyncedAt).toBe(1_000);
    expect((await db.listCache("p1", "tasks")).map((row) => row.data)).toHaveLength(1);
    const stored = await db.getDocument("p1", "d1");
    expect(stored?.record.versionNumber).toBe(3);
    expect(Array.from(new Uint8Array(await stored!.bytes()))).toEqual([37, 80, 68, 70]);
  });

  it("keeps no document the person did not choose", async () => {
    api.package = pkg({ documents: [{ id: "d1", token: "x", data: doc(3) }] });
    await downloadProject(db, await prepareProject("p1", api.fetch), [], { fetchImpl: api.fetch });
    expect(await db.listDocuments("p1")).toHaveLength(0);
    expect(api.calls.some((url) => url.includes("/versions/"))).toBe(false);
  });

  it("marks a failed download Failed rather than half-available", async () => {
    api.package = pkg({ documents: [{ id: "d1", token: "x", data: doc(3) }] });
    const prepared = await prepareProject("p1", api.fetch);
    const broken = (async (input: RequestInfo | URL) => (String(input).includes("/download") ? new Response("{}", { status: 500 }) : api.fetch(input))) as typeof fetch;
    await expect(downloadProject(db, prepared, ["d1"], { fetchImpl: broken })).rejects.toBeTruthy();
    expect((await db.getProject("p1"))?.record.status).toBe("FAILED");
  });
});

describe("refreshing (§71, §72)", () => {
  async function downloaded() {
    api.package = pkg({ tasks: [task("t1", "Facade"), task("t2", "Basement")] });
    await downloadProject(db, await prepareProject("p1", api.fetch), [], { fetchImpl: api.fetch, now: () => 1 });
  }

  it("sends what the device already holds, and applies only the difference", async () => {
    await downloaded();
    api.package = pkg({ tasks: [{ id: "t1", token: "t-Facade-2", data: { id: "t1", title: "Facade (revised)", status: "TODO", version: 2 } }], removedTasks: ["t2"] });
    await refreshOfflineProjects(db, api.fetch, () => 2);

    expect((api.bodies.at(-1) as { known: { tasks: Record<string, string> } }).known.tasks).toEqual({ t1: "t-Facade", t2: "t-Basement" });
    const tasks = await db.listCache<{ title: string }>("p1", "tasks");
    expect(tasks.map((row) => row.data.title)).toEqual(["Facade (revised)"]);
    expect((await db.getProject("p1"))?.record.lastSyncedAt).toBe(2);
  });

  it("leaves the project usable as it was when the server cannot be reached", async () => {
    await downloaded();
    const offline = (async () => { throw new TypeError("network"); }) as typeof fetch;
    await expect(refreshOfflineProjects(db, offline, () => 5)).rejects.toBeTruthy();
    const project = await db.getProject("p1");
    expect(project?.record.status).toBe("AVAILABLE");
    expect(await db.listCache("p1", "tasks")).toHaveLength(2);
  });
});

describe("access revoked while offline (§58, §59)", () => {
  it("removes protected data, keeps unsynced work, and says so", async () => {
    api.package = pkg({ tasks: [task("t1", "Facade")], documents: [{ id: "d1", token: "x", data: doc(3) }] });
    await downloadProject(db, await prepareProject("p1", api.fetch), ["d1"], { fetchImpl: api.fetch });
    await enqueue(db, { type: "SITE_DIARY_CREATE", companyId: "c1", projectId: "p1", targetType: "DailyLog", targetId: "local:site-diary:x", label: "Site Diary", payload: { workDate: "2026-09-30" } });

    api.status = 404;
    await refreshOfflineProjects(db, api.fetch, () => 9);

    const project = await db.getProject("p1");
    expect(project?.body.revokedAt).toBe(9);
    expect(project?.record.status).toBe("FAILED");
    expect(await db.listCache("p1", "tasks")).toHaveLength(0);
    expect(await db.listDocuments("p1")).toHaveLength(0);
    expect(await db.listMutationRecords()).toHaveLength(1);
  });

  it("a revoked project is not refreshed again", async () => {
    api.package = pkg();
    await downloadProject(db, await prepareProject("p1", api.fetch), [], { fetchImpl: api.fetch });
    await handleRevokedProject(db, "p1", 1);
    const before = api.calls.length;
    await refreshOfflineProjects(db, api.fetch);
    expect(api.calls.length).toBe(before);
  });
});

describe("removing a download (§93, §94)", () => {
  it("is refused while the project has unsynced work, and says how much", async () => {
    api.package = pkg({ tasks: [task("t1", "Facade")] });
    await downloadProject(db, await prepareProject("p1", api.fetch), [], { fetchImpl: api.fetch });
    await enqueue(db, { type: "TASK_COMMENT_CREATE", companyId: "c1", projectId: "p1", targetType: "Task", targetId: "t1", label: "c", payload: { body: "x" } });
    await expect(removeProjectDownload(db, "p1")).rejects.toMatchObject({ count: 1 });
    await expect(removeProjectDownload(db, "p1")).rejects.toBeInstanceOf(UnsyncedWorkError);
    expect(await db.getProject("p1")).not.toBeNull();
  });

  it("removes the cache and the documents when nothing is waiting", async () => {
    api.package = pkg({ tasks: [task("t1", "Facade")], documents: [{ id: "d1", token: "x", data: doc(3) }] });
    await downloadProject(db, await prepareProject("p1", api.fetch), ["d1"], { fetchImpl: api.fetch });
    await removeProjectDownload(db, "p1");
    expect(await db.getProject("p1")).toBeNull();
    expect(await db.listCache("p1", "tasks")).toHaveLength(0);
    expect(await db.listDocuments("p1")).toHaveLength(0);
  });
});

describe("document versions (§15-§18, §156)", () => {
  async function withDocument() {
    api.package = pkg({ documents: [{ id: "d1", token: "x", data: doc(3) }] });
    await downloadProject(db, await prepareProject("p1", api.fetch), ["d1"], { fetchImpl: api.fetch, now: () => 10 });
  }

  it("is unchecked until the server has been asked, then current", async () => {
    await withDocument();
    expect((await listOfflineDocuments(db))[0]!.state).toBe("UNCHECKED");
    await checkDocumentVersions(db, api.fetch, 20);
    const [view] = await listOfflineDocuments(db);
    expect(view).toMatchObject({ state: "CURRENT", downloadedVersion: 3, currentVersion: 3, lastUpdated: 20 });
  });

  it("marks a drawing superseded when the office publishes a newer version while the device was offline", async () => {
    await withDocument();
    api.documentVersion = 4;
    await checkDocumentVersions(db, api.fetch, 30);
    expect((await listOfflineDocuments(db))[0]).toMatchObject({ state: "UPDATE_AVAILABLE", downloadedVersion: 3, currentVersion: 4 });
  });

  it("marks a document the person can no longer open as unavailable", async () => {
    await withDocument();
    api.documentsAvailable = false;
    await checkDocumentVersions(db, api.fetch, 30);
    expect((await listOfflineDocuments(db))[0]!.state).toBe("UNAVAILABLE");
  });

  it("removing a copy removes its bytes", async () => {
    await withDocument();
    await removeOfflineDocument(db, "p1", "d1");
    expect(await db.getDocument("p1", "d1")).toBeNull();
  });
});
