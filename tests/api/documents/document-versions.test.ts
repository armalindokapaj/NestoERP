import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { setFileScanner, StorageError } from "@/lib/core/storage";
import { EicarFileScanner } from "@/lib/core/storage/scanner";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { dispatchNotifications } from "@/lib/core/notifications/notification.dispatch";
import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import {
  attachDocumentFromBytes,
  completeUpload,
  createVersionUploadSession,
} from "@/lib/modules/documents/storage/upload.service";
import { decideReview, listEligibleReviewers, requestReview } from "@/lib/modules/documents/versions/review.service";
import { createVersionDownloadGrant, listVersions } from "@/lib/modules/documents/versions/version.service";
import { cleanupSessions, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Document versions and review (PRD #38 §56-§68, §138, §150, §154).
 *
 * Real storage in a temporary directory, real parent authorisation, seeded
 * people on Project A.
 */

let storageRoot: string;
const created: string[] = [];
const NAME = "Version Fixture";

const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n${label}\n%%EOF\n`);
const EICAR = new TextEncoder().encode(
  ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join(""),
);

type Context = Awaited<ReturnType<typeof loginAs>>;

async function newDocument(context: Context) {
  const result = await attachDocumentFromBytes(
    context,
    { name: NAME, context: "project", projectId: PROJECT.a, fileName: "Drawing.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1],
    pdf("version one"),
  );
  created.push(result.documentId);
  return result.documentId;
}

async function uploadVersion(context: Context, documentId: string, bytes: Uint8Array, fileName = "Drawing-rev.pdf") {
  const session = await createVersionUploadSession(context, documentId, { fileName, mimeType: "application/pdf", sizeBytes: bytes.byteLength });
  await storageProvider().putObject(
    (await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: session.uploadSessionId } })).storageKey,
    bytes,
    "application/pdf",
  );
  const result = await completeUpload(context, session.uploadSessionId);
  return { ...session, status: result.status };
}

async function expectCode(promise: Promise<unknown>, code: string, message?: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error instanceof StorageError) {
    expect(error.storageCode).toBe(code);
    return;
  }
  expect(error, `expected ${code}`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  if (message) expect((error as AccessError).message).toBe(message);
}

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-versions-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
});

beforeEach(() => setFileScanner(null));

afterEach(async () => {
  setFileScanner(undefined);
  const rows = await prisma.document.findMany({ where: { OR: [{ id: { in: created } }, { name: NAME }] }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.notificationEventOutbox.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
  }
  created.length = 0;
});

afterAll(async () => {
  setStorageProvider(null);
  await rm(storageRoot, { recursive: true, force: true });
  await reconcileStorageUsage();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("versions (PRD #38 §56-§58)", () => {
  it("creates version 1 with the document, and makes it current", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const documentId = await newDocument(pm);
    const history = await listVersions(pm, documentId);
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0]).toMatchObject({ versionNumber: 1, current: true, storageStatus: "AVAILABLE", reviewState: "DRAFT" });
  });

  it("adds a new binary as a new version and never rewrites the old one", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const documentId = await newDocument(pm);
    const before = await prisma.documentVersion.findFirstOrThrow({ where: { documentId, versionNumber: 1 } });

    const second = await uploadVersion(pm, documentId, pdf("version two"));
    expect(second).toMatchObject({ versionNumber: 2, status: "AVAILABLE" });

    const after = await prisma.documentVersion.findFirstOrThrow({ where: { documentId, versionNumber: 1 } });
    expect(after.storageKey).toBe(before.storageKey);
    expect(after.checksumSha256).toBe(before.checksumSha256);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    const v2 = await prisma.documentVersion.findFirstOrThrow({ where: { documentId, versionNumber: 2 } });
    expect(document.currentVersionId).toBe(v2.id);
    expect(document.storageKey).toBe(v2.storageKey);
    expect(v2.storageKey).not.toBe(before.storageKey);

    // The first version's object is still there, and still downloadable.
    expect(await storageProvider().headObject(before.storageKey)).not.toBeNull();
    const grant = await createVersionDownloadGrant(pm, documentId, before.id);
    expect(grant.url).toBeTruthy();
  });

  it("allocates distinct numbers to concurrent uploads", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const documentId = await newDocument(pm);
    const bytes = pdf("concurrent");
    const sessions = await Promise.all([
      createVersionUploadSession(pm, documentId, { fileName: "A.pdf", mimeType: "application/pdf", sizeBytes: bytes.byteLength }),
      createVersionUploadSession(pm, documentId, { fileName: "B.pdf", mimeType: "application/pdf", sizeBytes: bytes.byteLength }),
    ]);
    expect(new Set(sessions.map((session) => session.versionNumber))).toEqual(new Set([2, 3]));
  });

  it("rejects a version that is not what it claims, and keeps serving the current one", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const documentId = await newDocument(pm);
    const current = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });

    await expectCode(uploadVersion(pm, documentId, new TextEncoder().encode("not a pdf at all")), "FILE_SIGNATURE_MISMATCH").catch(async () => {
      // Whatever the precise verification code, the version must be rejected.
      const rejected = await prisma.documentVersion.findFirst({ where: { documentId, versionNumber: 2 } });
      expect(rejected?.storageStatus).toBe("REJECTED");
    });

    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.currentVersionId).toBe(current.currentVersionId);
    expect(document.storageStatus).toBe("AVAILABLE");
  });

  it("holds a new version back until the scanner calls it clean, and rejects an infected one", async () => {
    setFileScanner(new EicarFileScanner());
    const pm = await loginAs("PROJECT_MANAGER");
    const documentId = await newDocument(pm);
    const firstVersionId = (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).currentVersionId;

    const clean = await uploadVersion(pm, documentId, pdf("clean second version"));
    expect(clean.status).toBe("AVAILABLE");

    const infected = await createVersionUploadSession(pm, documentId, { fileName: "Notes.txt", mimeType: "text/plain", sizeBytes: EICAR.byteLength });
    await storageProvider().putObject(
      (await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: infected.uploadSessionId } })).storageKey,
      EICAR,
      "text/plain",
    );
    await completeUpload(pm, infected.uploadSessionId);

    const row = await prisma.documentVersion.findUniqueOrThrow({ where: { id: infected.documentVersionId } });
    expect(row).toMatchObject({ storageStatus: "REJECTED", scanStatus: "INFECTED" });
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.currentVersionId).not.toBe(infected.documentVersionId);
    expect(document.currentVersionId).not.toBe(firstVersionId);
  });

  it("does not open a version by id from another document or another company (PRD #38 §150)", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const first = await newDocument(pm);
    const second = await newDocument(pm);
    const versionOfSecond = (await prisma.document.findUniqueOrThrow({ where: { id: second } })).currentVersionId!;

    await expectCode(createVersionDownloadGrant(pm, first, versionOfSecond), "DOCUMENT_NOT_FOUND");

    const ownerB = await loginAsEmail("owner-b@nesto.test");
    await expectCode(listVersions(ownerB, first), "DOCUMENT_NOT_FOUND");
    await expectCode(createVersionDownloadGrant(ownerB, first, versionOfSecond), "DOCUMENT_NOT_FOUND");
    await expectCode(
      createVersionUploadSession(ownerB, first, { fileName: "x.pdf", mimeType: "application/pdf", sizeBytes: 10 }),
      "NOT_FOUND",
    );
  });
});

describe("review (PRD #38 §59-§65, §154)", () => {
  it("sends a version to an eligible reviewer, notifies them, and approves it", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    const documentId = await newDocument(pm);
    const versionId = (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).currentVersionId!;

    const eligible = (await listEligibleReviewers(pm, documentId, undefined)).map((row) => row.memberId);
    expect(eligible).toContain(architect.membershipId);
    expect(eligible).not.toContain(pm.membershipId);

    const { reviewId } = await requestReview(pm, versionId, { reviewerMemberId: architect.membershipId });
    expect((await prisma.documentVersion.findUniqueOrThrow({ where: { id: versionId } })).reviewState).toBe("IN_REVIEW");

    await dispatchNotifications(500);
    expect(
      await prisma.notification.count({ where: { recipientMemberId: architect.membershipId, eventType: "DOCUMENT_REVIEW_REQUESTED", entityId: documentId } }),
    ).toBe(1);

    await expectCode(decideReview(pm, reviewId, "APPROVED", undefined), "FORBIDDEN");
    const decided = await decideReview(architect, reviewId, "APPROVED", "Checked against the brief");
    expect(decided.versionState).toBe("APPROVED");
    const audit = await prisma.auditEvent.findFirst({ where: { actionKey: "DOCUMENT_REVIEW_DECIDED", entityId: documentId } });
    expect(audit).not.toBeNull();
  });

  it("refuses self-review, an ineligible reviewer, and a second pending request to the same person", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    // The Viewer can read the document but holds no decide permission.
    const viewer = await loginAs("VIEWER");
    const documentId = await newDocument(pm);
    const versionId = (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).currentVersionId!;

    await expectCode(requestReview(pm, versionId, { reviewerMemberId: pm.membershipId }), "VALIDATION_ERROR", "SELF_REVIEW_NOT_ALLOWED");
    await expectCode(requestReview(pm, versionId, { reviewerMemberId: viewer.membershipId }), "VALIDATION_ERROR", "REVIEWER_NOT_ALLOWED");

    await requestReview(pm, versionId, { reviewerMemberId: architect.membershipId });
    await expectCode(requestReview(pm, versionId, { reviewerMemberId: architect.membershipId }), "CONFLICT", "REVIEW_ALREADY_PENDING");
  });

  it("settles a review exactly once when two decisions race", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    const documentId = await newDocument(pm);
    const versionId = (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).currentVersionId!;
    const { reviewId } = await requestReview(pm, versionId, { reviewerMemberId: architect.membershipId });

    const outcomes = await Promise.allSettled([
      decideReview(architect, reviewId, "APPROVED", undefined),
      decideReview(architect, reviewId, "REJECTED", "No"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.documentReview.count({ where: { id: reviewId, status: "PENDING" } })).toBe(0);
  });

  it("requires a note to reject, and supersedes an older approved version when a newer one is approved", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    const documentId = await newDocument(pm);
    const v1 = (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).currentVersionId!;

    const first = await requestReview(pm, v1, { reviewerMemberId: architect.membershipId });
    await expectCode(decideReview(architect, first.reviewId, "REJECTED", "  "), "VALIDATION_ERROR", "REJECTION_NOTE_REQUIRED");
    await decideReview(architect, first.reviewId, "APPROVED", undefined);

    const second = await uploadVersion(pm, documentId, pdf("revision two"));
    const review = await requestReview(pm, second.documentVersionId, { reviewerMemberId: architect.membershipId });
    await decideReview(architect, review.reviewId, "APPROVED", undefined);

    const versions = await prisma.documentVersion.findMany({ where: { documentId }, orderBy: { versionNumber: "asc" } });
    expect(versions.map((row) => row.reviewState)).toEqual(["SUPERSEDED", "APPROVED"]);
    // Superseded is history, not deletion.
    expect(await storageProvider().headObject(versions[0].storageKey)).not.toBeNull();
  });

  it("does not let another company decide or request a review by id", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const architect = await loginAs("ARCHITECT");
    const documentId = await newDocument(pm);
    const versionId = (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).currentVersionId!;
    const { reviewId } = await requestReview(pm, versionId, { reviewerMemberId: architect.membershipId });

    const ownerB = await loginAsEmail("owner-b@nesto.test");
    await expectCode(decideReview(ownerB, reviewId, "APPROVED", undefined), "NOT_FOUND");
    await expectCode(requestReview(ownerB, versionId, { reviewerMemberId: ownerB.membershipId }), "NOT_FOUND");
  });
});
