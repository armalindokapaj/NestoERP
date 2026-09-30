import type { KnownTokens, PackageKind, ProjectPackage } from "@/lib/core/sync/package.service";

import type { OfflineDatabase } from "./database";
import { checkDocumentVersions, storeDocumentFile } from "./documents";
import { ProjectAccessError } from "./errors";
import type { CacheKind, OfflineProjectBody, OfflineProjectStatus } from "./types";

/**
 * Offline Projects (MOB-09 §7-§13, §71, §89-§94).
 *
 * A project is on the device because its user chose "Available Offline", and
 * only what the package holds. The package is read through the ordinary
 * services on the server, so it can never hold more than the project page
 * would show this person.
 */

export type PackageEstimate = {
  /** The project's data as sent, in bytes. */
  dataBytes: number;
  documents: Array<{ documentId: string; name: string; sizeBytes: number; available: boolean }>;
  documentBytes: number;
};

export type PreparedProject = { package: ProjectPackage; estimate: PackageEstimate };

async function fetchPackage(projectId: string, known: KnownTokens, fetchImpl: typeof fetch): Promise<{ package: ProjectPackage; bytes: number }> {
  const response = await fetchImpl(`/api/sync/projects/${encodeURIComponent(projectId)}/package`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ known }),
  });
  if (!response.ok) throw new ProjectAccessError(response.status);
  const text = await response.text();
  return { package: (JSON.parse(text) as { data: ProjectPackage }).data, bytes: new TextEncoder().encode(text).byteLength };
}

/** Step 1 of "Available Offline": work out what it would take, and store nothing yet (§10, §12). */
export async function prepareProject(projectId: string, fetchImpl: typeof fetch = fetch): Promise<PreparedProject> {
  const { package: pkg, bytes } = await fetchPackage(projectId, {}, fetchImpl);
  const documents = pkg.entities.documents.upserts.map((entry) => {
    const data = entry.data as { documentId: string; name: string; sizeBytes: string | null; downloadable: boolean };
    return { documentId: data.documentId, name: data.name, sizeBytes: Number(data.sizeBytes ?? 0), available: data.downloadable };
  });
  return { package: pkg, estimate: { dataBytes: bytes, documents, documentBytes: documents.reduce((sum, doc) => sum + doc.sizeBytes, 0) } };
}

const KIND_TO_CACHE: Record<PackageKind, CacheKind> = {
  tasks: "tasks",
  units: "units",
  dailyLogs: "dailyLogs",
  dailyLogDrafts: "dailyLogDrafts",
  documents: "documents",
  comments: "comments",
};

async function applyPackage(db: OfflineDatabase, pkg: ProjectPackage, tokens: OfflineProjectBody["tokens"], now: number): Promise<void> {
  const companyId = pkg.authorization.workspace.companyId;
  const projectId = pkg.project.id;
  for (const kind of Object.keys(pkg.entities) as PackageKind[]) {
    const delta = pkg.entities[kind];
    tokens[kind] ??= {};
    for (const entry of delta.upserts) {
      await db.putCache({ companyId, projectId, kind: KIND_TO_CACHE[kind], id: entry.id, token: entry.token, syncState: "SYNCED", lastSyncedAt: now }, entry.data);
      tokens[kind]![entry.id] = entry.token;
    }
    for (const id of delta.removed) {
      await db.removeCache(projectId, KIND_TO_CACHE[kind], id);
      delete tokens[kind]![id];
    }
  }
}

export type DownloadProgress = { phase: "data" | "documents" | "done"; done: number; total: number };

/**
 * Step 2: keep the package and the documents the person chose (§10, §13).
 * The project shows as downloading until everything is stored and checked; a
 * failure leaves it "Failed", never half-available (§11).
 */
export async function downloadProject(
  db: OfflineDatabase,
  prepared: PreparedProject,
  selectedDocumentIds: string[],
  options: { fetchImpl?: typeof fetch; now?: () => number; onProgress?: (progress: DownloadProgress) => void } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = (options.now ?? Date.now)();
  const pkg = prepared.package;
  const projectId = pkg.project.id;
  const companyId = pkg.authorization.workspace.companyId;
  const tokens: OfflineProjectBody["tokens"] = {};
  const base = { userId: db.userId, companyId, projectId, sizeBytes: prepared.estimate.dataBytes };
  const body = (extra: Partial<OfflineProjectBody> = {}): OfflineProjectBody => ({ name: pkg.project.name, code: pkg.project.code, tokens, diary: pkg.diary, ...extra });
  const setStatus = (status: OfflineProjectStatus, extra?: Partial<OfflineProjectBody>, lastSyncedAt: number | null = null) => db.putProject({ ...base, status, lastSyncedAt }, body(extra));

  await setStatus("PREPARING");
  try {
    await setStatus("DOWNLOADING");
    options.onProgress?.({ phase: "data", done: 0, total: 1 });
    await applyPackage(db, pkg, tokens, now);
    options.onProgress?.({ phase: "data", done: 1, total: 1 });

    const chosen = prepared.estimate.documents.filter((doc) => selectedDocumentIds.includes(doc.documentId) && doc.available);
    let done = 0;
    for (const doc of chosen) {
      options.onProgress?.({ phase: "documents", done, total: chosen.length });
      const entry = pkg.entities.documents.upserts.find((candidate) => candidate.id === doc.documentId);
      const status = entry?.data as { name: string; fileName: string | null; mimeType: string | null; current: { versionId: string; versionNumber: number; updatedAt: string } | null };
      if (!status?.current) continue;
      await storeDocumentFile(db, { projectId, companyId, documentId: doc.documentId, name: status.name, fileName: status.fileName ?? status.name, mime: status.mimeType ?? "application/octet-stream", current: status.current }, fetchImpl, now);
      done += 1;
    }
    options.onProgress?.({ phase: "done", done, total: chosen.length });
    await setStatus("AVAILABLE", undefined, now);
  } catch (error) {
    await setStatus("FAILED", { errorMessage: error instanceof ProjectAccessError ? error.message : "The download did not finish. Try again." });
    throw error;
  }
}

/** What a project's access loss does on the device: protected data goes, unsynced work stays (§58, §59). */
export async function handleRevokedProject(db: OfflineDatabase, projectId: string, now: number): Promise<void> {
  const current = await db.getProject(projectId);
  await db.clearProjectCache(projectId);
  for (const doc of await db.listDocuments(projectId)) await db.removeDocument(projectId, doc.record.documentId);
  if (current) await db.putProject({ ...current.record, status: "FAILED", sizeBytes: 0, lastSyncedAt: current.record.lastSyncedAt }, { ...current.body, tokens: {}, revokedAt: now, errorMessage: "Your access to this project has changed." });
}

/** The engine's pull: what changed since last time, for every project on the device (§70, §71, §139). */
export async function refreshOfflineProjects(db: OfflineDatabase, fetchImpl: typeof fetch, now: () => number = Date.now, only?: string): Promise<void> {
  for (const { record, body } of await db.listProjects()) {
    if (only && record.projectId !== only) continue;
    if (record.status === "FAILED" || record.status === "DOWNLOADING" || record.status === "PREPARING" || body.revokedAt) continue;
    await db.putProject({ ...record, status: "UPDATING" }, body);
    try {
      const { package: pkg } = await fetchPackage(record.projectId, body.tokens, fetchImpl);
      const tokens = body.tokens;
      await applyPackage(db, pkg, tokens, now());
      await db.putProject({ ...record, status: "AVAILABLE", lastSyncedAt: now() }, { ...body, tokens, diary: pkg.diary, name: pkg.project.name, code: pkg.project.code });
    } catch (error) {
      if (error instanceof ProjectAccessError && (error.status === 403 || error.status === 404)) {
        await handleRevokedProject(db, record.projectId, now());
      } else {
        // Offline again, or the server is busy: the project stays usable as it was.
        await db.putProject(record, body);
        throw error;
      }
    }
  }
  await checkDocumentVersions(db, fetchImpl, now());
}

export class UnsyncedWorkError extends Error {
  constructor(readonly count: number) {
    super(`This project has ${count} unsynced item(s).`);
  }
}

/**
 * "Remove Download" (§93, §94). The cached copy and the downloaded documents go;
 * unsynced changes, captured photos and unresolved conflicts never do — removal
 * is refused while any exist, and says how many.
 */
export async function removeProjectDownload(db: OfflineDatabase, projectId: string): Promise<void> {
  const unsynced = (await db.listMutationRecords()).filter((row) => row.projectId === projectId).length;
  if (unsynced > 0) throw new UnsyncedWorkError(unsynced);
  await db.clearProjectCache(projectId);
  for (const doc of await db.listDocuments(projectId)) await db.removeDocument(projectId, doc.record.documentId);
  await db.removeProject(projectId);
}
