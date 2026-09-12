import { describe, expect, it } from "vitest";
import type { DocumentStorageStatus } from "@prisma/client";

import {
  assertTransition,
  canTransition,
  isDownloadable,
  PENDING_STORAGE_STATUSES,
  storageStatusMessage,
  StorageError,
} from "@/lib/core/storage";

/**
 * The storage state machine (PRD #29 §320-§322).
 *
 * Two properties carry the whole design, and both are tested as prohibitions
 * rather than as happy paths.
 */
describe("document storage transitions", () => {
  it("walks the authorised path from intent to available", () => {
    expect(canTransition("PENDING_UPLOAD", "UPLOADED")).toBe(true);
    expect(canTransition("UPLOADED", "VERIFYING")).toBe(true);
    expect(canTransition("VERIFYING", "SCANNING")).toBe(true);
    expect(canTransition("VERIFYING", "AVAILABLE")).toBe(true);
    expect(canTransition("SCANNING", "AVAILABLE")).toBe(true);
    expect(canTransition("SCANNING", "REJECTED")).toBe(true);
  });

  /**
   * Nothing reaches AVAILABLE without being verified. A metadata row is never
   * evidence that a file exists (PRD #29 §233).
   */
  it("never lets an unverified document become available", () => {
    expect(canTransition("PENDING_UPLOAD", "AVAILABLE")).toBe(false);
    expect(canTransition("UPLOADED", "AVAILABLE")).toBe(false);
  });

  /**
   * A scan or preview worker finishing after somebody archived the file must
   * not resurrect it (PRD #29 §319).
   */
  it("never lets a worker bring an archived document back", () => {
    expect(canTransition("ARCHIVED", "SCANNING")).toBe(false);
    expect(canTransition("ARCHIVED", "VERIFYING")).toBe(false);
    // Only an explicit restore does that.
    expect(canTransition("ARCHIVED", "AVAILABLE")).toBe(true);
  });

  it("treats rejection and failure as terminal (§335)", () => {
    const terminal: DocumentStorageStatus[] = ["REJECTED", "FAILED"];
    const every: DocumentStorageStatus[] = [
      "PENDING_UPLOAD", "UPLOADED", "VERIFYING", "SCANNING", "AVAILABLE", "REJECTED", "FAILED", "ARCHIVED",
    ];

    for (const from of terminal) {
      for (const to of every) expect(canTransition(from, to), `${from}->${to}`).toBe(false);
    }
  });

  it("lets any in-flight state fail", () => {
    for (const status of PENDING_STORAGE_STATUSES) {
      expect(canTransition(status, "FAILED"), status).toBe(true);
    }
  });

  it("refuses an illegal transition with the documented code (§322)", () => {
    try {
      assertTransition("AVAILABLE", "SCANNING");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).storageCode).toBe("INVALID_DOCUMENT_STORAGE_STATE");
    }
  });

  it("serves a download from exactly one state (§162)", () => {
    expect(isDownloadable("AVAILABLE")).toBe(true);
    for (const status of ["PENDING_UPLOAD", "UPLOADED", "VERIFYING", "SCANNING", "REJECTED", "FAILED", "ARCHIVED"] as const) {
      expect(isDownloadable(status), status).toBe(false);
    }
  });

  it("says something useful while a file is not ready (§163-§165)", () => {
    expect(storageStatusMessage("SCANNING")).toBe("Processing…");
    expect(storageStatusMessage("REJECTED")).toBe("Upload rejected.");
    expect(storageStatusMessage("FAILED")).toBe("File processing failed.");
    expect(storageStatusMessage("AVAILABLE")).toBeNull();
  });
});
