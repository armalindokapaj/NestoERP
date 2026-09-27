import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as authoriseRoute } from "@/app/api/documents/uploads/route";
import { acceptedTypesText, precheckFile, uploadAccept } from "@/components/documents/upload-client";
import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { DEFAULT_MAX_FILE_BYTES, FILE_TYPES, setFileScanner, StorageError } from "@/lib/core/storage";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { listDocuments } from "@/lib/modules/documents/document.service";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { createDownloadGrant } from "@/lib/modules/documents/storage/download.service";
import * as quota from "@/lib/modules/documents/storage/quota.service";
import { getStorageStatus } from "@/lib/modules/documents/storage/status.service";
import { createDocumentUploadSchema } from "@/lib/modules/documents/storage/storage.schema";
import { abortUpload, completeUpload, createUploadSession, createVersionUploadSession } from "@/lib/modules/documents/storage/upload.service";
import { addUnitMedia, attachUnitDocument } from "@/lib/modules/project-structure/unit-files.service";
import { cleanupSessions, loginAs, PROJECT, prisma } from "../../helpers";
import { actAs } from "../../security/harness/actor";

vi.mock("@/lib/context/resolve-user-context", () => import("../../security/harness/actor"));

/**
 * Upload controls (AUD-09 §8; FV-18, FV-19), against the real pipeline.
 *
 * Storage is the real local provider in a temporary directory, the database is
 * the real one, the actors are demo identities. The browser half is exercised
 * where it is pure (`precheckFile`, `uploadAccept`, from
 * `components/documents/upload-client.ts`); the transfer itself is driven here
 * the way the browser drives it — authorise, put the bytes at the granted key,
 * complete — and E2E covers the rest (tests/e2e/forms/aud09-uploads.spec.ts).
 *
 * What is proved:
 *
 *   limits      the accept list and the pre-selection refusal are the server's
 *               registry and ceiling, word for word — not a second copy
 *   sniffing    forged extensions and forged MIME types are refused by the
 *               bytes; a missing browser MIME is not a reason to refuse
 *   retry       one upload key is one document (one version, one link): a
 *               retry after a lost answer finds the first attempt; a dead
 *               session releases its key instead of a 500; two retries racing
 *               make one session
 *   cancel      an abort removes the placeholder, the object and the
 *               reservation; discarding never deletes a canonical, shared file
 *   pending     a file still being checked reads as pending everywhere a
 *               record can show it, and cannot be linked or downloaded
 *
 * Fixtures are named `aud09d_…` and swept in afterAll, links and all.
 */

const PREFIX = "aud09d_";
const UNIT_A = "unit_riverside_a_101";
const PDF = new TextEncoder().encode("%PDF-1.4\naud09 upload fixture\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x01, 0x02]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
const HTML = new TextEncoder().encode("<!DOCTYPE html><html><body>not text</body></html>");

let storageRoot: string;
let pm: UserContext;
let unitB: string;
let unitSnapshot: Array<{ id: string; version: number; hasUnpublishedChanges: boolean; updatedAt: Date }>;
let quotaBefore: { maxStorageBytes: bigint | null } | null;
const started = new Date();
const locker = new PrismaClient();

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-aud09d-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
  setFileScanner(null);
  pm = await loginAs("PROJECT_MANAGER");
  unitB = (await prisma.projectUnit.findFirstOrThrow({ where: { projectId: PROJECT.a, unitCode: "A-102" }, select: { id: true } })).id;
  unitSnapshot = await prisma.projectUnit.findMany({ where: { id: { in: [UNIT_A, unitB] } }, select: { id: true, version: true, hasUnpublishedChanges: true, updatedAt: true } });
  quotaBefore = await prisma.companyStorageQuota.findUnique({ where: { companyId: pm.companyId }, select: { maxStorageBytes: true } });
});

afterEach(() => {
  setFileScanner(null);
  actAs(null);
});

afterAll(async () => {
  const documents = await prisma.document.findMany({ where: { companyId: pm.companyId, name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = documents.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.unitMedia.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.unitDocumentLink.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.activity.deleteMany({ where: { OR: [{ entityId: { in: ids } }, ...ids.map((id) => ({ metadata: { path: ["documentId"], equals: id } }))] } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.document.updateMany({ where: { id: { in: ids } }, data: { currentVersionId: null } });
    await prisma.documentVersion.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
  }
  // What adding media and links wrote about the units, then the units as they were.
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: [UNIT_A, unitB] }, createdAt: { gte: started } } });
  await prisma.activity.deleteMany({ where: { entityId: { in: [UNIT_A, unitB] }, createdAt: { gte: started } } });
  for (const unit of unitSnapshot ?? []) {
    await prisma.projectUnit.update({ where: { id: unit.id }, data: { version: unit.version, hasUnpublishedChanges: unit.hasUnpublishedChanges, updatedAt: unit.updatedAt } });
  }
  if (quotaBefore) await prisma.companyStorageQuota.update({ where: { companyId: pm.companyId }, data: { maxStorageBytes: quotaBefore.maxStorageBytes } });
  setStorageProvider(null);
  setFileScanner(undefined);
  await rm(storageRoot, { recursive: true, force: true });
  await reconcileStorageUsage();
  await cleanupSessions();
  await locker.$disconnect();
  await prisma.$disconnect();
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

let serial = 0;
const fixtureName = (label: string) => `${PREFIX}${label}_${(serial += 1)}`;

function input(overrides: Record<string, unknown> = {}) {
  return createDocumentUploadSchema.parse({
    name: fixtureName("file"),
    context: "project",
    projectId: PROJECT.a,
    fileName: "Fixture.pdf",
    mimeType: "application/pdf",
    sizeBytes: PDF.byteLength,
    ...overrides,
  });
}

async function keyOf(sessionId: string): Promise<string> {
  return (await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: sessionId }, select: { storageKey: true } })).storageKey;
}

/** Browser step 2: the bytes at the granted key. */
async function put(sessionId: string, bytes: Uint8Array, contentType = "application/octet-stream") {
  const storageKey = await keyOf(sessionId);
  await storageProvider().putObject(storageKey, bytes, contentType);
  return storageKey;
}

function codeOf(error: unknown): string | undefined {
  if (error instanceof StorageError) return error.storageCode;
  if (error instanceof AccessError) return (error.details as { code?: string } | undefined)?.code ?? error.code;
  return undefined;
}

async function refusal(promise: Promise<unknown>): Promise<AccessError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error, "expected a refusal").toBeInstanceOf(AccessError);
  return error as AccessError;
}

/** What a chosen file looks like to `precheckFile`: its name, declared type and size. */
function chosen(name: string, type: string, size: number): File {
  return { name, type, size } as File;
}

const documentsNamed = (name: string) => prisma.document.count({ where: { companyId: pm.companyId, name } });

/* -------------------------------------------------------------------------- */
/* Limits shown before selection are the limits enforced                       */
/* -------------------------------------------------------------------------- */

describe("limits before selection are the server's (AUD-09 §8, FV-18)", () => {
  it("the accept list is the registry: every allowed extension, none of the refused ones", () => {
    const accept = uploadAccept().split(",");
    for (const type of FILE_TYPES) for (const extension of type.extensions) expect(accept).toContain(`.${extension}`);
    for (const refused of [".exe", ".svg", ".html", ".zip", ".xlsm", ".js"]) expect(accept).not.toContain(refused);
    // Narrowed to images: only the image group's extensions.
    expect(uploadAccept(["image"]).split(",").sort()).toEqual([".jpeg", ".jpg", ".png", ".webp"]);
    expect(acceptedTypesText(["image"])).toBe("Image (JPG, JPEG, PNG, WEBP)");
  });

  /**
   * The browser's refusal is the server's refusal, sooner: same code, same
   * sentence, and no document row is written for any of them.
   */
  it("refuses before a byte moves with exactly the server's code and sentence", async () => {
    const cases: Array<[string, string, number, string]> = [
      ["too-big.pdf", "application/pdf", DEFAULT_MAX_FILE_BYTES + 1, "FILE_TOO_LARGE"],
      ["setup.exe", "", 10, "FILE_TYPE_NOT_ALLOWED"],
      ["bundle.zip", "application/zip", 10, "FILE_TYPE_NOT_ALLOWED"],
      ["macro.xlsm", "", 10, "FILE_TYPE_NOT_ALLOWED"],
      ["plan.pdf", "image/png", 10, "FILE_TYPE_MISMATCH"],
      ["README", "", 10, "INVALID_FILE_NAME"],
      ["cv\u202Egpj.pdf", "application/pdf", 10, "INVALID_FILE_NAME"],
    ];
    for (const [fileName, mimeType, sizeBytes, code] of cases) {
      const client = precheckFile(chosen(fileName, mimeType, sizeBytes));
      expect(client, fileName).toMatchObject({ ok: false, code });

      const name = fixtureName("refused");
      const server = await refusal(createUploadSession(pm, input({ name, fileName, mimeType: mimeType || undefined, sizeBytes })));
      expect(codeOf(server), fileName).toBe(code);
      expect(server.message, fileName).toBe((client as { message: string }).message);
      expect(await documentsNamed(name), fileName).toBe(0);
    }

    // Positive control: a real PDF passes both, and the server opens a session.
    expect(precheckFile(chosen("Fixture.pdf", "application/pdf", PDF.byteLength))).toEqual({ ok: true });
    const opened = await createUploadSession(pm, input());
    expect(opened.uploadSessionId).toBeTruthy();
    await abortUpload(pm, opened.uploadSessionId);
  });

  it("a narrowed control refuses a type the server would take elsewhere, and says what it takes", () => {
    expect(precheckFile(chosen("plan.pdf", "application/pdf", 10), { groups: ["image"] })).toEqual({
      ok: false,
      code: "FILE_TYPE_NOT_ALLOWED",
      message: "Choose Image (JPG, JPEG, PNG, WEBP).",
    });
    expect(precheckFile(chosen("photo.png", "image/png", 10), { groups: ["image"] })).toEqual({ ok: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Content is sniffed, not trusted                                             */
/* -------------------------------------------------------------------------- */

describe("content is read from the bytes (AUD-09 §8, FV-18)", () => {
  async function uploadBytes(bytes: Uint8Array, overrides: Record<string, unknown>) {
    const session = await createUploadSession(pm, input({ sizeBytes: bytes.byteLength, ...overrides }));
    const storageKey = await put(session.uploadSessionId, bytes);
    return { session, storageKey, outcome: await completeUpload(pm, session.uploadSessionId).then((value) => value, (error: unknown) => error) };
  }

  it("forged extension: an executable named .pdf and declared application/pdf is rejected and deleted", async () => {
    const { session, storageKey, outcome } = await uploadBytes(EXE, { fileName: "invoice.pdf", mimeType: "application/pdf" });
    expect(codeOf(outcome)).toBe("FILE_TYPE_NOT_ALLOWED");
    const row = await prisma.document.findUniqueOrThrow({ where: { id: session.documentId }, select: { storageStatus: true, rejectionReason: true } });
    expect(row).toEqual({ storageStatus: "REJECTED", rejectionReason: "FILE_TYPE_NOT_ALLOWED" });
    expect(await storageProvider().headObject(storageKey)).toBeNull();
    const status = await getStorageStatus(pm, session.documentId);
    expect(status.ready).toBe(false);
  });

  it("forged extension: PNG bytes named .pdf are a mismatch", async () => {
    const { outcome } = await uploadBytes(PNG, { fileName: "drawing.pdf", mimeType: "application/pdf" });
    expect(codeOf(outcome)).toBe("FILE_TYPE_MISMATCH");
  });

  it("an unsigned type is still read: HTML named .txt is refused as active content", async () => {
    const { outcome } = await uploadBytes(HTML, { fileName: "notes.txt", mimeType: "text/plain" });
    expect(codeOf(outcome)).toBe("FILE_TYPE_NOT_ALLOWED");
  });

  it("forged MIME: a PDF declared image/png is refused before any session", async () => {
    const name = fixtureName("forged_mime");
    const error = await refusal(createUploadSession(pm, input({ name, fileName: "plan.pdf", mimeType: "image/png" })));
    expect(codeOf(error)).toBe("FILE_TYPE_MISMATCH");
    expect(await documentsNamed(name)).toBe(0);
  });

  it("positive controls: real bytes pass, and a missing browser MIME is not a refusal", async () => {
    const png = await uploadBytes(PNG, { fileName: "photo.png", mimeType: "image/png" });
    expect(png.outcome).toMatchObject({ status: "AVAILABLE" });
    const pdf = await uploadBytes(PDF, { fileName: "Plan.pdf", mimeType: undefined });
    expect(pdf.outcome).toMatchObject({ status: "AVAILABLE" });
    const rows = await prisma.document.findMany({ where: { id: { in: [png.session.documentId, pdf.session.documentId] } }, select: { id: true, detectedMimeType: true } });
    expect(Object.fromEntries(rows.map((row) => [row.id, row.detectedMimeType]))).toEqual({
      [png.session.documentId]: "image/png",
      [pdf.session.documentId]: "application/pdf",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Retry is idempotent by upload key                                           */
/* -------------------------------------------------------------------------- */

describe("one upload key is one upload (AUD-09 §8, FV-18)", () => {
  it("a retry after a lost completion finds the document instead of making a second — service and route", async () => {
    const key = `${PREFIX}lost_${Date.now()}`;
    const name = fixtureName("lost_answer");
    const usageBefore = await quota.companyUsage(pm.companyId);

    const first = await createUploadSession(pm, input({ name }), { idempotencyKey: key });
    await put(first.uploadSessionId, PDF);
    // The completion commits; the browser never hears back.
    expect(await completeUpload(pm, first.uploadSessionId)).toEqual({ documentId: first.documentId, status: "AVAILABLE" });

    // The retry authorises again under the same key.
    const replay = await refusal(createUploadSession(pm, input({ name }), { idempotencyKey: key }));
    expect(replay.code).toBe("CONFLICT");
    expect(replay.details).toEqual({ code: "UPLOAD_ALREADY_COMPLETED", documentId: first.documentId, uploadSessionId: first.uploadSessionId });

    // The same through the route, as the browser sees it: 409 with the document, not a 500.
    actAs(pm);
    const response = await authoriseRoute(
      new Request("http://localhost/api/documents/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ name, context: "project", projectId: PROJECT.a, fileName: "Fixture.pdf", mimeType: "application/pdf", sizeBytes: PDF.byteLength }),
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; details: { code: string; documentId: string } } };
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details).toMatchObject({ code: "UPLOAD_ALREADY_COMPLETED", documentId: first.documentId });

    // A repeated completion answers, and counts nothing twice.
    expect(await completeUpload(pm, first.uploadSessionId)).toEqual({ documentId: first.documentId, status: "AVAILABLE" });

    expect(await documentsNamed(name)).toBe(1);
    expect(await prisma.documentUploadSession.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await prisma.documentVersion.count({ where: { documentId: first.documentId } })).toBe(1);
    expect(await prisma.activity.count({ where: { entityId: first.documentId, action: "DOCUMENT_UPLOADED" } })).toBe(1);
    const usageAfter = await quota.companyUsage(pm.companyId);
    expect(usageAfter.usedBytes - usageBefore.usedBytes).toBe(BigInt(PDF.byteLength));
    expect(usageAfter.fileCount - usageBefore.fileCount).toBe(1);
  });

  it("an open session is resumed under its key; the same key on another file or place is refused", async () => {
    const key = `${PREFIX}open_${Date.now()}`;
    const name = fixtureName("open_session");
    const first = await createUploadSession(pm, input({ name }), { idempotencyKey: key });
    const again = await createUploadSession(pm, input({ name }), { idempotencyKey: key });
    expect(again.uploadSessionId).toBe(first.uploadSessionId);
    expect(again.documentId).toBe(first.documentId);
    // A fresh grant for the same key, not the spent one.
    expect(again.upload.url).toBeTruthy();

    for (const other of [{ sizeBytes: PDF.byteLength + 1 }, { fileName: "Other.pdf" }, { context: "record", entityType: "project_unit", entityId: UNIT_A, projectId: undefined }]) {
      const error = await refusal(createUploadSession(pm, input({ name, ...other }), { idempotencyKey: key }));
      expect(codeOf(error), JSON.stringify(other)).toBe("UPLOAD_KEY_REUSED");
    }
    expect(await documentsNamed(name)).toBe(1);

    // Positive control: a new key for a new file is a new document.
    const second = await createUploadSession(pm, input({ name }), { idempotencyKey: `${key}_other` });
    expect(second.documentId).not.toBe(first.documentId);
    expect(await documentsNamed(name)).toBe(2);
    await abortUpload(pm, first.uploadSessionId);
    await abortUpload(pm, second.uploadSessionId);
  });

  it("a dead session releases its key: an expired or failed attempt is retried, not a 500", async () => {
    // Expired while the browser was away.
    const expiredKey = `${PREFIX}expired_${Date.now()}`;
    const expired = await createUploadSession(pm, input(), { idempotencyKey: expiredKey });
    await prisma.documentUploadSession.update({ where: { id: expired.uploadSessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const renewed = await createUploadSession(pm, input(), { idempotencyKey: expiredKey });
    expect(renewed.uploadSessionId).not.toBe(expired.uploadSessionId);
    expect(await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: expired.uploadSessionId }, select: { status: true, idempotencyKey: true, reservedBytes: true } })).toEqual({
      status: "EXPIRED",
      idempotencyKey: null,
      reservedBytes: BigInt(0),
    });
    expect(await prisma.documentUploadSession.count({ where: { idempotencyKey: expiredKey } })).toBe(1);
    await abortUpload(pm, renewed.uploadSessionId);

    // Rejected content, then the same key again.
    const failedKey = `${PREFIX}failed_${Date.now()}`;
    const failed = await createUploadSession(pm, input({ sizeBytes: EXE.byteLength }), { idempotencyKey: failedKey });
    await put(failed.uploadSessionId, EXE);
    expect(codeOf(await completeUpload(pm, failed.uploadSessionId).catch((error: unknown) => error))).toBe("FILE_TYPE_NOT_ALLOWED");
    const retried = await createUploadSession(pm, input({ sizeBytes: EXE.byteLength }), { idempotencyKey: failedKey });
    expect(retried.uploadSessionId).not.toBe(failed.uploadSessionId);
    expect((await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: failed.uploadSessionId } })).idempotencyKey).toBeNull();
    await abortUpload(pm, retried.uploadSessionId);
  });

  /**
   * Two authorisations under one key at the same moment (a double click, a
   * retry overtaking a slow answer). A barrier, not timing: the company's
   * usage row — which every authorisation locks once a storage ceiling is set
   * — is held on a second connection until Postgres shows both waiting on it,
   * after the key lookup found nothing for either. One opens the session; the
   * other hits the unique key, rolls back whole, and is answered as a replay.
   */
  it("two authorisations racing under one key make one session and one document", async () => {
    await prisma.companyStorageQuota.update({ where: { companyId: pm.companyId }, data: { maxStorageBytes: BigInt(10) ** BigInt(15) } });
    const key = `${PREFIX}race_${Date.now()}`;
    const name = fixtureName("race");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding!: (pid: number) => void;
    const holderPid = new Promise<number>((resolve) => (holding = resolve));
    const holder = locker.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS "pid"`;
        await tx.$executeRaw`INSERT INTO "company_storage_usage" ("companyId", "usedBytes", "fileCount", "updatedAt") VALUES (${pm.companyId}, 0, 0, now()) ON CONFLICT ("companyId") DO NOTHING`;
        await tx.$queryRaw`SELECT "usedBytes" FROM "company_storage_usage" WHERE "companyId" = ${pm.companyId} FOR UPDATE`;
        holding(pid);
        await gate;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    const pid = await holderPid;
    const running = [0, 1].map(() => createUploadSession(pm, input({ name }), { idempotencyKey: key }).then((value) => value, (error: unknown) => error));
    await waitForBlocked(pid, 2);
    release();
    await holder;
    const [a, b] = await Promise.all(running);

    expect(a).toMatchObject({ uploadSessionId: expect.any(String) });
    expect(b).toMatchObject({ uploadSessionId: (a as { uploadSessionId: string }).uploadSessionId, documentId: (a as { documentId: string }).documentId });
    expect(await documentsNamed(name)).toBe(1);
    expect(await prisma.documentUploadSession.count({ where: { idempotencyKey: key } })).toBe(1);
    await abortUpload(pm, (a as { uploadSessionId: string }).uploadSessionId);
  });

  it("a new version retried under its key is one version, not the next number", async () => {
    const base = await createUploadSession(pm, input({ name: fixtureName("versioned") }));
    await put(base.uploadSessionId, PDF);
    await completeUpload(pm, base.uploadSessionId);
    const before = await prisma.document.findUniqueOrThrow({ where: { id: base.documentId }, select: { latestVersionNumber: true } });

    const key = `${PREFIX}version_${Date.now()}`;
    const version = { fileName: "Fixture v2.pdf", mimeType: "application/pdf", sizeBytes: PDF.byteLength };
    const first = await createVersionUploadSession(pm, base.documentId, version, { idempotencyKey: key });
    const again = await createVersionUploadSession(pm, base.documentId, version, { idempotencyKey: key });
    expect(again.uploadSessionId).toBe(first.uploadSessionId);
    expect(again.versionNumber).toBe(first.versionNumber);
    await put(first.uploadSessionId, PDF);
    expect(await completeUpload(pm, first.uploadSessionId)).toMatchObject({ status: "AVAILABLE" });

    const replay = await refusal(createVersionUploadSession(pm, base.documentId, version, { idempotencyKey: key }));
    expect(replay.details).toMatchObject({ code: "UPLOAD_ALREADY_COMPLETED", documentId: base.documentId });
    const after = await prisma.document.findUniqueOrThrow({ where: { id: base.documentId }, select: { latestVersionNumber: true, currentVersionId: true } });
    expect(after.latestVersionNumber).toBe(before.latestVersionNumber + 1);
    expect(await prisma.documentVersion.count({ where: { documentId: base.documentId } })).toBe(2);
    expect(after.currentVersionId).toBe(first.documentVersionId);
  });

  it("retrying the link after the file arrived does not link it twice", async () => {
    const image = await createUploadSession(pm, input({ name: fixtureName("unit_image"), fileName: "unit.png", mimeType: "image/png", sizeBytes: PNG.byteLength }));
    await put(image.uploadSessionId, PNG);
    await completeUpload(pm, image.uploadSessionId);

    await addUnitMedia(pm, UNIT_A, { documentId: image.documentId, category: "OTHER", caption: null });
    // The retry the queue makes when the first answer was lost: refused as
    // already there — the queue reads that as linked — and nothing is added.
    const retry = await refusal(addUnitMedia(pm, UNIT_A, { documentId: image.documentId, category: "OTHER", caption: null }));
    expect(codeOf(retry)).toBe("UNIT_MEDIA_ALREADY_ADDED");
    expect(await prisma.unitMedia.count({ where: { unitId: UNIT_A, documentId: image.documentId } })).toBe(1);

    // The link rechecks scope at link time: another company's file id, forged
    // into the same request, is refused and links nothing.
    const foreign = await prisma.document.findFirstOrThrow({ where: { companyId: { not: pm.companyId }, storageStatus: "AVAILABLE" }, select: { id: true } });
    const forged = await refusal(addUnitMedia(pm, UNIT_A, { documentId: foreign.id, category: "OTHER", caption: null }));
    expect(forged.code).toBe("VALIDATION_ERROR");
    expect(await prisma.unitMedia.count({ where: { documentId: foreign.id } })).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Cancel and discard                                                          */
/* -------------------------------------------------------------------------- */

describe("cancel follows cleanup; discard never deletes a canonical file (AUD-09 §8, FV-18)", () => {
  it("cancelling removes the placeholder, the object and the reservation — and the key can start again", async () => {
    const key = `${PREFIX}cancel_${Date.now()}`;
    const name = fixtureName("cancelled");
    const session = await createUploadSession(pm, input({ name }), { idempotencyKey: key });
    const reservedDuring = (await quota.companyUsage(pm.companyId)).reservedBytes;
    const storageKey = await put(session.uploadSessionId, PDF);

    await abortUpload(pm, session.uploadSessionId);
    // The placeholder took its session with it: a second cancel finds nothing
    // to cancel (the queue ignores that answer), and changes nothing.
    expect(codeOf(await abortUpload(pm, session.uploadSessionId).catch((error: unknown) => error))).toBe("UPLOAD_SESSION_NOT_FOUND");

    expect(await prisma.document.findUnique({ where: { id: session.documentId } })).toBeNull();
    expect(await prisma.documentUploadSession.findUnique({ where: { id: session.uploadSessionId } })).toBeNull();
    expect(await storageProvider().headObject(storageKey)).toBeNull();
    expect((await quota.companyUsage(pm.companyId)).reservedBytes).toBe(reservedDuring - BigInt(PDF.byteLength));

    // Choosing the same file again under the same key starts cleanly.
    const again = await createUploadSession(pm, input({ name }), { idempotencyKey: key });
    expect(again.uploadSessionId).not.toBe(session.uploadSessionId);
    await abortUpload(pm, again.uploadSessionId);
    expect(await documentsNamed(name)).toBe(0);
  });

  it("discarding a new-version upload on a shared document leaves the document, its file and both links", async () => {
    const shared = await createUploadSession(pm, input({ name: fixtureName("shared_plan"), fileName: "Shared plan.pdf" }));
    const v1Key = await put(shared.uploadSessionId, PDF);
    await completeUpload(pm, shared.uploadSessionId);
    await attachUnitDocument(pm, UNIT_A, { documentId: shared.documentId, category: "TECHNICAL_DRAWING" });
    await attachUnitDocument(pm, unitB, { documentId: shared.documentId, category: "TECHNICAL_DRAWING" });
    const before = await prisma.document.findUniqueOrThrow({ where: { id: shared.documentId }, select: { currentVersionId: true, storageStatus: true } });

    const key = `${PREFIX}discard_${Date.now()}`;
    const version = { fileName: "Shared plan v2.pdf", mimeType: "application/pdf", sizeBytes: PDF.byteLength };
    const intent = await createVersionUploadSession(pm, shared.documentId, version, { idempotencyKey: key });
    const v2Key = await put(intent.uploadSessionId, PDF);
    await abortUpload(pm, intent.uploadSessionId);

    expect(await prisma.documentVersion.findUnique({ where: { id: intent.documentVersionId } })).toBeNull();
    expect(await storageProvider().headObject(v2Key)).toBeNull();
    expect(await prisma.document.findUniqueOrThrow({ where: { id: shared.documentId }, select: { currentVersionId: true, storageStatus: true } })).toEqual(before);
    expect(await storageProvider().headObject(v1Key)).not.toBeNull();
    expect(await prisma.unitDocumentLink.count({ where: { documentId: shared.documentId } })).toBe(2);
    await expect(createDownloadGrant(pm, shared.documentId)).resolves.toMatchObject({ url: expect.any(String) });

    // The same key again after the discard opens a fresh version session (a 500 before AUD-09).
    const reopened = await createVersionUploadSession(pm, shared.documentId, version, { idempotencyKey: key });
    expect(reopened.uploadSessionId).not.toBe(intent.uploadSessionId);
    await abortUpload(pm, reopened.uploadSessionId);

    // Cancelling the upload that made the canonical file is refused: it is done.
    const error = await refusal(abortUpload(pm, shared.uploadSessionId));
    expect(codeOf(error)).toBe("UPLOAD_ALREADY_COMPLETED");
    expect(await prisma.document.findUniqueOrThrow({ where: { id: shared.documentId }, select: { currentVersionId: true, storageStatus: true } })).toEqual(before);
    expect(await storageProvider().headObject(v1Key)).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Pending is never ready                                                      */
/* -------------------------------------------------------------------------- */

describe("a file still being checked reads as pending everywhere (AUD-09 §8, FV-19)", () => {
  it("status, list row, download and every link refuse to treat it as ready; a clean file is ready", async () => {
    // The scanner is unreachable: the file arrives and is held, not released.
    setFileScanner({ provider: "unreachable", scan: async () => { throw new Error("scanner unreachable"); } });
    const name = fixtureName("pending");
    const session = await createUploadSession(pm, input({ name }));
    await put(session.uploadSessionId, PDF);
    const completed = await completeUpload(pm, session.uploadSessionId);
    expect(completed.status).toBe("SCANNING");

    const status = await getStorageStatus(pm, session.documentId);
    expect(status).toMatchObject({ status: "SCANNING", ready: false, message: "Processing…" });

    const listed = await listDocuments(pm, documentListQuerySchema.parse({ projectId: PROJECT.a, search: name, limit: 10 }));
    const row = listed.data.find((document) => document.id === session.documentId);
    expect(row).toMatchObject({ storageStatus: "SCANNING", storageMessage: "Processing…" });

    expect(codeOf(await createDownloadGrant(pm, session.documentId).catch((error: unknown) => error))).toBe("FILE_SCAN_PENDING");
    const media = await refusal(addUnitMedia(pm, UNIT_A, { documentId: session.documentId, category: "OTHER", caption: null }));
    expect(media.code).toBe("VALIDATION_ERROR");
    expect(media.details).toMatchObject({ documentId: ["That file is still being checked."] });
    const link = await refusal(attachUnitDocument(pm, UNIT_A, { documentId: session.documentId, category: "TECHNICAL_DRAWING" }));
    expect(link.code).toBe("VALIDATION_ERROR");
    expect(await prisma.unitDocumentLink.count({ where: { documentId: session.documentId } })).toBe(0);

    // Positive control: without a pending scan the same flow is ready and linkable.
    setFileScanner(null);
    const clean = await createUploadSession(pm, input({ name: fixtureName("clean") }));
    await put(clean.uploadSessionId, PDF);
    expect(await completeUpload(pm, clean.uploadSessionId)).toMatchObject({ status: "AVAILABLE" });
    expect(await getStorageStatus(pm, clean.documentId)).toMatchObject({ ready: true, message: null });
    await expect(attachUnitDocument(pm, UNIT_A, { documentId: clean.documentId, category: "TECHNICAL_DRAWING" })).resolves.toMatchObject({ id: expect.any(String) });
  });
});

/**
 * Polls the database's own lock graph (as tests/api/tasks/task-reliability):
 * synchronisation on an observed state, not a sleep.
 */
async function waitForBlocked(holderPid: number, count: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const [{ blocked }] = await locker.$queryRaw<Array<{ blocked: number }>>`
      WITH RECURSIVE "chain"("pid") AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "chain" c ON c."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "blocked" FROM "chain"`;
    if (blocked >= count) return;
    if (Date.now() > deadline) throw new Error(`only ${blocked} of ${count} authorisations reached the usage lock`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}
