import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PUT as putStorageObject } from "@/app/api/storage/objects/[...key]/route";
import { AccessError } from "@/lib/access/guards";
import { setFileScanner, StorageError, type FileScanner } from "@/lib/core/storage";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { canAttachToDocumentParent } from "@/lib/modules/documents/document.parent-access";
import { documentListQuerySchema } from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { createDownloadGrant } from "@/lib/modules/documents/storage/download.service";
import { createDocumentUploadSchema } from "@/lib/modules/documents/storage/storage.schema";
import {
  attachDocumentFromBytes,
  completeUpload,
  createUploadSession,
  createVersionUploadSession,
} from "@/lib/modules/documents/storage/upload.service";
import { createVersionDownloadGrant } from "@/lib/modules/documents/versions/version.service";
import { cleanupSessions, COMPANY, DEMO_EMAIL, loginAs, loginAsEmail, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * Documents authorisation hardening (PRD #47 §81-§86).
 *
 * Regression tests for the audit findings: a module's document grant on
 * module-filed documents, single-use upload grants, frozen and archived files
 * re-checked at the moment a new version would replace them, and the smaller
 * state and company checks around versions. Real storage in a temporary
 * directory, real seeded people, no mocked authorisation (PRD #9 §223).
 */

let storageRoot: string;
const created: string[] = [];
const revisions: string[] = [];
const NAME = "Authorization Hardening Fixture";
const ENGINEERING_DOCUMENT = "engdoc_arc_sd_023";

const pdf = (label: string) => new TextEncoder().encode(`%PDF-1.4\n${label}\n%%EOF\n`);

type Context = Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-docs-authz-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  // The object route builds its own local provider from the environment.
  process.env.DOCUMENT_STORAGE_ROOT = storageRoot;
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
});

beforeEach(() => setFileScanner(null));

afterEach(async () => {
  setFileScanner(undefined);
  if (revisions.length > 0) {
    await prisma.engineeringDocumentRevision.deleteMany({ where: { id: { in: revisions } } });
    revisions.length = 0;
  }
  const rows = await prisma.document.findMany({ where: { OR: [{ id: { in: created } }, { name: NAME }] }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.activity.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
    await prisma.document.deleteMany({ where: { id: { in: ids } } });
  }
  created.length = 0;
});

afterAll(async () => {
  setStorageProvider(null);
  delete process.env.DOCUMENT_STORAGE_ROOT;
  await rm(storageRoot, { recursive: true, force: true });
  // Fixtures are deleted directly, so the usage projection is rebuilt (PRD #29 §148).
  await reconcileStorageUsage();
  await cleanupSessions();
  await prisma.$disconnect();
});

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error instanceof StorageError) {
    expect(error.storageCode).toBe(code);
    return error;
  }
  expect(error, `expected ${code}`).toBeInstanceOf(AccessError);
  expect((error as AccessError).code).toBe(code);
  return error as AccessError;
}

async function seededDocument(name: string, companyId: string = COMPANY.a): Promise<string> {
  const row = await prisma.document.findFirstOrThrow({ where: { companyId, name }, select: { id: true } });
  return row.id;
}

async function listedNames(context: Context): Promise<string[]> {
  const result = await documents.listDocuments(context, documentListQuerySchema.parse({ limit: 100 }));
  return result.data.map((document) => document.name);
}

async function newDocument(context: Context): Promise<string> {
  const result = await attachDocumentFromBytes(
    context,
    { name: NAME, context: "project", projectId: PROJECT.a, fileName: "Plan.pdf", mimeType: "application/pdf" } as Parameters<typeof attachDocumentFromBytes>[1],
    pdf("version one"),
  );
  created.push(result.documentId);
  return result.documentId;
}

async function openVersion(context: Context, documentId: string, bytes: Uint8Array) {
  const session = await createVersionUploadSession(context, documentId, { fileName: "Plan-rev.pdf", mimeType: "application/pdf", sizeBytes: bytes.byteLength });
  const row = await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: session.uploadSessionId }, select: { storageKey: true } });
  await storageProvider().putObject(row.storageKey, bytes, "application/pdf");
  return session;
}

/** Puts the document's file on a submitted engineering revision, which freezes it (PRD #46 §69). */
async function freeze(context: Context, documentId: string): Promise<void> {
  const revision = await prisma.engineeringDocumentRevision.create({
    data: {
      companyId: context.companyId,
      engineeringDocumentId: ENGINEERING_DOCUMENT,
      revisionCode: `ZZ-AUTHZ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      documentId,
      status: "SUBMITTED",
      submittedAt: new Date(),
      createdByMemberId: context.membershipId,
    },
    select: { id: true },
  });
  revisions.push(revision.id);
}

/* -------------------------------------------------------------------------- */

describe("a module's document grant governs its filed documents (PRD #47 §81, §98, §99)", () => {
  it("keeps an HR company document from Group IT, who reaches HR without hr.document.view", async () => {
    const groupIt = await loginAs("GROUP_IT");
    const id = await seededDocument("Employee HR Record.pdf");

    await expectCode(documents.getDocument(groupIt, id), "NOT_FOUND");
    await expectCode(createDownloadGrant(groupIt, id), "DOCUMENT_NOT_FOUND");
    expect(await listedNames(groupIt)).not.toContain("Employee HR Record.pdf");

    const hr = await loginAs("HR");
    expect((await documents.getDocument(hr, id)).name).toBe("Employee HR Record.pdf");
  });

  it("keeps a Sales document filed on a client from a Project Manager without sales.document.view", async () => {
    // Beta Properties is Meridian's client, on the Tower its Project Manager runs.
    const pm = await loginAsEmail(DEMO_EMAIL.pmB);
    const id = await seededDocument("Beta Properties Proposal.pdf", COMPANY.b);

    await expectCode(documents.getDocument(pm, id), "NOT_FOUND");
    await expectCode(createDownloadGrant(pm, id), "DOCUMENT_NOT_FOUND");
    expect(await listedNames(pm)).not.toContain("Beta Properties Proposal.pdf");

    const sales = await loginAsMembership("member_sales_manager__b");
    expect((await documents.getDocument(sales, id)).name).toBe("Beta Properties Proposal.pdf");
  });

  it("keeps a QA/QC company document from Procurement and Inventory, and gives it to QA/QC", async () => {
    const id = await seededDocument("Quality Management Plan.pdf");
    for (const role of ["PROCUREMENT", "INVENTORY"] as const) {
      const context = await loginAs(role);
      await expectCode(documents.getDocument(context, id), "NOT_FOUND");
      await expectCode(createDownloadGrant(context, id), "DOCUMENT_NOT_FOUND");
      expect(await listedNames(context)).not.toContain("Quality Management Plan.pdf");
    }

    const qaqc = await loginAs("QAQC");
    expect((await documents.getDocument(qaqc, id)).name).toBe("Quality Management Plan.pdf");
  });
});

describe("upload grants are single use (PRD #47 §83)", () => {
  function routeCall(url: string, body: Uint8Array, headers: Record<string, string> = {}) {
    const parsed = new URL(url, "http://localhost:3000");
    const key = parsed.pathname.replace(/^\/api\/storage\/objects\//, "").split("/");
    const request = new Request(parsed.toString(), { method: "PUT", body: body as unknown as BodyInit, headers: { "Content-Type": "application/pdf", ...headers } });
    return putStorageObject(request, { params: Promise.resolve({ key }) });
  }

  it("refuses to overwrite an object, and refuses the grant outright once the upload has completed", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const original = pdf("the verified bytes");
    const grant = await createUploadSession(
      pm,
      createDocumentUploadSchema.parse({ name: NAME, context: "project", projectId: PROJECT.a, fileName: "Plan.pdf", mimeType: "application/pdf", sizeBytes: original.byteLength }),
    );
    created.push(grant.documentId);

    expect((await routeCall(grant.upload.url, original)).status).toBe(200);
    // A second PUT on the same grant, before completion, does not replace the first.
    expect((await routeCall(grant.upload.url, pdf("the swapped bytes!"))).status).toBe(412);

    const result = await completeUpload(pm, grant.uploadSessionId);
    expect(result.status).toBe("AVAILABLE");

    // After /complete the grant is spent, though its signature has not expired.
    const swap = pdf("the swapped bytes!");
    expect((await routeCall(grant.upload.url, swap)).status).toBe(403);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: grant.documentId }, select: { storageKey: true, checksum: true } });
    const stored = await readFile(path.join(storageRoot, document.storageKey!));
    expect(createHash("sha256").update(stored).digest("hex")).toBe(document.checksum);
    expect(createHash("sha256").update(stored).digest("hex")).toBe(createHash("sha256").update(original).digest("hex"));
  });

  it("refuses a declared length over the ceiling before reading the body", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const bytes = pdf("small");
    const grant = await createUploadSession(
      pm,
      createDocumentUploadSchema.parse({ name: NAME, context: "project", projectId: PROJECT.a, fileName: "Plan.pdf", mimeType: "application/pdf", sizeBytes: bytes.byteLength }),
    );
    created.push(grant.documentId);

    const parsed = new URL(grant.upload.url, "http://localhost:3000");
    const key = parsed.pathname.replace(/^\/api\/storage\/objects\//, "").split("/");
    // A request whose header claims a body far beyond the signed ceiling.
    const request = new Request(parsed.toString(), { method: "PUT", headers: { "content-length": String(10 * 1024 * 1024 * 1024) } });
    const response = await putStorageObject(request, { params: Promise.resolve({ key }) });
    expect(response.status).toBe(413);
  });
});

describe("a frozen file is re-checked where a version would replace it (PRD #46 §69, PRD #47 §85)", () => {
  it("refuses to complete a version once the file has been frozen by a submitted revision", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const documentId = await newDocument(pm);
    const before = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { currentVersionId: true, storageKey: true } });

    // Opened while the revision was still a draft...
    const session = await openVersion(pm, documentId, pdf("replacement"));
    // ...and the revision submitted before the upload completed.
    await freeze(pm, documentId);

    const error = await expectCode(completeUpload(pm, session.uploadSessionId), "CONFLICT");
    expect(error.reason).toBe("STATE_DENIED");

    const after = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { currentVersionId: true, storageKey: true } });
    expect(after).toEqual(before);
  });

  it("does not promote a scanned version onto a file frozen while the scan ran", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const documentId = await newDocument(pm);
    const before = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { currentVersionId: true } });

    const session = await openVersion(pm, documentId, pdf("scanned replacement"));
    // The scanner takes long enough for a revision to be submitted meanwhile.
    const slowScanner: FileScanner = {
      provider: "test-slow",
      async scan() {
        await freeze(pm, documentId);
        return { verdict: "CLEAN" };
      },
    };
    setFileScanner(slowScanner);
    await completeUpload(pm, session.uploadSessionId);

    const version = await prisma.documentVersion.findUniqueOrThrow({ where: { id: session.documentVersionId } });
    expect(version.storageStatus).toBe("REJECTED");
    const after = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { currentVersionId: true } });
    expect(after.currentVersionId).toBe(before.currentVersionId);
  });

  it("refuses to archive a file a submitted revision carries", async () => {
    const owner = await loginAs("OWNER");
    const documentId = await newDocument(owner);
    await freeze(owner, documentId);

    const error = await expectCode(documents.archiveDocument(owner, documentId), "CONFLICT");
    expect(error.reason).toBe("STATE_DENIED");
    expect((await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).status).toBe("ACTIVE");
  });
});

describe("archived documents and parents (PRD #29 §136, PRD #47 §82, §85)", () => {
  it("refuses a historical version's download once the document is archived", async () => {
    const owner = await loginAs("OWNER");
    const documentId = await newDocument(owner);
    const versionId = (await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).currentVersionId!;
    expect((await createVersionDownloadGrant(owner, documentId, versionId)).url).toBeTruthy();

    await documents.archiveDocument(owner, documentId);
    await expectCode(createVersionDownloadGrant(owner, documentId, versionId), "DOCUMENT_ARCHIVED");
  });

  it("refuses to complete a version on a document archived after the upload opened", async () => {
    const owner = await loginAs("OWNER");
    const documentId = await newDocument(owner);
    const session = await openVersion(owner, documentId, pdf("late version"));
    await documents.archiveDocument(owner, documentId);

    const error = await expectCode(completeUpload(owner, session.uploadSessionId), "CONFLICT");
    expect(error.reason).toBe("STATE_DENIED");
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.storageStatus).toBe("ARCHIVED");
    expect(document.currentVersionId).not.toBe(session.documentVersionId);
  });

  it("keeps an archived document archived when a scanned version is promoted onto it", async () => {
    const owner = await loginAs("OWNER");
    const documentId = await newDocument(owner);
    const session = await openVersion(owner, documentId, pdf("scanned while archived"));
    const archivingScanner: FileScanner = {
      provider: "test-archiving",
      async scan() {
        await prisma.document.update({ where: { id: documentId }, data: { status: "ARCHIVED", storageStatus: "ARCHIVED", archivedAt: new Date() } });
        return { verdict: "CLEAN" };
      },
    };
    setFileScanner(archivingScanner);
    await completeUpload(owner, session.uploadSessionId);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.currentVersionId).toBe(session.documentVersionId);
    expect(document.storageStatus).toBe("ARCHIVED");
  });

  it("takes no new files on an archived project", async () => {
    const owner = await loginAs("OWNER");
    const ref = (projectId: string) => ({ projectId, clientId: null, module: "projects", entityType: "project", entityId: projectId });
    expect(await canAttachToDocumentParent(owner, ref(PROJECT.a))).toBe(true);
    expect(await canAttachToDocumentParent(owner, ref(PROJECT.archived))).toBe(false);
  });
});
