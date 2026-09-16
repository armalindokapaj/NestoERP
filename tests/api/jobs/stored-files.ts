import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DocumentScanStatus, DocumentStorageStatus, DocumentUploadSessionStatus } from "@prisma/client";

import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { prisma } from "../../helpers";

/**
 * Stored-file fixtures for the documents jobs' contract tests (PRD #51 §193, §194).
 *
 * Rows are written directly, in exactly the state a test needs — a claim a
 * worker abandoned twenty minutes ago, an upload abandoned two days ago — which
 * the upload pipeline cannot be asked to produce on demand. Objects go to real
 * storage in a temporary directory. Every id starts with this run's prefix, so
 * `removeStoredFiles` finds everything a test made, whatever state it ended in.
 */

const PREFIX = `jobfile_${process.pid}_${Date.now().toString(36)}`;
let counter = 0;

export function fixtureId(label: string): string {
  counter += 1;
  return `${PREFIX}_${label}_${counter}`;
}

export const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n${label}\n%%EOF\n`);

/** The standard, harmless antivirus test signature (PRD #29 §373). */
export const EICAR = new TextEncoder().encode(["X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join(""));

export const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
export const hoursAgo = (hours: number) => minutesAgo(hours * 60);

let root: string | null = null;

/** Points storage at this file's temporary directory, creating it the first time. */
export async function useTemporaryStorage(): Promise<void> {
  root ??= await mkdtemp(path.join(tmpdir(), "nesto-job-files-"));
  setStorageProvider(new LocalStorageProvider({ root }));
}

export async function releaseTemporaryStorage(): Promise<void> {
  setStorageProvider(null);
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
}

/**
 * The same temporary storage, failing where a test says. Everything else is
 * the real provider, so what the job does around the failure is what ships.
 */
export class FailingStorage extends LocalStorageProvider {
  readonly headed: string[] = [];
  failHead: (storageKey: string) => boolean = () => false;
  failDelete: (storageKey: string) => boolean = () => false;
  failCopy: (storageKey: string) => boolean = () => false;
  healthy = true;

  async headObject(storageKey: string) {
    this.headed.push(storageKey);
    if (this.failHead(storageKey)) throw new Error("storage refused the request");
    return super.headObject(storageKey);
  }

  async deleteObject(storageKey: string) {
    if (this.failDelete(storageKey)) throw new Error("storage refused the delete");
    return super.deleteObject(storageKey);
  }

  async copyObject(input: { fromKey: string; toKey: string }) {
    if (this.failCopy(input.fromKey)) throw new Error("storage refused the copy");
    return super.copyObject(input);
  }

  async healthCheck() {
    return this.healthy ? super.healthCheck() : { ok: false };
  }
}

export async function failingStorage(): Promise<FailingStorage> {
  root ??= await mkdtemp(path.join(tmpdir(), "nesto-job-files-"));
  const provider = new FailingStorage({ root });
  setStorageProvider(provider);
  return provider;
}

const members = new Map<string, string>();

export async function memberOf(companyId: string): Promise<string> {
  if (!members.has(companyId)) {
    const member = await prisma.companyMember.findFirstOrThrow({ where: { companyId }, select: { id: true }, orderBy: { id: "asc" } });
    members.set(companyId, member.id);
  }
  return members.get(companyId)!;
}

export type FileState = {
  storageStatus?: DocumentStorageStatus;
  scanStatus?: DocumentScanStatus;
  scanStartedAt?: Date | null;
  scanAttempts?: number;
};

export type StoredDocument = { id: string; companyId: string; versionId: string; storageKey: string };

/**
 * A document and its version 1, current and sharing one key — what a first
 * upload leaves. The document carries any scan claim, as the scan service's
 * does; version 1 only mirrors the states. `bytes: null` leaves no object.
 */
export async function storedDocument(
  companyId: string,
  options: FileState & { bytes?: Uint8Array | null; archived?: boolean } = {},
): Promise<StoredDocument> {
  const id = fixtureId("doc");
  const versionId = `${id}_v1`;
  const storageKey = `companies/${companyId}/documents/${id}/v1.pdf`;
  const bytes = options.bytes === undefined ? pdf(id) : options.bytes;
  const storageStatus = options.storageStatus ?? (options.archived ? "ARCHIVED" : "AVAILABLE");
  const scanStatus = options.scanStatus ?? "NOT_REQUIRED";
  await prisma.document.create({
    data: {
      id,
      companyId,
      name: `${id}.pdf`,
      originalFileName: `${id}.pdf`,
      fileName: `${id}.pdf`,
      extension: "pdf",
      storageProvider: "local",
      storageKey,
      mimeType: "application/pdf",
      sizeBytes: BigInt(bytes?.byteLength ?? 64),
      storageStatus,
      scanStatus,
      scanStartedAt: options.scanStartedAt ?? null,
      scanAttempts: options.scanAttempts ?? 0,
      status: options.archived ? "ARCHIVED" : "ACTIVE",
      archivedAt: options.archived ? new Date() : null,
      createdBy: "test",
    },
  });
  await prisma.documentVersion.create({
    data: {
      id: versionId,
      companyId,
      documentId: id,
      versionNumber: 1,
      storageProvider: "local",
      storageKey,
      originalFileName: `${id}.pdf`,
      extension: "pdf",
      sizeBytes: BigInt(bytes?.byteLength ?? 64),
      storageStatus: storageStatus === "ARCHIVED" ? "AVAILABLE" : storageStatus,
      scanStatus,
      uploadedByMemberId: await memberOf(companyId),
    },
  });
  await prisma.document.update({ where: { id }, data: { currentVersionId: versionId, latestVersionNumber: 1 } });
  if (bytes) await storageProvider().putObject(storageKey, bytes, "application/pdf");
  return { id, companyId, versionId, storageKey };
}

export type StoredVersion = { id: string; documentId: string; versionNumber: number; storageKey: string };

/** A later version of a document, with its own key; `current` makes the document serve it. */
export async function storedVersion(
  document: StoredDocument,
  versionNumber: number,
  options: FileState & { bytes?: Uint8Array | null; current?: boolean } = {},
): Promise<StoredVersion> {
  const id = `${document.id}_v${versionNumber}`;
  const storageKey = `companies/${document.companyId}/documents/${document.id}/v${versionNumber}.pdf`;
  const bytes = options.bytes === undefined ? pdf(id) : options.bytes;
  await prisma.documentVersion.create({
    data: {
      id,
      companyId: document.companyId,
      documentId: document.id,
      versionNumber,
      storageProvider: "local",
      storageKey,
      originalFileName: `${id}.pdf`,
      extension: "pdf",
      sizeBytes: BigInt(bytes?.byteLength ?? 64),
      storageStatus: options.storageStatus ?? "AVAILABLE",
      scanStatus: options.scanStatus ?? "NOT_REQUIRED",
      scanStartedAt: options.scanStartedAt ?? null,
      scanAttempts: options.scanAttempts ?? 0,
      uploadedByMemberId: await memberOf(document.companyId),
    },
  });
  await prisma.document.update({
    where: { id: document.id },
    data: { latestVersionNumber: versionNumber, ...(options.current ? { currentVersionId: id, storageKey } : {}) },
  });
  if (bytes) await storageProvider().putObject(storageKey, bytes, "application/pdf");
  return { id, documentId: document.id, versionNumber, storageKey };
}

/** An upload session for a key: EXPIRED two days ago, past the grace period, unless told otherwise. */
export async function uploadSession(
  companyId: string,
  input: { documentId: string; documentVersionId?: string | null; storageKey: string; status?: DocumentUploadSessionStatus; expiresAt?: Date },
): Promise<string> {
  const session = await prisma.documentUploadSession.create({
    data: {
      companyId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId ?? null,
      memberId: await memberOf(companyId),
      storageKey: input.storageKey,
      expectedFileName: "upload.pdf",
      expectedMimeType: "application/pdf",
      expectedSizeBytes: BigInt(64),
      status: input.status ?? "EXPIRED",
      expiresAt: input.expiresAt ?? hoursAgo(48),
    },
    select: { id: true },
  });
  return session.id;
}

/** A first upload that never completed: placeholder, version 1, its object, and a session that expired two days ago. */
export async function abandonedUpload(companyId: string): Promise<StoredDocument & { sessionId: string }> {
  const document = await storedDocument(companyId, { storageStatus: "PENDING_UPLOAD" });
  const sessionId = await uploadSession(companyId, { documentId: document.id, documentVersionId: document.versionId, storageKey: document.storageKey });
  return { ...document, sessionId };
}

export const objectExists = async (storageKey: string) => (await storageProvider().headObject(storageKey)) !== null;

/** Everything this run's fixtures made, and whatever other records were pointed at them. */
export async function removeStoredFiles(): Promise<void> {
  const where = { documentId: { startsWith: PREFIX } };
  await prisma.engineeringDocumentRevision.deleteMany({ where });
  await prisma.contractorComplianceItem.deleteMany({ where: { OR: [where, { title: { startsWith: PREFIX } }] } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { startsWith: PREFIX } } });
  await prisma.activity.deleteMany({ where: { entityId: { startsWith: PREFIX } } });
  await prisma.documentUploadSession.deleteMany({ where });
  await prisma.document.deleteMany({ where: { id: { startsWith: PREFIX } } });
}
