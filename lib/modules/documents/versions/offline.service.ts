import type { UserContext } from "@/lib/context/types";

import { documentListQuerySchema } from "../document.schema";
import { getDocument, listDocuments } from "../document.service";
import { listVersions } from "./version.service";

/**
 * What a device needs to decide whether its offline copy of a file is still the
 * file (MOB-09 §15-§18). Every answer goes through the ordinary document and
 * version reads, so a device learns nothing about a document its user cannot open.
 */

export type DocumentOfflineStatus = {
  documentId: string;
  name: string;
  fileName: string | null;
  mimeType: string | null;
  /** Bytes of the current version, for the storage estimate before a download (§12). */
  sizeBytes: string | null;
  /** The version a download would fetch now; null while no version is available. */
  current: { versionId: string; versionNumber: number; checksumSha256: string | null; supersededAt: string | null; updatedAt: string } | null;
  downloadable: boolean;
  archived: boolean;
};

export const OFFLINE_MANIFEST_LIMIT = 100;

export async function documentOfflineStatus(context: UserContext, documentId: string): Promise<DocumentOfflineStatus> {
  const detail = await getDocument(context, documentId);
  const history = await listVersions(context, documentId);
  const current = history.versions.find((version) => version.current) ?? null;
  return {
    documentId: detail.id,
    name: detail.name,
    fileName: detail.file.originalFileName,
    mimeType: detail.file.mimeType,
    sizeBytes: detail.file.sizeBytes,
    current: current
      ? { versionId: current.id, versionNumber: current.versionNumber, checksumSha256: current.checksumSha256, supersededAt: current.supersededAt, updatedAt: detail.updatedAt }
      : null,
    downloadable: detail.file.available && detail.capabilities.canDownload,
    archived: detail.archivedAt !== null,
  };
}

/** The documents of one project this reader may open, newest first — the choices offered for offline use (§13). */
export async function projectDocumentsForOffline(context: UserContext, projectId: string): Promise<DocumentOfflineStatus[]> {
  const query = documentListQuerySchema.parse({ projectId, limit: OFFLINE_MANIFEST_LIMIT });
  const { data } = await listDocuments(context, query);
  const statuses = await Promise.all(data.map((row) => documentOfflineStatus(context, row.id).catch(() => null)));
  return statuses.filter((status): status is DocumentOfflineStatus => status !== null);
}
