import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setFileScanner, type FileScanner } from "@/lib/core/storage";
import { EicarFileScanner } from "@/lib/core/storage/scanner";
import { MAX_SCAN_ATTEMPTS, runScanForVersion, scanRetryDelayMs } from "@/lib/modules/documents/storage/scan.service";
import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { cleanupSessions, prisma } from "../../helpers";
import { COMPANY_A, COMPANY_B, COMPANY_SUSPENDED, invokeJob } from "./job-harness";
import {
  EICAR,
  failingStorage,
  minutesAgo,
  objectExists,
  releaseTemporaryStorage,
  removeStoredFiles,
  storedDocument,
  storedVersion,
  useTemporaryStorage,
} from "./stored-files";

/**
 * documents.scan — the malware scan queue (PRD #51 §23-§35, §93-§96, §176, §178, §193).
 *
 * The EICAR scanner against real storage in a temporary directory: the verdicts
 * are real, only the files are small.
 */

const JOB = "documents.scan";

/** The EICAR scanner, counting what it is asked to read and failing where a test says. */
class CountingScanner implements FileScanner {
  readonly provider = "eicar-test";
  readonly scanned: string[] = [];
  private readonly inner = new EicarFileScanner();

  constructor(private readonly options: { delayMs?: number; throwFor?: (storageKey: string) => boolean } = {}) {}

  async scan(input: Parameters<FileScanner["scan"]>[0]) {
    this.scanned.push(input.storageKey);
    if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    if (this.options.throwFor?.(input.storageKey)) throw new Error("scanner crashed");
    return this.inner.scan(input);
  }
}

const waiting = { storageStatus: "SCANNING", scanStatus: "PENDING" } as const;
const documentRow = (id: string) => prisma.document.findUniqueOrThrow({ where: { id } });
const versionRow = (id: string) => prisma.documentVersion.findUniqueOrThrow({ where: { id } });
const auditFor = (entityId: string, actionKey: string) => prisma.auditEvent.findMany({ where: { entityId, actionKey } });

beforeAll(async () => {
  await useTemporaryStorage();
});

beforeEach(() => {
  setFileScanner(new CountingScanner());
});

afterEach(async () => {
  setFileScanner(undefined);
  await useTemporaryStorage();
  await removeStoredFiles();
});

afterAll(async () => {
  await releaseTemporaryStorage();
  await reconcileStorageUsage();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("documents.scan", () => {
  describe("idempotency", () => {
    it("scans a waiting file once; a second run changes nothing", async () => {
      const scanner = new CountingScanner();
      setFileScanner(scanner);
      const file = await storedDocument(COMPANY_A, waiting);

      await invokeJob(JOB);
      const first = await documentRow(file.id);
      expect(first).toMatchObject({ storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanAttempts: 1, scanStartedAt: null });
      // Version 1 takes its document's verdict.
      expect(await versionRow(file.versionId)).toMatchObject({ storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanAttempts: 1 });

      await invokeJob(JOB);
      const second = await documentRow(file.id);
      expect(second.updatedAt).toEqual(first.updatedAt);
      expect(scanner.scanned.filter((key) => key === file.storageKey)).toHaveLength(1);
    });

    it("rejects an infected file once, with one audit event, and moves its object out of the business key space", async () => {
      const file = await storedDocument(COMPANY_A, { ...waiting, bytes: EICAR });

      await invokeJob(JOB);
      await invokeJob(JOB);

      expect(await documentRow(file.id)).toMatchObject({ storageStatus: "REJECTED", scanStatus: "INFECTED", rejectionReason: "FILE_REJECTED_MALWARE", scanStartedAt: null });
      expect(await versionRow(file.versionId)).toMatchObject({ storageStatus: "REJECTED", scanStatus: "INFECTED" });
      const audit = await auditFor(file.id, "DOCUMENT_REJECTED_MALWARE");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ companyId: COMPANY_A, actorType: "SYSTEM", actorDisplayNameSnapshot: `System (${JOB})` });
      expect(await objectExists(file.storageKey)).toBe(false);
    });
  });

  describe("concurrency", () => {
    it("two sweeps at once scan a waiting version once and make it current once (§193)", async () => {
      const scanner = new CountingScanner({ delayMs: 150 });
      setFileScanner(scanner);
      const file = await storedDocument(COMPANY_A);
      const v2 = await storedVersion(file, 2, waiting);

      const runs = await Promise.all([invokeJob(JOB), invokeJob(JOB)]);

      expect(runs.reduce((sum, run) => sum + run.processed, 0)).toBe(1);
      expect(scanner.scanned.filter((key) => key === v2.storageKey)).toHaveLength(1);
      expect(await versionRow(v2.id)).toMatchObject({ storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanAttempts: 1 });
      expect(await documentRow(file.id)).toMatchObject({ currentVersionId: v2.id, storageKey: v2.storageKey, storageStatus: "AVAILABLE" });
    });

    it("an upload's inline scan, its retried request and the sweep all at once claim the file once", async () => {
      const scanner = new CountingScanner({ delayMs: 100 });
      setFileScanner(scanner);
      const file = await storedDocument(COMPANY_A);
      const v2 = await storedVersion(file, 2, waiting);

      const [inline, retried] = await Promise.all([runScanForVersion(v2.id), runScanForVersion(v2.id), invokeJob(JOB)]);

      expect([inline, retried].filter((outcome) => outcome === "CLEAN")).toHaveLength(1);
      expect(scanner.scanned.filter((key) => key === v2.storageKey)).toHaveLength(1);
      expect(await versionRow(v2.id)).toMatchObject({ storageStatus: "AVAILABLE", scanAttempts: 1 });
      expect(await documentRow(file.id)).toMatchObject({ currentVersionId: v2.id });
    });

    it("two sweeps at once reject an infected version once, with one audit event", async () => {
      setFileScanner(new CountingScanner({ delayMs: 150 }));
      const file = await storedDocument(COMPANY_A);
      const v2 = await storedVersion(file, 2, { ...waiting, bytes: EICAR });

      await Promise.all([invokeJob(JOB), invokeJob(JOB)]);

      expect(await versionRow(v2.id)).toMatchObject({ storageStatus: "REJECTED", scanStatus: "INFECTED", scanAttempts: 1 });
      expect(await auditFor(file.id, "DOCUMENT_REJECTED_MALWARE")).toHaveLength(1);
      expect(await documentRow(file.id)).toMatchObject({ currentVersionId: file.versionId, storageStatus: "AVAILABLE" });
    });

    it("never lets an older version that finishes late replace the newer one already current", async () => {
      const file = await storedDocument(COMPANY_A);
      // Version 2's scan errored and waits out its retry; version 3 was uploaded, scanned and made current meanwhile.
      const v2 = await storedVersion(file, 2, { storageStatus: "SCANNING", scanStatus: "ERROR", scanAttempts: 1, scanStartedAt: minutesAgo(5) });
      const v3 = await storedVersion(file, 3, { current: true });

      await invokeJob(JOB);

      expect(await versionRow(v2.id)).toMatchObject({ storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanAttempts: 2 });
      expect(await documentRow(file.id)).toMatchObject({ currentVersionId: v3.id, storageKey: v3.storageKey });
    });
  });

  describe("failure", () => {
    it("a scanner that throws on one file leaves that file waiting, scans the rest, and fails the run", async () => {
      const broken = await storedDocument(COMPANY_A, waiting);
      const healthy = await storedDocument(COMPANY_A, waiting);
      setFileScanner(new CountingScanner({ throwFor: (key) => key === broken.storageKey }));

      await expect(invokeJob(JOB)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });

      expect(await documentRow(healthy.id)).toMatchObject({ storageStatus: "AVAILABLE", scanStatus: "CLEAN" });
      expect(await documentRow(broken.id)).toMatchObject({ storageStatus: "SCANNING", scanStatus: "PENDING", scanAttempts: 1 });
    });

    it("takes over a claim whose worker died mid-scan once the lease has passed, and leaves a live one alone (§176)", async () => {
      const abandoned = await storedDocument(COMPANY_A, { storageStatus: "SCANNING", scanStatus: "SCANNING", scanAttempts: 1, scanStartedAt: minutesAgo(20) });
      const inFlight = await storedDocument(COMPANY_A, { storageStatus: "SCANNING", scanStatus: "SCANNING", scanAttempts: 1, scanStartedAt: minutesAgo(1) });

      await invokeJob(JOB);

      expect(await documentRow(abandoned.id)).toMatchObject({ storageStatus: "AVAILABLE", scanStatus: "CLEAN", scanAttempts: 2, scanStartedAt: null });
      expect(await documentRow(inFlight.id)).toMatchObject({ storageStatus: "SCANNING", scanStatus: "SCANNING", scanAttempts: 1 });
    });

    it("retries an ERROR only once its delay has passed, and fails the file after its last attempt (§34, §35, §178)", async () => {
      const early = await storedDocument(COMPANY_A, { storageStatus: "SCANNING", scanStatus: "ERROR", scanAttempts: 3, scanStartedAt: new Date(Date.now() - scanRetryDelayMs(3) + 60_000) });
      const exhausted = await storedDocument(COMPANY_A, { storageStatus: "SCANNING", scanStatus: "ERROR", scanAttempts: MAX_SCAN_ATTEMPTS, scanStartedAt: new Date(Date.now() - scanRetryDelayMs(MAX_SCAN_ATTEMPTS) - 60_000) });

      await invokeJob(JOB);
      await invokeJob(JOB);

      expect(await documentRow(early.id)).toMatchObject({ storageStatus: "SCANNING", scanStatus: "ERROR", scanAttempts: 3 });
      expect(await documentRow(exhausted.id)).toMatchObject({ storageStatus: "FAILED", scanStatus: "ERROR", rejectionReason: "FILE_SCAN_FAILED", scanAttempts: MAX_SCAN_ATTEMPTS, scanStartedAt: null });
      expect(await versionRow(exhausted.versionId)).toMatchObject({ storageStatus: "FAILED", rejectionReason: "FILE_SCAN_FAILED" });
      const audit = await auditFor(exhausted.id, "DOCUMENT_SCAN_FAILED");
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ companyId: COMPANY_A, actorType: "SYSTEM" });
      // Never proven clean, never served — and never deleted for want of a scanner.
      expect(await objectExists(exhausted.storageKey)).toBe(true);
    });

    it("tries a quarantine move that storage refused again, until the object has left the business key space", async () => {
      const storage = await failingStorage();
      const file = await storedDocument(COMPANY_A, { ...waiting, bytes: EICAR });
      storage.failCopy = (key) => key === file.storageKey;

      await expect(invokeJob(JOB)).rejects.toMatchObject({ code: "PARTIAL_FAILURE" });
      // Rejected and audited whatever storage does: the move is what is owed.
      const owed = await documentRow(file.id);
      expect(owed).toMatchObject({ storageStatus: "REJECTED", scanStatus: "INFECTED" });
      expect(owed.scanStartedAt).not.toBeNull();
      expect(await objectExists(file.storageKey)).toBe(true);

      // Taken up again once the claimer has had its lease to make the move itself.
      storage.failCopy = () => false;
      await invokeJob(JOB);
      expect(await objectExists(file.storageKey)).toBe(true);
      await prisma.document.update({ where: { id: file.id }, data: { scanCompletedAt: minutesAgo(20) } });
      await invokeJob(JOB);

      expect(await documentRow(file.id)).toMatchObject({ storageStatus: "REJECTED", scanStartedAt: null });
      expect(await objectExists(file.storageKey)).toBe(false);
      expect(await auditFor(file.id, "DOCUMENT_REJECTED_MALWARE")).toHaveLength(1);
    });
  });

  describe("company isolation", () => {
    it("a run narrowed to one company scans only that company's files", async () => {
      const inA = await storedDocument(COMPANY_A, waiting);
      const inB = await storedDocument(COMPANY_B, { ...waiting, bytes: EICAR });

      await invokeJob(JOB, { companyIds: [COMPANY_A] });
      expect(await documentRow(inA.id)).toMatchObject({ storageStatus: "AVAILABLE" });
      expect(await documentRow(inB.id)).toMatchObject({ storageStatus: "SCANNING", scanStatus: "PENDING", scanAttempts: 0 });

      await invokeJob(JOB);
      expect(await documentRow(inB.id)).toMatchObject({ storageStatus: "REJECTED" });
      // Each file's evidence is written to the file's own company.
      expect((await auditFor(inB.id, "DOCUMENT_REJECTED_MALWARE")).map((event) => event.companyId)).toEqual([COMPANY_B]);
    });
  });

  describe("suspended company", () => {
    it("still scans a suspended company's files: the registry declares it INCLUDED", async () => {
      const file = await storedDocument(COMPANY_SUSPENDED, waiting);

      await invokeJob(JOB);

      expect(await documentRow(file.id)).toMatchObject({ storageStatus: "AVAILABLE", scanStatus: "CLEAN" });
    });
  });
});
