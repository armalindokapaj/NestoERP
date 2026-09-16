import type { DocumentScanStatus } from "@prisma/client";

import { prisma } from "@/lib/database/prisma";
import { logger, serialiseError } from "@/lib/core/observability/logger";
import { recordSystemAction } from "@/lib/core/audit/audit.service";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { JobError } from "@/lib/core/jobs/job.errors";
import {
  activeScanner,
  assertTransition,
  buildQuarantineKey,
  canTransition,
  type FileScanner,
} from "@/lib/core/storage";
import type { FileScanInput, FileScanResult } from "@/lib/core/storage/scanner";
import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { sweep, sweepCompanyScope } from "./storage.sweep";
import { frozenFileReason, lockDocumentForSwap, promoteVersion } from "./version.promote";
// Registers the ClamAV engine: server-only, so it is loaded here, where scans run.
import "@/lib/core/storage/clamav-scanner";

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
 *
 * The queue is the scan columns themselves (PRD #51 §23-§35). A file waiting is
 * SCANNING/PENDING; a claim moves it to SCANNING/SCANNING and stamps
 * `scanStartedAt` and `scanAttempts`; every verdict is written only by the
 * claim that asked for it, named by that stamp. The first upload's document
 * carries the claim and its version 1 mirrors the outcome; a later version
 * carries its own.
 */

/**
 * How long a claim may go unanswered before it is presumed dead
 * (PRD #51 §26, §27, §29).
 *
 * Nothing but the claimer moves a file on from SCANNING/SCANNING, so a worker
 * killed mid-scan, or an upload request that timed out around its inline scan,
 * would otherwise leave the file unavailable for good. Past this the sweep
 * takes the claim over. Well beyond the scanner's own timeout, so a slow scan
 * is not started twice.
 */
export const SCAN_LEASE_MS = 15 * 60 * 1000;

/**
 * Claims a file gets before it is FAILED rather than scanned forever
 * (PRD #51 §34, §35).
 *
 * An ERROR is not a verdict — nothing was proven either way — so it is tried
 * again, but not every fifteen seconds for ever: see `scanRetryDelayMs`. With
 * the delay doubling, twelve claims take most of a day, which a scanner outage
 * does not outlast unnoticed: the scan-queue alert has long since fired.
 */
export const MAX_SCAN_ATTEMPTS = 12;

/** The wait after a file's nth claim before it is claimed again: a minute, doubling, at most six hours. */
export function scanRetryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 6 * 60 * 60 * 1000);
}

const WAITING: DocumentScanStatus[] = ["PENDING", "ERROR"];
const QUARANTINE_FAILED = "the infected object could not be moved to quarantine";

/** The scan columns a claim is conditional on — as the sweep read them, or a fresh upload's. */
type ClaimFrom = { scanStatus: DocumentScanStatus; scanStartedAt: Date | null; scanAttempts: number };
type QueuedScan = ClaimFrom & { id: string; companyId: string };

const FRESH: ClaimFrom = { scanStatus: "PENDING", scanStartedAt: null, scanAttempts: 0 };

/**
 * What one pass at one file came to. The last two are failures the sweep
 * reports; the rest are where the file now stands.
 */
export type ScanOutcome = "NOT_CLAIMED" | "CLEAN" | "INFECTED" | "ERROR" | "GAVE_UP" | "SCANNER_THREW" | "QUARANTINE_OWED";

/** Scan-queue rows that may be claimed now. */
function dueForScan(now: Date) {
  const leaseCutoff = new Date(now.getTime() - SCAN_LEASE_MS);
  return {
    storageStatus: "SCANNING" as const,
    OR: [
      // Never claimed — or waiting since before claims were recorded.
      { scanStatus: { in: WAITING }, scanStartedAt: null },
      // Waited out the delay its last claim earned. Past the last claim that
      // delay still stands before the file is given up on.
      ...Array.from({ length: MAX_SCAN_ATTEMPTS }, (_, index) => index + 1).map((attempts) => ({
        scanStatus: { in: WAITING },
        scanAttempts: attempts < MAX_SCAN_ATTEMPTS ? attempts : { gte: attempts },
        scanStartedAt: { lte: new Date(now.getTime() - scanRetryDelayMs(attempts)) },
      })),
      // A claim nobody answered; one from before claims were stamped is dated by its last write.
      { scanStatus: "SCANNING" as const, scanStartedAt: { lte: leaseCutoff } },
      { scanStatus: "SCANNING" as const, scanStartedAt: null, updatedAt: { lte: leaseCutoff } },
    ],
  };
}

/**
 * The current version mirrors its document's scan verdict (PRD #38 §56).
 *
 * Only a version still waiting on that verdict takes it. A first upload's
 * version sits at SCANNING alongside its document until the scanner answers;
 * once it has settled — available, rejected, failed — there is nothing left
 * to mirror, and a sync that read the document before a second worker recorded
 * the verdict must not carry that older reading onto a version that has moved
 * on, nor un-reject one. Losing that race is harmless: the write that won
 * already carried the verdict, so this returns quietly.
 */
async function syncCurrentVersion(documentId: string): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { currentVersionId: true, storageStatus: true, scanStatus: true, scanProvider: true, scanCompletedAt: true, scanAttempts: true, availableAt: true, rejectionReason: true, previewStatus: true },
  });
  if (!document?.currentVersionId) return;
  // Archiving belongs to the document, not to its versions: a file the
  // scanner cleared stays AVAILABLE in the history, as every other version
  // does, even if the document was archived before this caught up.
  const storageStatus = document.storageStatus === "ARCHIVED" ? "AVAILABLE" : document.storageStatus;
  if (storageStatus !== "SCANNING" && !canTransition("SCANNING", storageStatus)) return;
  await prisma.documentVersion.updateMany({
    where: { id: document.currentVersionId, storageStatus: "SCANNING" },
    data: {
      storageStatus,
      scanStatus: document.scanStatus,
      scanProvider: document.scanProvider,
      scanCompletedAt: document.scanCompletedAt,
      scanAttempts: document.scanAttempts,
      availableAt: document.availableAt,
      rejectionReason: document.rejectionReason,
      previewStatus: document.previewStatus,
    },
  });
}

/** Asks the scanner, turning a scanner that throws into a result the caller can settle. */
async function askScanner(scanner: FileScanner, input: FileScanInput, ids: Record<string, string>): Promise<FileScanResult | null> {
  try {
    return await scanner.scan(input);
  } catch (error) {
    // The scanner itself broke. Back to PENDING for a later claim — never
    // onward to AVAILABLE (PRD #29 §59, §375).
    logger.error("storage.scan.failed", { ...ids, ...serialiseError(error) });
    incrementCounter(Metric.SCAN_FAILURE, { reason: "scanner_threw" });
    return null;
  }
}

/**
 * Removes an infected object from the ordinary key space (PRD #29 §60-§63).
 *
 * The bytes are copied to a quarantine prefix and deleted from where business
 * files live, so no lifecycle rule, listing or migration written for documents
 * can ever touch them again. A dedicated quarantine bucket is better still and
 * is a deployment choice (PRD #29 §62).
 *
 * Runs after the rejection has committed, so the file is unavailable and the
 * evidence recorded whatever storage does next. Asked again of an object
 * already moved, it finds nothing at the key and has nothing to do — which is
 * what lets a failed move simply be tried again.
 */
async function moveToQuarantine(input: { companyId: string; quarantineId: string; storageKey: string }, ids: Record<string, string>): Promise<boolean> {
  const provider = storageProvider();
  try {
    if (await provider.headObject(input.storageKey)) {
      if (provider.copyObject) {
        await provider.copyObject({ fromKey: input.storageKey, toKey: buildQuarantineKey({ companyId: input.companyId, documentId: input.quarantineId }) });
      }
      await provider.deleteObject(input.storageKey);
    }
    return true;
  } catch (error) {
    logger.error("storage.quarantine.failed", { ...ids, ...serialiseError(error) });
    incrementCounter(Metric.SCAN_FAILURE, { reason: "quarantine_failed" });
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Scans a freshly uploaded document and records the verdict.
 *
 * Claims the row first with a conditional update, so two workers cannot scan
 * the same object twice (PRD #29 §274). Only a file nobody has claimed yet is
 * taken here: a retry is the sweep's, on the sweep's schedule.
 */
export async function runScanForDocument(documentId: string): Promise<ScanOutcome> {
  const outcome = await scanDocument(documentId, FRESH);
  await syncCurrentVersion(documentId);
  return outcome;
}

async function scanDocument(documentId: string, from: ClaimFrom): Promise<ScanOutcome> {
  const scanner = activeScanner();
  if (!scanner) return "NOT_CLAIMED";

  const claimedAt = new Date();
  const claimed = await prisma.document.updateMany({
    where: { id: documentId, storageStatus: "SCANNING", scanStatus: from.scanStatus, scanStartedAt: from.scanStartedAt, scanAttempts: from.scanAttempts },
    data: { scanStatus: "SCANNING", scanProvider: scanner.provider, scanStartedAt: claimedAt, scanAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "NOT_CLAIMED";

  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { id: true, companyId: true, name: true, storageKey: true, sizeBytes: true, originalFileName: true, scanAttempts: true },
  });
  const ids = { documentId, companyId: document.companyId };
  const storageKey = document.storageKey;

  // A row with no key has nothing to read: an ERROR like any unreadable
  // object, so it runs out of attempts rather than holding its claim.
  const result = storageKey
    ? await askScanner(
        scanner,
        { storageKey, fileName: document.originalFileName ?? document.name, sizeBytes: Number(document.sizeBytes ?? BigInt(0)), read: () => storageProvider().getObject(storageKey) },
        ids,
      )
    : ({ verdict: "ERROR", detail: "no storage key" } as const);

  if (!result) {
    await prisma.document.updateMany({
      where: { id: documentId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
      data: { scanStatus: "PENDING" },
    });
    return "SCANNER_THREW";
  }

  if (result.verdict === "CLEAN") {
    assertTransition("SCANNING", "AVAILABLE");
    const settled = await prisma.document.updateMany({
      where: { id: documentId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
      data: { storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanStartedAt: null, scanCompletedAt: new Date(), availableAt: new Date() },
    });
    return settled.count > 0 ? "CLEAN" : "NOT_CLAIMED";
  }

  if (result.verdict === "ERROR") {
    // Distinct from infected: nothing was proven either way, so the file waits
    // and the user is told it is still being verified (PRD #29 §278). The
    // claim's stamp stays: the retry delay counts from it.
    const settled = await prisma.document.updateMany({
      where: { id: documentId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
      data: { scanStatus: "ERROR", scanCompletedAt: new Date() },
    });
    logger.warn("storage.scan.error", { ...ids, attempt: document.scanAttempts, detail: result.detail ?? null });
    incrementCounter(Metric.SCAN_FAILURE, { reason: "verdict_error" });
    return settled.count > 0 ? "ERROR" : "NOT_CLAIMED";
  }

  assertTransition("SCANNING", "REJECTED");
  // The rejection and its evidence commit together. A file blocked with no
  // record of why is not much of a control (PRD #28 §49, PRD #29 §63). The
  // stamp stays until the object is out of the business key space: while it
  // is set, the move is still owed.
  const rejected = await prisma.$transaction(async (tx) => {
    const moved = await tx.document.updateMany({
      where: { id: documentId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
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
    if (moved.count === 0) return false;
    await recordSystemAction(
      document.companyId,
      { actionKey: AuditAction.DOCUMENT_REJECTED_MALWARE, entity: { type: "Document", id: documentId }, metadata: { detection: result.detail ?? null } },
      { tx },
    );
    return true;
  });
  if (!rejected) return "NOT_CLAIMED";
  logger.warn("storage.scan.infected", { ...ids, detail: result.detail ?? null });

  return (await quarantineDocument({ id: documentId, companyId: document.companyId, storageKey, scanStartedAt: claimedAt })) ? "INFECTED" : "QUARANTINE_OWED";
}

async function quarantineDocument(row: { id: string; companyId: string; storageKey: string | null; scanStartedAt: Date | null }): Promise<boolean> {
  const ids = { documentId: row.id, companyId: row.companyId };
  if (row.storageKey && !(await moveToQuarantine({ companyId: row.companyId, quarantineId: row.id, storageKey: row.storageKey }, ids))) return false;
  await prisma.document.updateMany({
    where: { id: row.id, storageStatus: "REJECTED", scanStatus: "INFECTED", scanStartedAt: row.scanStartedAt },
    data: { scanStartedAt: null },
  });
  return true;
}

/**
 * Stops trying to scan a document that has used its attempts
 * (PRD #51 §34, §35).
 *
 * FAILED, not REJECTED: nothing was found, but nothing was proven either, and
 * the gate fails closed. The object stays where it is — a scanner outage must
 * not cost anybody their file — and never becomes downloadable.
 */
async function giveUpOnDocument(row: QueuedScan): Promise<ScanOutcome> {
  assertTransition("SCANNING", "FAILED");
  const failed = await prisma.$transaction(async (tx) => {
    const moved = await tx.document.updateMany({
      where: { id: row.id, storageStatus: "SCANNING", scanStatus: row.scanStatus, scanStartedAt: row.scanStartedAt, scanAttempts: row.scanAttempts },
      data: { storageStatus: "FAILED", scanStatus: "ERROR", scanStartedAt: null, scanCompletedAt: new Date(), rejectedAt: new Date(), rejectionReason: "FILE_SCAN_FAILED" },
    });
    if (moved.count === 0) return false;
    await recordSystemAction(row.companyId, { actionKey: AuditAction.DOCUMENT_SCAN_FAILED, entity: { type: "Document", id: row.id }, metadata: { attempts: row.scanAttempts } }, { tx });
    return true;
  });
  if (!failed) return "NOT_CLAIMED";
  logger.error("storage.scan.gave_up", { documentId: row.id, companyId: row.companyId, attempts: row.scanAttempts });
  return "GAVE_UP";
}

/* -------------------------------------------------------------------------- */
/* Later versions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Scans a later version of a document (PRD #38 §58, §100).
 *
 * Same gate, same direction: a version the scanner cannot vouch for never
 * becomes the one the document serves. Clean promotes it; infected removes the
 * object and rejects the version while the document keeps its current file.
 */
export async function runScanForVersion(versionId: string): Promise<ScanOutcome> {
  return scanVersion(versionId, FRESH);
}

async function scanVersion(versionId: string, from: ClaimFrom): Promise<ScanOutcome> {
  const scanner = activeScanner();
  if (!scanner) return "NOT_CLAIMED";

  const claimedAt = new Date();
  const claimed = await prisma.documentVersion.updateMany({
    where: { id: versionId, storageStatus: "SCANNING", scanStatus: from.scanStatus, scanStartedAt: from.scanStartedAt, scanAttempts: from.scanAttempts },
    data: { scanStatus: "SCANNING", scanProvider: scanner.provider, scanStartedAt: claimedAt, scanAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "NOT_CLAIMED";

  const version = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: versionId },
    select: { id: true, companyId: true, documentId: true, storageKey: true, sizeBytes: true, originalFileName: true, versionNumber: true, scanAttempts: true },
  });
  const ids = { documentId: version.documentId, documentVersionId: versionId, companyId: version.companyId };

  const result = await askScanner(
    scanner,
    {
      storageKey: version.storageKey,
      fileName: version.originalFileName ?? `version-${version.versionNumber}`,
      sizeBytes: Number(version.sizeBytes ?? BigInt(0)),
      read: () => storageProvider().getObject(version.storageKey),
    },
    ids,
  );

  if (!result) {
    await prisma.documentVersion.updateMany({
      where: { id: versionId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
      data: { scanStatus: "PENDING" },
    });
    return "SCANNER_THREW";
  }

  if (result.verdict === "CLEAN") {
    assertTransition("SCANNING", "AVAILABLE");
    return prisma.$transaction(async (tx) => {
      /*
       * Clean is not the same as allowed. A revision submitted or a transmittal
       * issued while this version waited on the scanner froze the document's
       * file, and the scan must not swap it underneath that record
       * (PRD #46 §69, §123, PRD #47 §85). The version is refused instead; the
       * document keeps the file the record carries. Asked under the lock the
       * swap takes, so the answer is the one the swap acts on.
       */
      await lockDocumentForSwap(tx, version.documentId);
      const frozen = await frozenFileReason(version.documentId);
      if (frozen) {
        assertTransition("SCANNING", "REJECTED");
        const refused = await tx.documentVersion.updateMany({
          where: { id: versionId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
          data: { storageStatus: "REJECTED", scanStatus: "CLEAN", scanStartedAt: null, scanCompletedAt: new Date(), rejectionReason: "ENGINEERING_FILE_FROZEN" },
        });
        return refused.count > 0 ? "CLEAN" : "NOT_CLAIMED";
      }
      const settled = await tx.documentVersion.updateMany({
        where: { id: versionId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
        data: { storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanStartedAt: null, scanCompletedAt: new Date(), availableAt: new Date() },
      });
      if (settled.count === 0) return "NOT_CLAIMED";
      // A newer version already current keeps its place; this one joins the history.
      if (!(await promoteVersion(tx, versionId))) logger.info("storage.scan.version_superseded", ids);
      return "CLEAN";
    });
  }

  if (result.verdict === "ERROR") {
    const settled = await prisma.documentVersion.updateMany({
      where: { id: versionId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
      data: { scanStatus: "ERROR", scanCompletedAt: new Date() },
    });
    logger.warn("storage.scan.error", { ...ids, attempt: version.scanAttempts, detail: result.detail ?? null });
    incrementCounter(Metric.SCAN_FAILURE, { reason: "verdict_error" });
    return settled.count > 0 ? "ERROR" : "NOT_CLAIMED";
  }

  assertTransition("SCANNING", "REJECTED");
  const rejected = await prisma.$transaction(async (tx) => {
    const moved = await tx.documentVersion.updateMany({
      where: { id: versionId, storageStatus: "SCANNING", scanStatus: "SCANNING", scanStartedAt: claimedAt },
      data: { storageStatus: "REJECTED", scanStatus: "INFECTED", scanCompletedAt: new Date(), rejectionReason: "FILE_REJECTED_MALWARE", previewStatus: "NOT_REQUIRED" },
    });
    if (moved.count === 0) return false;
    await recordSystemAction(
      version.companyId,
      {
        actionKey: AuditAction.DOCUMENT_REJECTED_MALWARE,
        entity: { type: "Document", id: version.documentId },
        metadata: { detection: result.detail ?? null, versionNumber: version.versionNumber },
      },
      { tx },
    );
    return true;
  });
  if (!rejected) return "NOT_CLAIMED";
  logger.warn("storage.scan.infected", { ...ids, detail: result.detail ?? null });

  return (await quarantineVersion({ ...version, scanStartedAt: claimedAt })) ? "INFECTED" : "QUARANTINE_OWED";
}

async function quarantineVersion(row: { id: string; companyId: string; documentId: string; versionNumber: number; storageKey: string; scanStartedAt: Date | null }): Promise<boolean> {
  const ids = { documentId: row.documentId, documentVersionId: row.id, companyId: row.companyId };
  const quarantineId = `${row.documentId}-v${row.versionNumber}`;
  if (!(await moveToQuarantine({ companyId: row.companyId, quarantineId, storageKey: row.storageKey }, ids))) return false;
  await prisma.documentVersion.updateMany({
    where: { id: row.id, storageStatus: "REJECTED", scanStatus: "INFECTED", scanStartedAt: row.scanStartedAt },
    data: { scanStartedAt: null },
  });
  return true;
}

async function giveUpOnVersion(row: QueuedScan & { documentId: string; versionNumber: number }): Promise<ScanOutcome> {
  assertTransition("SCANNING", "FAILED");
  const failed = await prisma.$transaction(async (tx) => {
    const moved = await tx.documentVersion.updateMany({
      where: { id: row.id, storageStatus: "SCANNING", scanStatus: row.scanStatus, scanStartedAt: row.scanStartedAt, scanAttempts: row.scanAttempts },
      data: { storageStatus: "FAILED", scanStatus: "ERROR", scanStartedAt: null, scanCompletedAt: new Date(), rejectionReason: "FILE_SCAN_FAILED" },
    });
    if (moved.count === 0) return false;
    await recordSystemAction(
      row.companyId,
      { actionKey: AuditAction.DOCUMENT_SCAN_FAILED, entity: { type: "Document", id: row.documentId }, metadata: { attempts: row.scanAttempts, versionNumber: row.versionNumber } },
      { tx },
    );
    return true;
  });
  if (!failed) return "NOT_CLAIMED";
  logger.error("storage.scan.gave_up", { documentId: row.documentId, documentVersionId: row.id, companyId: row.companyId, attempts: row.scanAttempts });
  return "GAVE_UP";
}

/* -------------------------------------------------------------------------- */
/* The sweep                                                                   */
/* -------------------------------------------------------------------------- */

export type ScanSweepResult = {
  /** Files whose state this run moved — a verdict, or given up on — documents and versions alike. */
  scanned: number;
  documents: number;
  versions: number;
  /** Of `scanned`, files given up on after their last attempt. */
  failed: number;
  /** Infected objects whose move out of the business key space was owed, now moved. */
  quarantined: number;
};

/**
 * Drains everything waiting on a scanner (PRD #29 §271, §272, §314;
 * PRD #51 §23-§35, §133-§138, §193).
 *
 * The queue is the scan columns rather than a separate job table: the sweep
 * walks every file due a claim — never claimed, a retry whose delay has run
 * out, or a claim abandoned past the lease — in bounded batches, and claims
 * each on the state it read. Two sweeps, or a sweep and an upload's inline
 * scan, meet at that conditional update and one of them walks on.
 *
 * `batchSize` is rows per query, not a cap on the run: the run goes on until
 * nothing due is left or it is told to stop. A file that fails in a way the
 * scanner did not report — the scanner threw, the database refused a write,
 * storage would not give up an infected object — is logged and counted, the
 * rest still get their turn, and the run ends failed so somebody sees it.
 */
export async function runPendingScans(batchSize = 25): Promise<ScanSweepResult> {
  const result: ScanSweepResult = { scanned: 0, documents: 0, versions: 0, failed: 0, quarantined: 0 };
  if (!activeScanner()) return result;
  const now = new Date();
  const scope = sweepCompanyScope();
  let failures = 0;

  /*
   * Where a file now stands is counted. A failure the scanner did not report
   * is thrown instead, so the sweep logs it against the file's id, moves on,
   * and the run ends failed.
   */
  const settle = (outcome: ScanOutcome, kind: "documents" | "versions") => {
    if (outcome === "SCANNER_THREW") throw new JobError("UNKNOWN", "the scanner threw");
    if (outcome === "QUARANTINE_OWED") throw new JobError("STORAGE_UNAVAILABLE", QUARANTINE_FAILED);
    if (outcome === "NOT_CLAIMED") return;
    result.scanned += 1;
    result[kind] += 1;
    if (outcome === "GAVE_UP") result.failed += 1;
  };

  // First uploads first: a document waiting on its first file has nothing to
  // serve, while one waiting on a later version still serves its current one.
  const documents = await sweep(
    "documents.scan.item_failed",
    (after, take) =>
      prisma.document.findMany({
        where: { ...dueForScan(now), ...scope, ...after },
        select: { id: true, companyId: true, scanStatus: true, scanStartedAt: true, scanAttempts: true },
        orderBy: { id: "asc" },
        take,
      }),
    async (row) => {
      try {
        settle(row.scanAttempts >= MAX_SCAN_ATTEMPTS ? await giveUpOnDocument(row) : await scanDocument(row.id, row), "documents");
      } finally {
        await syncCurrentVersion(row.id);
      }
    },
    batchSize,
  );
  failures += documents.failed;

  // A first upload's version 1 waits alongside its document and takes the
  // document's verdict; only the versions that are not current are scanned here.
  const versions = await sweep(
    "documents.scan.item_failed",
    (after, take) =>
      prisma.documentVersion.findMany({
        where: { ...dueForScan(now), ...scope, ...after },
        select: { id: true, companyId: true, documentId: true, versionNumber: true, scanStatus: true, scanStartedAt: true, scanAttempts: true, document: { select: { currentVersionId: true } } },
        orderBy: { id: "asc" },
        take,
      }),
    async (row) => {
      if (row.document.currentVersionId === row.id) return;
      settle(row.scanAttempts >= MAX_SCAN_ATTEMPTS ? await giveUpOnVersion(row) : await scanVersion(row.id, row), "versions");
    },
    batchSize,
  );
  failures += versions.failed;

  // Infected objects a failed move left at their business key (the stamp is
  // still set), tried again until storage lets them go — once the lease has
  // passed, so a claimer that has only just rejected its file is not raced
  // for the move it is about to make.
  const owedBefore = new Date(now.getTime() - SCAN_LEASE_MS);
  const owedDocuments = await sweep(
    "documents.scan.item_failed",
    (after, take) =>
      prisma.document.findMany({
        where: { storageStatus: "REJECTED", scanStatus: "INFECTED", scanStartedAt: { not: null }, scanCompletedAt: { lte: owedBefore }, ...scope, ...after },
        select: { id: true, companyId: true, storageKey: true, scanStartedAt: true },
        orderBy: { id: "asc" },
        take,
      }),
    async (row) => {
      if (!(await quarantineDocument(row))) throw new JobError("STORAGE_UNAVAILABLE", QUARANTINE_FAILED);
      result.quarantined += 1;
    },
    batchSize,
  );
  failures += owedDocuments.failed;

  const owedVersions = await sweep(
    "documents.scan.item_failed",
    (after, take) =>
      prisma.documentVersion.findMany({
        where: { storageStatus: "REJECTED", scanStatus: "INFECTED", scanStartedAt: { not: null }, scanCompletedAt: { lte: owedBefore }, ...scope, ...after },
        select: { id: true, companyId: true, documentId: true, versionNumber: true, storageKey: true, scanStartedAt: true },
        orderBy: { id: "asc" },
        take,
      }),
    async (row) => {
      if (!(await quarantineVersion(row))) throw new JobError("STORAGE_UNAVAILABLE", QUARANTINE_FAILED);
      result.quarantined += 1;
    },
    batchSize,
  );
  failures += owedVersions.failed;

  if (failures > 0) throw new JobError("PARTIAL_FAILURE", `documents.scan failed for ${failures} file(s)`);
  return result;
}
