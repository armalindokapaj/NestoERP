import { prisma } from "@/lib/database/prisma";
import { logger } from "@/lib/core/observability/logger";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import {
  activeScanner,
  assertTransition,
  buildQuarantineKey,
} from "@/lib/core/storage";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { frozenFileReason, promoteVersion } from "./version.promote";
// Registers the ClamAV engine: server-only, so it is loaded here, where scans run.
import "@/lib/core/storage/clamav-scanner";

/** The current version mirrors its document's scan verdict (PRD #38 §56). */
async function syncCurrentVersion(documentId: string): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { currentVersionId: true, storageStatus: true, scanStatus: true, scanProvider: true, scanCompletedAt: true, availableAt: true, rejectionReason: true, previewStatus: true },
  });
  if (!document?.currentVersionId) return;
  await prisma.documentVersion.updateMany({
    where: { id: document.currentVersionId },
    data: {
      storageStatus: document.storageStatus,
      scanStatus: document.scanStatus,
      scanProvider: document.scanProvider,
      scanCompletedAt: document.scanCompletedAt,
      availableAt: document.availableAt,
      rejectionReason: document.rejectionReason,
      previewStatus: document.previewStatus,
    },
  });
}

/**
 * Malware scanning (PRD #29 §54-§63, §328).
 *
 * The gate has one rule and it points one way: when a scanner is configured, a
 * file does not become downloadable until that scanner says it is clean. A
 * scanner that is unreachable leaves the file where it is — pending — because
 * failing open would make the whole arrangement decorative (PRD #29 §55, §59).
 *
 * There is no user-facing override. "Trust this file" is not a button anybody
 * gets (PRD #29 §279, §280).
 */

/**
 * Scans one document and records the verdict.
 *
 * Claims the row first with a conditional update, so two workers cannot scan
 * the same object twice (PRD #29 §274).
 */
export async function runScanForDocument(documentId: string): Promise<void> {
  await scanDocument(documentId);
  await syncCurrentVersion(documentId);
}

async function scanDocument(documentId: string): Promise<void> {
  const scanner = activeScanner();
  if (!scanner) return;

  const claimed = await prisma.document.updateMany({
    where: { id: documentId, storageStatus: "SCANNING", scanStatus: "PENDING" },
    data: { scanStatus: "SCANNING", scanProvider: scanner.provider },
  });
  if (claimed.count === 0) return;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      companyId: true,
      name: true,
      storageKey: true,
      sizeBytes: true,
      originalFileName: true,
    },
  });
  if (!document?.storageKey) return;

  const provider = storageProvider();
  const storageKey = document.storageKey;

  let result;
  try {
    result = await scanner.scan({
      storageKey,
      fileName: document.originalFileName ?? document.name,
      sizeBytes: Number(document.sizeBytes ?? BigInt(0)),
      read: () => provider.getObject(storageKey),
    });
  } catch (error) {
    // The scanner itself broke. Back to PENDING for the next sweep — never
    // onward to AVAILABLE (PRD #29 §59, §375).
    logger.error("storage.scan.failed", {
      documentId,
      error: error instanceof Error ? error.message : "unknown",
    });
    incrementCounter(Metric.SCAN_FAILURE, { reason: "scanner_threw" });
    await prisma.document.updateMany({
      where: { id: documentId, scanStatus: "SCANNING" },
      data: { scanStatus: "PENDING" },
    });
    return;
  }

  if (result.verdict === "CLEAN") {
    assertTransition("SCANNING", "AVAILABLE");
    await prisma.document.updateMany({
      where: { id: documentId, storageStatus: "SCANNING" },
      data: {
        storageStatus: "AVAILABLE",
        scanStatus: "CLEAN",
        scanCompletedAt: new Date(),
        availableAt: new Date(),
      },
    });
    return;
  }

  if (result.verdict === "ERROR") {
    // Distinct from infected: nothing was proven either way, so the file waits
    // and the user is told it is still being verified (PRD #29 §278).
    await prisma.document.updateMany({
      where: { id: documentId, scanStatus: "SCANNING" },
      data: { scanStatus: "ERROR", scanCompletedAt: new Date() },
    });
    logger.warn("storage.scan.error", { documentId, detail: result.detail ?? null });
    return;
  }

  await quarantine(document.companyId, documentId, storageKey, result.detail ?? null);
}

/**
 * Removes an infected object from the ordinary key space (PRD #29 §60-§63).
 *
 * The bytes are copied to a quarantine prefix and deleted from where business
 * files live, so no lifecycle rule, listing or migration written for documents
 * can ever touch them again. A dedicated quarantine bucket is better still and
 * is a deployment choice (PRD #29 §62).
 */
async function quarantine(
  companyId: string,
  documentId: string,
  storageKey: string,
  detail: string | null,
): Promise<void> {
  const provider = storageProvider();
  const quarantineKey = buildQuarantineKey({ companyId, documentId });

  try {
    if (provider.copyObject) {
      await provider.copyObject({ fromKey: storageKey, toKey: quarantineKey });
    }
    await provider.deleteObject(storageKey);
  } catch (error) {
    logger.error("storage.quarantine.failed", {
      documentId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  assertTransition("SCANNING", "REJECTED");

  // The rejection and its evidence commit together. A file blocked with no
  // record of why is not much of a control (PRD #28 §49, PRD #29 §63).
  await prisma.$transaction(async (tx) => {
    await tx.document.updateMany({
      where: { id: documentId, storageStatus: "SCANNING" },
      data: {
        storageStatus: "REJECTED",
        scanStatus: "INFECTED",
        scanCompletedAt: new Date(),
        rejectedAt: new Date(),
        // A safe code. The signature name stays in the audit trail and the
        // logs, not in anything a user reads (PRD #29 §211).
        rejectionReason: "FILE_REJECTED_MALWARE",
        previewStatus: "NOT_REQUIRED",
      },
    });

    await recordSystemAction(
      companyId,
      {
        actionKey: AuditAction.DOCUMENT_REJECTED_MALWARE,
        entity: { type: "Document", id: documentId },
        metadata: { detection: detail },
      },
      { tx },
    );
  });

  logger.warn("storage.scan.infected", { documentId, detail });
}

/**
 * Drains everything waiting on a scanner (PRD #29 §271, §272, §314).
 *
 * The queue is the `scanStatus` column rather than a separate job table: with
 * one status and one index, a worker asks for PENDING rows and claims them one
 * at a time. A job runner can replace this without the states changing.
 */
/**
 * Scans a later version of a document (PRD #38 §58, §100).
 *
 * Same gate, same direction: a version the scanner cannot vouch for never
 * becomes the one the document serves. Clean promotes it; infected removes the
 * object and rejects the version while the document keeps its current file.
 */
export async function runScanForVersion(versionId: string): Promise<void> {
  const scanner = activeScanner();
  if (!scanner) return;

  const claimed = await prisma.documentVersion.updateMany({
    where: { id: versionId, storageStatus: "SCANNING", scanStatus: "PENDING" },
    data: { scanStatus: "SCANNING", scanProvider: scanner.provider },
  });
  if (claimed.count === 0) return;

  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    select: { id: true, companyId: true, documentId: true, storageKey: true, sizeBytes: true, originalFileName: true, versionNumber: true },
  });
  if (!version) return;
  const provider = storageProvider();

  let result;
  try {
    result = await scanner.scan({
      storageKey: version.storageKey,
      fileName: version.originalFileName ?? `version-${version.versionNumber}`,
      sizeBytes: Number(version.sizeBytes ?? BigInt(0)),
      read: () => provider.getObject(version.storageKey),
    });
  } catch (error) {
    logger.error("storage.scan.failed", { documentVersionId: versionId, error: error instanceof Error ? error.message : "unknown" });
    incrementCounter(Metric.SCAN_FAILURE, { reason: "scanner_threw" });
    await prisma.documentVersion.updateMany({ where: { id: versionId, scanStatus: "SCANNING" }, data: { scanStatus: "PENDING" } });
    return;
  }

  if (result.verdict === "CLEAN") {
    assertTransition("SCANNING", "AVAILABLE");
    await prisma.$transaction(async (tx) => {
      /*
       * Clean is not the same as allowed. A revision submitted or a transmittal
       * issued while this version waited on the scanner froze the document's
       * file, and the scan must not swap it underneath that record
       * (PRD #46 §69, §123, PRD #47 §85). The version is refused instead; the
       * document keeps the file the record carries.
       */
      const frozen = await frozenFileReason(version.documentId);
      if (frozen) {
        assertTransition("SCANNING", "REJECTED");
        await tx.documentVersion.updateMany({
          where: { id: versionId, storageStatus: "SCANNING" },
          data: { storageStatus: "REJECTED", scanStatus: "CLEAN", scanCompletedAt: new Date(), rejectionReason: "ENGINEERING_FILE_FROZEN" },
        });
        return;
      }
      const settled = await tx.documentVersion.updateMany({
        where: { id: versionId, storageStatus: "SCANNING" },
        data: { storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanCompletedAt: new Date(), availableAt: new Date() },
      });
      if (settled.count > 0) await promoteVersion(tx, versionId);
    });
    return;
  }

  if (result.verdict === "ERROR") {
    await prisma.documentVersion.updateMany({
      where: { id: versionId, scanStatus: "SCANNING" },
      data: { scanStatus: "ERROR", scanCompletedAt: new Date() },
    });
    incrementCounter(Metric.SCAN_FAILURE, { reason: "verdict_error" });
    return;
  }

  const quarantineKey = buildQuarantineKey({ companyId: version.companyId, documentId: `${version.documentId}-v${version.versionNumber}` });
  try {
    if (provider.copyObject) await provider.copyObject({ fromKey: version.storageKey, toKey: quarantineKey });
    await provider.deleteObject(version.storageKey);
  } catch (error) {
    logger.error("storage.quarantine.failed", { documentVersionId: versionId, error: error instanceof Error ? error.message : "unknown" });
  }
  await prisma.$transaction(async (tx) => {
    await tx.documentVersion.updateMany({
      where: { id: versionId, storageStatus: "SCANNING" },
      data: { storageStatus: "REJECTED", scanStatus: "INFECTED", scanCompletedAt: new Date(), rejectionReason: "FILE_REJECTED_MALWARE", previewStatus: "NOT_REQUIRED" },
    });
    await recordSystemAction(
      version.companyId,
      {
        actionKey: AuditAction.DOCUMENT_REJECTED_MALWARE,
        entity: { type: "Document", id: version.documentId },
        metadata: { detection: result.detail ?? null, versionNumber: version.versionNumber },
      },
      { tx },
    );
  });
}

export async function runPendingScans(limit = 25): Promise<{ scanned: number }> {
  if (!activeScanner()) return { scanned: 0 };

  // Later versions waiting on a verdict: the ones that are not their document's
  // current version, which the document sweep below already covers.
  const versions = await prisma.documentVersion.findMany({
    where: { storageStatus: "SCANNING", scanStatus: { in: ["PENDING", "ERROR"] } },
    select: { id: true, document: { select: { currentVersionId: true } } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  for (const row of versions.filter((version) => version.document.currentVersionId !== version.id)) {
    await prisma.documentVersion.updateMany({ where: { id: row.id, scanStatus: "ERROR" }, data: { scanStatus: "PENDING" } });
    await runScanForVersion(row.id);
  }

  const pending = await prisma.document.findMany({
    where: { storageStatus: "SCANNING", scanStatus: { in: ["PENDING", "ERROR"] } },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  // ERROR rows are retried by the sweep; returning them to PENDING is what
  // makes the retry a retry rather than a new claim (PRD #29 §276).
  for (const row of pending) {
    await prisma.document.updateMany({
      where: { id: row.id, scanStatus: "ERROR" },
      data: { scanStatus: "PENDING" },
    });
    await runScanForDocument(row.id);
  }

  return { scanned: pending.length };
}
