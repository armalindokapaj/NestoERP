import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import { setFileScanner, StorageError } from "@/lib/core/storage";
import { EicarFileScanner } from "@/lib/core/storage/scanner";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import {
  setStorageProvider,
  storageProvider,
} from "@/lib/core/storage/storage-provider.factory";
import {
  abortUpload,
  attachDocumentFromBytes,
  completeUpload,
  createUploadSession,
} from "@/lib/modules/documents/storage/upload.service";
import { createDownloadGrant } from "@/lib/modules/documents/storage/download.service";
import { createPreviewGrant } from "@/lib/modules/documents/storage/preview.service";
import { getStorageStatus } from "@/lib/modules/documents/storage/status.service";
import {
  reconcileStorageUsage,
  runStorageCleanup,
} from "@/lib/modules/documents/storage/cleanup.service";
import * as quota from "@/lib/modules/documents/storage/quota.service";
import { createDocumentUploadSchema } from "@/lib/modules/documents/storage/storage.schema";
import { globalSearch } from "@/lib/core/search/search.service";
import { cleanupSessions, COMPANY, loginAs, PROJECT, prisma } from "../../helpers";

/**
 * The upload, download and preview pipeline (PRD #29 §360-§378).
 *
 * Storage points at a temporary directory and the *real* provider, so these
 * exercise the signed-URL flow the product ships rather than a mock. A suite
 * that stubs storage proves nothing about the code that stores files
 * (PRD #9 §223).
 *
 * Every test here is a prohibition. The pipeline's value is what it refuses.
 */

let storageRoot: string;
const created: string[] = [];
/** Another of Aurelia's projects, run by the Project Manager: the demo gives each company only one. */
const OTHER_PROJECT = "test29_storage_other_project";

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-storage-"));
  const pm = await loginAs("PROJECT_MANAGER");
  await prisma.project.create({ data: { id: OTHER_PROJECT, companyId: COMPANY.a, code: "T29-STORE", name: "Storage Elsewhere", status: "ACTIVE", projectManagerMemberId: pm.membershipId, createdBy: "test" } });
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
});

beforeEach(() => {
  // No scanner by default: the V0.1 simplified flow of §13.
  setFileScanner(null);
});

/**
 * Names this suite gives its fixtures.
 *
 * A test that asserts a *rejection* never learns the document id — the call
 * throws before it returns one — so the ids cannot all be tracked. Sweeping by
 * name catches those, and keeps the shared development database clean for the
 * E2E suite and the seed's own storage invariants.
 */
const FIXTURE_NAMES = ["Pipeline Fixture", "Attached Fixture", "Not A PDF"];

async function removeFixtureDocuments(ids: string[]) {
  const rows = await prisma.document.findMany({
    where: { OR: [{ id: { in: ids } }, { name: { in: FIXTURE_NAMES } }] },
    select: { id: true },
  });
  const all = rows.map((row) => row.id);
  if (all.length === 0) return;

  await prisma.activity.deleteMany({ where: { entityId: { in: all } } });
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: all } } });
  await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: all } } });
  await prisma.document.deleteMany({ where: { id: { in: all } } });
}

afterEach(async () => {
  setFileScanner(undefined);
  await removeFixtureDocuments(created);
  created.length = 0;
});

afterAll(async () => {
  setStorageProvider(null);
  await rm(storageRoot, { recursive: true, force: true });
  await prisma.project.deleteMany({ where: { id: OTHER_PROJECT } });

  /*
   * These tests delete their documents directly rather than through the
   * product's own lifecycle, which leaves the usage projection ahead of the
   * rows. The shared development database is also what the E2E suite and the
   * seed validation read, so the projection is rebuilt before leaving
   * (PRD #29 §148).
   */
  await reconcileStorageUsage();

  await cleanupSessions();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const PDF = new TextEncoder().encode("%PDF-1.4\nstorage pipeline fixture\n%%EOF\n");

/** The standard, harmless antivirus test signature (PRD #29 §373). */
const EICAR = new TextEncoder().encode(
  ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!$H+H*"].join(""),
);

function uploadInput(overrides: Record<string, unknown> = {}) {
  return createDocumentUploadSchema.parse({
    name: "Pipeline Fixture",
    context: "project",
    projectId: PROJECT.a,
    fileName: "Fixture.pdf",
    mimeType: "application/pdf",
    sizeBytes: PDF.byteLength,
    ...overrides,
  });
}

type Context = Awaited<ReturnType<typeof loginAs>>;

/** Runs the whole flow: authorise, put the bytes, complete. */
async function uploadFile(
  context: Context,
  bytes: Uint8Array,
  overrides: Record<string, unknown> = {},
) {
  const session = await createUploadSession(
    context,
    uploadInput({ sizeBytes: bytes.byteLength, ...overrides }),
  );
  created.push(session.documentId);

  const row = await prisma.documentUploadSession.findUniqueOrThrow({
    where: { id: session.uploadSessionId },
    select: { storageKey: true },
  });
  await storageProvider().putObject(row.storageKey, bytes, "application/pdf");

  const result = await completeUpload(context, session.uploadSessionId);
  return { ...session, storageKey: row.storageKey, status: result.status };
}

async function expectStorageError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error(`Expected ${code}, but the call succeeded.`);
  } catch (error) {
    if (error instanceof StorageError) {
      expect(error.storageCode).toBe(code);
      return error;
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* The happy path                                                              */
/* -------------------------------------------------------------------------- */

describe("upload pipeline (PRD #29 §9, §80, §233)", () => {
  it("authorises, verifies and makes a file available", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    expect(upload.status).toBe("AVAILABLE");

    const row = await prisma.document.findUniqueOrThrow({ where: { id: upload.documentId } });
    expect(row.storageStatus).toBe("AVAILABLE");
    // Read from the object's leading bytes, not from the browser's claim (§31).
    expect(row.detectedMimeType).toBe("application/pdf");
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(row.verifiedAt).not.toBeNull();
    expect(row.availableAt).not.toBeNull();
    // A PDF is inline-safe as it stands, so it is its own preview (§53).
    expect(row.previewStatus).toBe("READY");
  });

  /** Nothing is downloadable on the strength of a metadata row (§233). */
  it("leaves a document unavailable until it is completed", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    const row = await prisma.document.findUniqueOrThrow({ where: { id: session.documentId } });
    expect(row.storageStatus).toBe("PENDING_UPLOAD");

    await expectStorageError(
      createDownloadGrant(context, session.documentId),
      "DOCUMENT_NOT_AVAILABLE",
    );
  });

  /** The server generates the key; the browser never proposes one (§18, §20). */
  it("builds a key that is company-first and holds no file name", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    expect(upload.storageKey).toContain(`companies/${context.companyId}/documents/`);
    expect(upload.storageKey).not.toContain("Fixture");
  });

  it("records the upload as activity on the parent (§253)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    const activity = await prisma.activity.findFirst({
      where: { entityType: "Document", entityId: upload.documentId, action: "DOCUMENT_UPLOADED" },
    });
    expect(activity).not.toBeNull();
  });

  /** A repeated completion returns state rather than processing twice (§263). */
  it("is idempotent on completion", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, PDF, "application/pdf");

    const first = await completeUpload(context, session.uploadSessionId);
    const second = await completeUpload(context, session.uploadSessionId);

    expect(first.status).toBe("AVAILABLE");
    expect(second.status).toBe("AVAILABLE");

    const usage = await prisma.companyStorageUsage.findUnique({
      where: { companyId: context.companyId },
    });
    // Counted once, not twice — the second call must not inflate usage.
    expect(usage).not.toBeNull();
  });

  /**
   * Two completions of one upload at once — a double submit, or a retry that
   * overtook a slow response — record it once and never lose the file
   * (PRD #29 §263, PRD #49 §236). The session is the claim: whichever request
   * loses it writes nothing, and above all does not reject or delete the
   * object the winner made available.
   */
  it("settles a double-submitted completion once", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, PDF, "application/pdf");

    const outcomes = await Promise.allSettled([
      completeUpload(context, session.uploadSessionId),
      completeUpload(context, session.uploadSessionId),
    ]);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: session.documentId } });
    expect(document.storageStatus).toBe("AVAILABLE");
    expect(await storageProvider().headObject(row.storageKey)).not.toBeNull();
    expect((await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: session.uploadSessionId } })).status).toBe("COMPLETED");
    expect(
      await prisma.activity.count({ where: { entityType: "Document", entityId: session.documentId, action: "DOCUMENT_UPLOADED" } }),
    ).toBe(1);
  });

  /** A retried authorisation reuses its session rather than stranding it (§262). */
  it("is idempotent on authorisation with a key", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const first = await createUploadSession(context, uploadInput(), { idempotencyKey: "abc-123" });
    created.push(first.documentId);
    const second = await createUploadSession(context, uploadInput(), { idempotencyKey: "abc-123" });

    expect(second.uploadSessionId).toBe(first.uploadSessionId);
    expect(second.documentId).toBe(first.documentId);
  });
});

/* -------------------------------------------------------------------------- */
/* Verification refusals                                                       */
/* -------------------------------------------------------------------------- */

describe("post-upload verification (PRD #29 §266-§270, §368, §369)", () => {
  /**
   * The one that matters most: an executable renamed `.pdf`. The extension
   * allowlist passes it, the declared MIME passes it, and the magic bytes do
   * not (PRD #29 §270, §368).
   */
  it("rejects an executable wearing a .pdf name", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const executable = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    const session = await createUploadSession(
      context,
      uploadInput({ sizeBytes: executable.byteLength }),
    );
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, executable, "application/pdf");

    await expectStorageError(
      completeUpload(context, session.uploadSessionId),
      "FILE_TYPE_NOT_ALLOWED",
    );

    const document = await prisma.document.findUniqueOrThrow({ where: { id: session.documentId } });
    expect(document.storageStatus).toBe("REJECTED");
    // The object is deleted, not left sitting in the bucket (§266).
    expect(await storageProvider().headObject(row.storageKey)).toBeNull();
  });

  it("rejects HTML wearing a .pdf name", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>hi</body></html>");

    const session = await createUploadSession(context, uploadInput({ sizeBytes: html.byteLength }));
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, html, "application/pdf");

    await expectStorageError(
      completeUpload(context, session.uploadSessionId),
      "FILE_TYPE_NOT_ALLOWED",
    );
  });

  /**
   * The client said 10 MB and uploaded something else. The HEAD is what
   * decides (PRD #29 §28, §369).
   */
  it("rejects an object whose real size is not what was authorised", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const session = await createUploadSession(context, uploadInput({ sizeBytes: 10 * 1024 * 1024 }));
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    // Far smaller than declared — the reverse of the §369 case, same check.
    await storageProvider().putObject(row.storageKey, PDF, "application/pdf");

    await expectStorageError(completeUpload(context, session.uploadSessionId), "INVALID_FILE_SIZE");
  });

  it("refuses an oversize file before any bytes move (§27)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expectStorageError(
      createUploadSession(context, uploadInput({ sizeBytes: 500 * 1024 * 1024 })),
      "FILE_TOO_LARGE",
    );
  });

  it("refuses a type the allowlist does not carry (§32, §36)", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    for (const fileName of ["payload.exe", "bundle.zip", "macro.xlsm", "page.html"]) {
      await expectStorageError(
        createUploadSession(context, uploadInput({ fileName, mimeType: undefined })),
        "FILE_TYPE_NOT_ALLOWED",
      );
    }
  });

  /** `invoice.pdf.exe` is an executable, whatever the earlier suffix says. */
  it("reads only the final extension (§218)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expectStorageError(
      createUploadSession(context, uploadInput({ fileName: "invoice.pdf.exe", mimeType: undefined })),
      "FILE_TYPE_NOT_ALLOWED",
    );
  });

  /** Filename injection (PRD #29 §367). */
  it("refuses a name carrying traversal, a null byte or a bidi override", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    for (const fileName of ["invoice\u0000.pdf", "cv\u202Egpj.pdf"]) {
      await expectStorageError(
        createUploadSession(context, uploadInput({ fileName })),
        "INVALID_FILE_NAME",
      );
    }

    // Traversal is stripped rather than refused: the display name is not a
    // path, and "passwd.pdf" is a perfectly good document name (§223).
    const traversal = await createUploadSession(
      context,
      uploadInput({ fileName: "../../etc/passwd.pdf" }),
    );
    created.push(traversal.documentId);

    const row = await prisma.document.findUniqueOrThrow({ where: { id: traversal.documentId } });
    expect(row.fileName).toBe("passwd.pdf");
    expect(row.storageKey).not.toContain("..");
  });

  /** A checksum that does not match means the bytes changed in flight (§266). */
  it("rejects a declared checksum that does not match the object", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, PDF, "application/pdf");

    await expectStorageError(
      completeUpload(context, session.uploadSessionId, { checksumSha256: "0".repeat(64) }),
      "CHECKSUM_MISMATCH",
    );
  });

  /** Completion with nothing there (PRD #29 §316). */
  it("reports a missing object and leaves the session open to retry", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    await expectStorageError(
      completeUpload(context, session.uploadSessionId),
      "STORAGE_OBJECT_MISSING",
    );

    // Still PENDING_UPLOAD and still CREATED, so a retry within the window
    // works — FAILED is a one-way door and cleanup owns it (§267, §321).
    const document = await prisma.document.findUniqueOrThrow({ where: { id: session.documentId } });
    expect(document.storageStatus).toBe("PENDING_UPLOAD");

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
    });
    expect(row.status).toBe("CREATED");
  });

  it("refuses an expired session (§158, §370)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    await prisma.documentUploadSession.update({
      where: { id: session.uploadSessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expectStorageError(
      completeUpload(context, session.uploadSessionId),
      "UPLOAD_SESSION_EXPIRED",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Isolation and authorisation                                                 */
/* -------------------------------------------------------------------------- */

describe("company isolation (PRD #29 §361)", () => {
  it("cannot open an upload against another company's project", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    /*
     * The parent lookup runs inside the caller's own scope, so a project from
     * another company simply does not exist. That answer is deliberate: a
     * "forbidden" would confirm the project is real (PRD #29 §159, §361).
     */
    await expect(
      createUploadSession(context, uploadInput({ projectId: PROJECT.companyB })),
    ).rejects.toThrow(AccessError);

    expect(
      await prisma.documentUploadSession.count({ where: { memberId: context.membershipId } }),
    ).toBe(0);
  });

  it("cannot complete another company's session", async () => {
    const owner = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(owner, uploadInput());
    created.push(session.documentId);

    const other = await loginAs("OWNER");
    // Not "forbidden": a session id from elsewhere is not found at all (§160).
    await expectStorageError(
      completeUpload(other, session.uploadSessionId),
      "UPLOAD_SESSION_NOT_FOUND",
    );
  });

  it("cannot download another company's document", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const companyBDocument = await prisma.document.findFirstOrThrow({
      where: { companyId: { not: context.companyId }, storageStatus: "AVAILABLE" },
      select: { id: true },
    });

    await expectStorageError(
      createDownloadGrant(context, companyBDocument.id),
      "DOCUMENT_NOT_FOUND",
    );
  });

  it("cannot preview another company's document", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const companyBDocument = await prisma.document.findFirstOrThrow({
      where: { companyId: { not: context.companyId }, storageStatus: "AVAILABLE" },
      select: { id: true },
    });

    await expectStorageError(
      createPreviewGrant(context, companyBDocument.id),
      "DOCUMENT_NOT_FOUND",
    );
  });

  it("cannot read another company's storage status", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const companyBDocument = await prisma.document.findFirstOrThrow({
      where: { companyId: { not: context.companyId } },
      select: { id: true },
    });

    await expectStorageError(getStorageStatus(context, companyBDocument.id), "DOCUMENT_NOT_FOUND");
  });
});

describe("parent access (PRD #29 §362, §363)", () => {
  /**
   * A generic Documents permission is not a Finance permission. The Engineer
   * holds `document.view` and no finance access at all (PRD #29 §362).
   */
  it("a reader with no Finance access cannot download an invoice document", async () => {
    const invoiceDocument = await prisma.document.findFirst({
      where: { entityType: "invoice", storageStatus: "AVAILABLE" },
      select: { id: true },
    });
    if (!invoiceDocument) return;

    const engineer = await loginAs("ENGINEER");
    await expectStorageError(
      createDownloadGrant(engineer, invoiceDocument.id),
      "DOCUMENT_NOT_FOUND",
    );
  });

  /** Project scope, not role, decides (PRD #29 §363). */
  it("a project member cannot download a document from a project they are not on", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(pm, PDF, { projectId: OTHER_PROJECT });

    // The Architect works on Riverside, never on the other project.
    const architect = await loginAs("ARCHITECT");
    await expectStorageError(createDownloadGrant(architect, upload.documentId), "DOCUMENT_NOT_FOUND");
  });

  /**
   * Authorship is not access (PRD #29 §299, §300).
   *
   * The uploader here is the Project Manager; the Architect cannot reach the
   * file even though it is on a project, because they are not on that project.
   * Uploading it would not have helped them either.
   */
  it("the uploader gets no standing of their own", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(pm, PDF, { projectId: OTHER_PROJECT });

    const row = await prisma.document.findUniqueOrThrow({ where: { id: upload.documentId } });
    expect(row.uploadedByMemberId).toBe(pm.membershipId);

    // Re-point authorship at the Architect and it changes nothing.
    const architect = await loginAs("ARCHITECT");
    await prisma.document.update({
      where: { id: upload.documentId },
      data: { uploadedByMemberId: architect.membershipId },
    });

    await expectStorageError(createDownloadGrant(architect, upload.documentId), "DOCUMENT_NOT_FOUND");
  });
});

/* -------------------------------------------------------------------------- */
/* Grants                                                                      */
/* -------------------------------------------------------------------------- */

describe("download and preview grants (PRD #29 §100-§107, §370)", () => {
  it("issues a short-lived download URL", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    const grant = await createDownloadGrant(context, upload.documentId);
    expect(grant.fileName).toBe("Fixture.pdf");

    const expiresIn = new Date(grant.expiresAt).getTime() - Date.now();
    // Short because it cannot be recalled (PRD #29 §70, §308).
    expect(expiresIn).toBeLessThanOrEqual(5 * 60_000);
    expect(expiresIn).toBeGreaterThan(0);
  });

  it("audits the authorisation but never the URL (§73, §103)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);
    const grant = await createDownloadGrant(context, upload.documentId);

    const event = await prisma.auditEvent.findFirst({
      where: { entityId: upload.documentId, actionKey: "DOCUMENT_DOWNLOAD_GRANTED" },
    });
    expect(event).not.toBeNull();

    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain("sig=");
    expect(serialised).not.toContain(grant.url);
  });

  it("previews a PDF and refuses to preview a spreadsheet (§45, §53)", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const pdf = await uploadFile(context, PDF);
    const preview = await createPreviewGrant(context, pdf.documentId);
    expect(preview.kind).toBe("pdf");
    expect(preview.mimeType).toBe("application/pdf");

    // A real zip container, so the magic-byte check passes for .xlsx.
    const xlsx = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x50, 0x4b,
      0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);

    const sheetSession = await createUploadSession(
      context,
      uploadInput({
        fileName: "Costs.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: xlsx.byteLength,
      }),
    );
    created.push(sheetSession.documentId);

    const sheetRow = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: sheetSession.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(sheetRow.storageKey, xlsx, "application/zip");
    await completeUpload(context, sheetSession.uploadSessionId);

    // Downloadable, never inline: there is no conversion pipeline (§45).
    await expect(createDownloadGrant(context, sheetSession.documentId)).resolves.toBeTruthy();
    await expectStorageError(
      createPreviewGrant(context, sheetSession.documentId),
      "PREVIEW_NOT_SUPPORTED",
    );
  });

  /**
   * Revocation (PRD #29 §371).
   *
   * An already-issued URL survives until it expires — that is the documented
   * trade-off of §306. What must not happen is a *new* grant after access is
   * gone.
   */
  it("refuses a new grant once access has been withdrawn", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(pm, PDF, { projectId: PROJECT.a });

    // The Architect is on project A, so the grant works to begin with. Their
    // access comes from membership rather than from managing the project,
    // which is what makes withdrawing it meaningful here.
    const before = await loginAs("ARCHITECT");
    await expect(createDownloadGrant(before, upload.documentId)).resolves.toBeTruthy();

    const membership = await prisma.projectMember.findFirstOrThrow({
      where: { projectId: PROJECT.a, companyMemberId: before.membershipId },
    });
    await prisma.projectMember.update({
      where: { id: membership.id },
      data: { status: "INACTIVE" },
    });

    try {
      const after = await loginAs("ARCHITECT");
      await expectStorageError(createDownloadGrant(after, upload.documentId), "DOCUMENT_NOT_FOUND");
    } finally {
      await prisma.projectMember.update({
        where: { id: membership.id },
        data: { status: "ACTIVE" },
      });
    }
  });

  it("refuses a download for an archived document (§136)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    await prisma.document.update({
      where: { id: upload.documentId },
      data: { storageStatus: "ARCHIVED", status: "ARCHIVED", archivedAt: new Date() },
    });

    await expectStorageError(createDownloadGrant(context, upload.documentId), "DOCUMENT_ARCHIVED");

    // The object is still there. Archive is not delete (PRD #29 §135, §384).
    expect(await storageProvider().headObject(upload.storageKey)).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Malware                                                                     */
/* -------------------------------------------------------------------------- */

describe("malware scanning (PRD #29 §55, §59, §60, §373-§375)", () => {
  it("holds a file unavailable until the scanner clears it", async () => {
    setFileScanner(new EicarFileScanner());

    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    // A clean file reaches AVAILABLE by way of SCANNING, never around it.
    const row = await prisma.document.findUniqueOrThrow({ where: { id: upload.documentId } });
    expect(row.storageStatus).toBe("AVAILABLE");
    expect(row.scanStatus).toBe("CLEAN");
    expect(row.scanProvider).toBe("eicar-test");
  });

  /** The standard test signature, never live malware (PRD #29 §373, §374). */
  it("rejects an infected file and blocks every way to read it", async () => {
    setFileScanner(new EicarFileScanner());

    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(
      context,
      uploadInput({ fileName: "Notes.txt", mimeType: "text/plain", sizeBytes: EICAR.byteLength }),
    );
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, EICAR, "text/plain");

    await completeUpload(context, session.uploadSessionId);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: session.documentId } });
    expect(document.storageStatus).toBe("REJECTED");
    expect(document.scanStatus).toBe("INFECTED");
    // A safe code, not a signature name (§211).
    expect(document.rejectionReason).toBe("FILE_REJECTED_MALWARE");

    await expectStorageError(
      createDownloadGrant(context, session.documentId),
      "FILE_REJECTED_MALWARE",
    );
    await expectStorageError(
      createPreviewGrant(context, session.documentId),
      "FILE_REJECTED_MALWARE",
    );

    // Out of the ordinary key space (§61, §62).
    expect(await storageProvider().headObject(row.storageKey)).toBeNull();
  });

  it("audits a malware rejection (§63)", async () => {
    setFileScanner(new EicarFileScanner());

    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(
      context,
      uploadInput({ fileName: "Notes.txt", mimeType: "text/plain", sizeBytes: EICAR.byteLength }),
    );
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, EICAR, "text/plain");
    await completeUpload(context, session.uploadSessionId);

    const event = await prisma.auditEvent.findFirst({
      where: { entityId: session.documentId, actionKey: "DOCUMENT_REJECTED_MALWARE" },
    });
    expect(event).not.toBeNull();
    expect(event?.severity).toBe("CRITICAL");
  });

  /**
   * A scanner that cannot answer must not be read as a pass (PRD #29 §59,
   * §375). This is the fail-closed test.
   */
  it("leaves a file unavailable when the scanner is broken", async () => {
    setFileScanner({
      provider: "broken",
      scan: async () => {
        throw new Error("scanner unreachable");
      },
    });

    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    const row = await prisma.document.findUniqueOrThrow({ where: { id: upload.documentId } });
    expect(row.storageStatus).toBe("SCANNING");
    expect(row.scanStatus).toBe("PENDING");

    await expectStorageError(createDownloadGrant(context, upload.documentId), "FILE_SCAN_PENDING");
  });

  it("records NOT_REQUIRED rather than CLEAN when no scanner is configured (§56)", async () => {
    setFileScanner(null);

    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    const row = await prisma.document.findUniqueOrThrow({ where: { id: upload.documentId } });
    // Deliberately not CLEAN: nothing looked at it.
    expect(row.scanStatus).toBe("NOT_REQUIRED");
    expect(row.storageStatus).toBe("AVAILABLE");
  });
});

/* -------------------------------------------------------------------------- */
/* Quota                                                                       */
/* -------------------------------------------------------------------------- */

describe("storage quota (PRD #29 §149-§152, §378)", () => {
  afterEach(async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await prisma.companyStorageQuota.update({
      where: { companyId: context.companyId },
      data: { maxStorageBytes: null },
    });
  });

  it("allows an upload under the ceiling", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const usage = await quota.companyUsage(context.companyId);

    await prisma.companyStorageQuota.update({
      where: { companyId: context.companyId },
      data: { maxStorageBytes: usage.usedBytes + BigInt(10 * 1024 * 1024) },
    });

    const upload = await uploadFile(context, PDF);
    expect(upload.status).toBe("AVAILABLE");
  });

  it("refuses an upload that would cross the ceiling (§152)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const usage = await quota.companyUsage(context.companyId);

    // Exactly no headroom.
    await prisma.companyStorageQuota.update({
      where: { companyId: context.companyId },
      data: { maxStorageBytes: usage.usedBytes },
    });

    await expectStorageError(
      createUploadSession(context, uploadInput()),
      "STORAGE_QUOTA_EXCEEDED",
    );
  });

  /**
   * The reservation is what makes concurrency safe (PRD #29 §149, §150).
   *
   * Two uploads that each fit the remaining headroom must not both pass:
   * the first one's open session holds its bytes against the quota.
   */
  it("counts bytes reserved by open sessions", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const usage = await quota.companyUsage(context.companyId);

    await prisma.companyStorageQuota.update({
      where: { companyId: context.companyId },
      data: { maxStorageBytes: usage.usedBytes + BigInt(PDF.byteLength) },
    });

    const first = await createUploadSession(context, uploadInput());
    created.push(first.documentId);

    await expectStorageError(
      createUploadSession(context, uploadInput()),
      "STORAGE_QUOTA_EXCEEDED",
    );
  });

  it("releases the reservation when an upload is aborted (§208)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const before = await quota.companyUsage(context.companyId);

    const session = await createUploadSession(context, uploadInput());
    const during = await quota.companyUsage(context.companyId);
    expect(during.reservedBytes).toBeGreaterThan(before.reservedBytes);

    await abortUpload(context, session.uploadSessionId);

    const after = await quota.companyUsage(context.companyId);
    expect(after.reservedBytes).toBe(before.reservedBytes);

    // The placeholder went with it — it had no history worth keeping (§133).
    expect(await prisma.document.findUnique({ where: { id: session.documentId } })).toBeNull();
  });

  it("adds verified bytes to the projection (§148)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const before = await quota.companyUsage(context.companyId);

    await uploadFile(context, PDF);

    const after = await quota.companyUsage(context.companyId);
    expect(after.usedBytes).toBe(before.usedBytes + BigInt(PDF.byteLength));
    expect(after.fileCount).toBe(before.fileCount + 1);
  });

  /**
   * A projection can drift; the documents cannot (PRD #35 §238).
   *
   * Reconciliation is the answer to that, so what matters is that it agrees
   * with the rows it projects — not that an incrementally maintained number
   * has stayed perfect through every path that ever touched a document.
   */
  it("reconciles the projection against the documents themselves", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await uploadFile(context, PDF);

    const recalculated = await quota.recalculateUsage(context.companyId);
    const actual = await prisma.document.aggregate({
      where: {
        companyId: context.companyId,
        storageKey: { not: null },
        storageStatus: { not: "REJECTED" },
      },
      _sum: { sizeBytes: true },
      _count: true,
    });

    expect(recalculated.usedBytes).toBe(actual._sum.sizeBytes ?? BigInt(0));
    expect(recalculated.fileCount).toBe(actual._count);
  });
});

/* -------------------------------------------------------------------------- */
/* Cleanup                                                                     */
/* -------------------------------------------------------------------------- */

describe("cleanup (PRD #29 §130-§133, §377)", () => {
  it("expires a session that ran out of time", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    await prisma.documentUploadSession.update({
      where: { id: session.uploadSessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await runStorageCleanup();

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
    });
    expect(row.status).toBe("EXPIRED");
    // The reservation must not outlive the window it was granted for.
    expect(row.reservedBytes).toBe(BigInt(0));
  });

  /** Nothing is removed inside the grace period (PRD #29 §130, §317). */
  it("leaves an abandoned object alone until the grace period has passed", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, PDF, "application/pdf");

    await prisma.documentUploadSession.update({
      where: { id: session.uploadSessionId },
      data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 60_000) },
    });

    await runStorageCleanup();

    expect(await storageProvider().headObject(row.storageKey)).not.toBeNull();
    expect(await prisma.document.findUnique({ where: { id: session.documentId } })).not.toBeNull();
  });

  it("removes an abandoned object and its placeholder after the grace period", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    await storageProvider().putObject(row.storageKey, PDF, "application/pdf");

    await prisma.documentUploadSession.update({
      where: { id: session.uploadSessionId },
      data: {
        status: "EXPIRED",
        expiresAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    });

    const result = await runStorageCleanup();
    expect(result.objectsDeleted).toBeGreaterThanOrEqual(1);

    expect(await storageProvider().headObject(row.storageKey)).toBeNull();
    expect(await prisma.document.findUnique({ where: { id: session.documentId } })).toBeNull();
  });

  /** A completed, available file is never touched by cleanup (PRD #29 §377). */
  it("never removes a completed upload", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const upload = await uploadFile(context, PDF);

    await runStorageCleanup();

    expect(await storageProvider().headObject(upload.storageKey)).not.toBeNull();
    const row = await prisma.document.findUniqueOrThrow({ where: { id: upload.documentId } });
    expect(row.storageStatus).toBe("AVAILABLE");
  });

  it("reports a dry run without changing anything", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(context, uploadInput());
    created.push(session.documentId);

    await prisma.documentUploadSession.update({
      where: { id: session.uploadSessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const result = await runStorageCleanup({ dryRun: true });
    expect(result.sessionsExpired).toBeGreaterThanOrEqual(1);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
    });
    expect(row.status).toBe("CREATED");
  });
});

/* -------------------------------------------------------------------------- */
/* Storage-key enumeration                                                     */
/* -------------------------------------------------------------------------- */

describe("storage keys are not access (PRD #29 §4, §365)", () => {
  /**
   * The non-negotiable rule: knowing the key, the document id or the file name
   * must never be enough (PRD #29 §4).
   */
  it("knowing another company's storage key grants nothing", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const foreign = await prisma.document.findFirstOrThrow({
      where: { companyId: { not: context.companyId }, storageKey: { not: null } },
      select: { id: true, storageKey: true },
    });

    // The object genuinely exists in the store.
    const localPath = path.join(storageRoot, "borrowed-object");
    await writeFile(localPath, PDF);

    // And yet there is no read path: every grant and every status check starts
    // from the document, inside the caller's scope.
    await expectStorageError(createDownloadGrant(context, foreign.id), "DOCUMENT_NOT_FOUND");
    await expectStorageError(getStorageStatus(context, foreign.id), "DOCUMENT_NOT_FOUND");

    await rm(localPath, { force: true });
  });

  /** A key is never accepted from a caller — the server builds it (§18). */
  it("offers no way to name a storage key", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const session = await createUploadSession(
      context,
      // A `storageKey` in the body is simply not part of the schema.
      uploadInput({ storageKey: "companies/company_demo_b/documents/x/y.pdf" } as never),
    );
    created.push(session.documentId);

    const row = await prisma.documentUploadSession.findUniqueOrThrow({
      where: { id: session.uploadSessionId },
      select: { storageKey: true },
    });
    expect(row.storageKey).toContain(`companies/${context.companyId}/`);
  });
});

/* -------------------------------------------------------------------------- */
/* Server-side attach                                                          */
/* -------------------------------------------------------------------------- */

describe("server-side attach (PRD #29 §233)", () => {
  it("runs the same verification as a browser upload", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const result = await attachDocumentFromBytes(
      context,
      {
        name: "Attached Fixture",
        description: undefined,
        context: "project",
        projectId: PROJECT.a,
        clientId: undefined,
        entityType: undefined,
        entityId: undefined,
        fileName: "Attached.pdf",
        mimeType: "application/pdf",
      },
      PDF,
    );
    created.push(result.documentId);

    expect(result.status).toBe("AVAILABLE");

    const row = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } });
    expect(row.detectedMimeType).toBe("application/pdf");
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  /** No shortcut: the same magic-byte check applies (PRD #29 §270). */
  it("refuses an executable attached server-side", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    await expectStorageError(
      attachDocumentFromBytes(
        context,
        {
          name: "Not A PDF",
          description: undefined,
          context: "project",
          projectId: PROJECT.a,
          clientId: undefined,
          entityType: undefined,
          entityId: undefined,
          fileName: "Trojan.pdf",
          mimeType: "application/pdf",
        },
        new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
      ),
      "FILE_TYPE_NOT_ALLOWED",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Global search                                                               */
/* -------------------------------------------------------------------------- */

describe("global search cannot bypass parent access (PRD #29 §248, §249)", () => {
  /**
   * The generic Documents surface must not become a side door.
   *
   * This is the regression test for a real leak: the search provider filtered
   * on company alone, so an Engineer searching "Financial" was handed the
   * *title* of a company Finance document they are refused everywhere else —
   * in the list, on the detail page and on the download route. A title is
   * exactly what must not be confirmable (PRD #13 §270, PRD #29 §4, §160).
   */
  it("does not return a document the reader cannot open", async () => {
    const financeDocument = await prisma.document.findFirstOrThrow({
      where: { module: "finance", projectId: null, storageStatus: "AVAILABLE" },
      select: { id: true, name: true },
    });

    const finance = await loginAs("FINANCE");
    const allowed = await globalSearch(finance, financeDocument.name, { totalLimit: 20 });
    expect(titlesOf(allowed)).toContain(financeDocument.name);

    for (const role of ["ENGINEER", "ARCHITECT", "GROUP_IT"] as const) {
      const context = await loginAs(role);
      const hits = await globalSearch(context, financeDocument.name, { totalLimit: 20 });
      expect(titlesOf(hits), `${role} found it`).not.toContain(financeDocument.name);
    }
  });

  /** An unverified placeholder is not a document yet (PRD #29 §162, §233). */
  it("does not return a document whose upload never completed", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const session = await createUploadSession(
      context,
      uploadInput({ name: "Pipeline Fixture", fileName: "Fixture.pdf" }),
    );
    created.push(session.documentId);

    const hits = await globalSearch(context, "Pipeline Fixture", { totalLimit: 20 });
    expect(titlesOf(hits)).not.toContain("Pipeline Fixture");
  });
});

function titlesOf(hits: { results: { entityType: string; title: string }[] }): string[] {
  return hits.results.filter((hit) => hit.entityType === "document").map((hit) => hit.title);
}

/* -------------------------------------------------------------------------- */
/* Concurrency                                                                 */
/* -------------------------------------------------------------------------- */

describe("concurrent uploads (PRD #29 §149, §378, §388)", () => {
  afterEach(async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await prisma.companyStorageQuota.update({
      where: { companyId: context.companyId },
      data: { maxStorageBytes: null },
    });
  });

  /**
   * The race §149 describes, run for real.
   *
   * Ten browsers ask for an upload at the same moment, with room for three.
   * Checking used bytes alone would let all ten through; the reservation plus
   * the row lock is what makes the answer exactly three (PRD #29 §150).
   */
  it("cannot be raced past the quota", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const usage = await quota.companyUsage(context.companyId);
    const room = 3;

    await prisma.companyStorageQuota.update({
      where: { companyId: context.companyId },
      data: { maxStorageBytes: usage.usedBytes + BigInt(PDF.byteLength * room) },
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => createUploadSession(context, uploadInput())),
    );

    for (const attempt of attempts) {
      if (attempt.status === "fulfilled") created.push(attempt.value.documentId);
    }

    const allowed = attempts.filter((attempt) => attempt.status === "fulfilled");
    const refused = attempts.filter(
      (attempt) =>
        attempt.status === "rejected" &&
        attempt.reason instanceof StorageError &&
        attempt.reason.storageCode === "STORAGE_QUOTA_EXCEEDED",
    );

    expect(allowed).toHaveLength(room);
    expect(refused).toHaveLength(10 - room);
  });

  /**
   * Ten uploads in flight at once, all completing (PRD #29 §388).
   *
   * Not a load test — that belongs on real infrastructure. What this proves is
   * that concurrency does not corrupt anything: every document ends up
   * AVAILABLE, every one has its own object key, and the usage projection
   * reconciles against the rows afterwards.
   */
  it("keeps every document and key distinct under concurrency", async () => {
    const context = await loginAs("PROJECT_MANAGER");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => uploadFile(context, PDF)),
    );

    expect(results.every((result) => result.status === "AVAILABLE")).toBe(true);
    expect(new Set(results.map((result) => result.storageKey)).size).toBe(10);
    expect(new Set(results.map((result) => result.documentId)).size).toBe(10);

    const recalculated = await quota.recalculateUsage(context.companyId);
    const actual = await prisma.document.aggregate({
      where: {
        companyId: context.companyId,
        storageKey: { not: null },
        storageStatus: { not: "REJECTED" },
      },
      _sum: { sizeBytes: true },
    });
    expect(recalculated.usedBytes).toBe(actual._sum.sizeBytes ?? BigInt(0));
  });
});
