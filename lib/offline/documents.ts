import type { DocumentOfflineStatus } from "@/lib/modules/documents/versions/offline.service";

import type { OfflineDatabase } from "./database";
import { ProjectAccessError } from "./errors";

/**
 * Offline documents (MOB-09 §14-§18, §125).
 *
 * A downloaded file is a copy of one version. It is never presented as the
 * current file unless the server said so the last time it was asked; offline it
 * always says when it was last updated, because a drawing may have changed.
 */

export type OfflineDocumentState = "CURRENT" | "UPDATE_AVAILABLE" | "UNAVAILABLE" | "UNCHECKED";

export type OfflineDocumentView = {
  documentId: string;
  projectId: string;
  name: string;
  fileName: string;
  mime: string;
  size: number;
  downloadedVersion: number;
  currentVersion: number | null;
  /** When this copy was last confirmed as the file on the server. */
  lastUpdated: number;
  state: OfflineDocumentState;
};

type Check = { currentVersion: number | null; unavailable: boolean; checkedAt: number };
const META_KEY = "documentChecks";

/** A document's file, fetched through a short-lived grant after the server re-authorises it (§14). */
export async function storeDocumentFile(
  db: OfflineDatabase,
  input: { projectId: string; companyId: string; documentId: string; name: string; fileName: string; mime: string; current: { versionId: string; versionNumber: number; updatedAt: string } },
  fetchImpl: typeof fetch,
  now: number,
): Promise<void> {
  const grant = await fetchImpl(`/api/documents/${encodeURIComponent(input.documentId)}/versions/${encodeURIComponent(input.current.versionId)}/download`, { method: "POST" });
  if (!grant.ok) throw new ProjectAccessError(grant.status);
  const { url } = ((await grant.json()) as { data: { url: string } }).data;
  const file = await fetchImpl(url);
  if (!file.ok) throw new Error("The file could not be fetched.");
  const bytes = await file.arrayBuffer();
  await db.putDocument(
    { companyId: input.companyId, projectId: input.projectId, documentId: input.documentId, versionId: input.current.versionId, versionNumber: input.current.versionNumber, downloadedAt: now, serverUpdatedAt: input.current.updatedAt, size: bytes.byteLength },
    { name: input.name, fileName: input.fileName, mime: input.mime },
    bytes,
  );
}

/** Asks the server where each downloaded document stands now (§15, §16, §18). */
export async function checkDocumentVersions(db: OfflineDatabase, fetchImpl: typeof fetch, now: number): Promise<void> {
  const documents = await db.listDocuments();
  if (documents.length === 0) return;
  const response = await fetchImpl("/api/sync/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds: [...new Set(documents.map((doc) => doc.record.documentId))].slice(0, 100) }),
  });
  if (!response.ok) return;
  const answer = ((await response.json()) as { data: Array<{ documentId: string; status: DocumentOfflineStatus | null }> }).data;
  const checks = (await db.getMeta<Record<string, Check>>(META_KEY)) ?? {};
  for (const row of answer) {
    checks[row.documentId] = row.status
      ? { currentVersion: row.status.current?.versionNumber ?? null, unavailable: row.status.archived || !row.status.downloadable, checkedAt: now }
      : { currentVersion: null, unavailable: true, checkedAt: now };
  }
  await db.setMeta(META_KEY, checks);
}

export async function listOfflineDocuments(db: OfflineDatabase): Promise<OfflineDocumentView[]> {
  const checks = (await db.getMeta<Record<string, Check>>(META_KEY)) ?? {};
  return (await db.listDocuments()).map(({ record, body }) => {
    const check = checks[record.documentId];
    const state: OfflineDocumentState = !check ? "UNCHECKED" : check.unavailable ? "UNAVAILABLE" : check.currentVersion !== null && check.currentVersion > record.versionNumber ? "UPDATE_AVAILABLE" : "CURRENT";
    return {
      documentId: record.documentId,
      projectId: record.projectId,
      name: body.name,
      fileName: body.fileName,
      mime: body.mime,
      size: record.size,
      downloadedVersion: record.versionNumber,
      currentVersion: check?.currentVersion ?? null,
      lastUpdated: check?.checkedAt ?? record.downloadedAt,
      state,
    };
  });
}

/** One document, on the person's say-so ("Make available offline", §14). */
export async function makeDocumentAvailableOffline(db: OfflineDatabase, input: { projectId: string; companyId: string; documentId: string }, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<void> {
  const response = await fetchImpl("/api/sync/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentIds: [input.documentId] }) });
  if (!response.ok) throw new Error("This document could not be checked.");
  const status = ((await response.json()) as { data: Array<{ status: DocumentOfflineStatus | null }> }).data[0]?.status;
  if (!status?.current || !status.downloadable) throw new Error("This document is not available to download.");
  await storeDocumentFile(db, { ...input, name: status.name, fileName: status.fileName ?? status.name, mime: status.mimeType ?? "application/octet-stream", current: { versionId: status.current.versionId, versionNumber: status.current.versionNumber, updatedAt: status.current.updatedAt } }, fetchImpl, now);
  await checkDocumentVersions(db, fetchImpl, now);
}

/** Replaces an out-of-date copy with the current version (§16). */
export async function updateOfflineDocument(db: OfflineDatabase, projectId: string, companyId: string, documentId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await makeDocumentAvailableOffline(db, { projectId, companyId, documentId }, fetchImpl);
}

export async function removeOfflineDocument(db: OfflineDatabase, projectId: string, documentId: string): Promise<void> {
  await db.removeDocument(projectId, documentId);
}

/** The file, to open inside NESTO. Never written to a public folder (§125, §126). */
export async function openOfflineDocument(db: OfflineDatabase, projectId: string, documentId: string): Promise<{ url: string; name: string; mime: string } | null> {
  const stored = await db.getDocument(projectId, documentId);
  if (!stored) return null;
  const blob = new Blob([await stored.bytes()], { type: stored.body.mime });
  return { url: URL.createObjectURL(blob), name: stored.body.fileName, mime: stored.body.mime };
}
