import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { setFileScanner, StorageError } from "@/lib/core/storage";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { archiveDocument } from "@/lib/modules/documents/document.service";
import { reconcileStorageUsage } from "@/lib/modules/documents/storage/cleanup.service";
import { createDownloadGrant } from "@/lib/modules/documents/storage/download.service";
import { createPreviewGrant } from "@/lib/modules/documents/storage/preview.service";
import { createDocumentUploadSchema } from "@/lib/modules/documents/storage/storage.schema";
import { completeUpload, createUploadSession } from "@/lib/modules/documents/storage/upload.service";
import { attachUnitDocument, detachUnitDocument, listUnitFiles } from "@/lib/modules/project-structure/unit-files.service";
import { cleanupSessions, loginAs, loginAsMembership, PROJECT, prisma } from "../../helpers";

/**
 * One canonical Document shared by two records (AUD-10 §3, §6; CW-14, CW-19).
 *
 * The floor-plan case of E-05D §63: one PDF filed on the project, attached to
 * two units. Two links, one Document, one stored object. Unlinking it from one
 * unit removes that link and nothing else — the Document, its object and the
 * other unit's link stay, and the file still downloads from the other unit.
 * A link grants nobody anything: a member outside the project is refused the
 * file by id, by preview and through the unit. Archiving the Document keeps
 * the links (history is not cascaded away) and refuses new ones.
 *
 * Roles: the Project Manager uploads (document contributor on Riverside), the
 * Architect attaches and detaches (holds project.unit.documents.manage), the
 * Group Engineering head's Aurelia membership is the restricted viewer — it
 * holds document.download but is on no Aurelia project, so Riverside's
 * documents are out of its scope.
 */

const UNIT_A = "unit_riverside_a_101";
let unitB: string;
const RESTRICTED_MEMBERSHIP = "member_group_engineering";
const PDF = new TextEncoder().encode("%PDF-1.4\naud10 shared floor plan\n%%EOF\n");

let storageRoot: string;
let contributor: UserContext;
let architect: UserContext;
let restricted: UserContext;
let documentId: string;
let storageKey: string;
let unitSnapshot: Array<{ id: string; version: number; hasUnpublishedChanges: boolean; updatedAt: Date }>;
const started = new Date();

async function expectStorageCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error, `expected ${code}`).toBeInstanceOf(StorageError);
  expect((error as StorageError).storageCode).toBe(code);
}

async function documentRow() {
  return prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { id: true, storageKey: true, status: true, storageStatus: true, currentVersionId: true, entityType: true, entityId: true, projectId: true } });
}

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-aud10d-shared-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
  setFileScanner(null);

  contributor = await loginAs("PROJECT_MANAGER");
  architect = await loginAs("ARCHITECT");
  restricted = await loginAsMembership(RESTRICTED_MEMBERSHIP);
  unitB = (await prisma.projectUnit.findFirstOrThrow({ where: { projectId: PROJECT.a, unitCode: "A-102" }, select: { id: true } })).id;
  unitSnapshot = await prisma.projectUnit.findMany({ where: { id: { in: [UNIT_A, unitB] } }, select: { id: true, version: true, hasUnpublishedChanges: true, updatedAt: true } });

  const session = await createUploadSession(
    contributor,
    createDocumentUploadSchema.parse({ name: "aud10d shared floor plan", context: "project", projectId: PROJECT.a, fileName: "Floor plan.pdf", mimeType: "application/pdf", sizeBytes: PDF.byteLength }),
  );
  documentId = session.documentId;
  storageKey = (await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: session.uploadSessionId }, select: { storageKey: true } })).storageKey;
  await storageProvider().putObject(storageKey, PDF, "application/pdf");
  await completeUpload(contributor, session.uploadSessionId);
});

afterAll(async () => {
  if (documentId) {
    await prisma.unitDocumentLink.deleteMany({ where: { documentId } });
    await prisma.activity.deleteMany({ where: { OR: [{ entityId: documentId }, { metadata: { path: ["documentId"], equals: documentId } }] } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ entityId: documentId }, { entityId: { in: [UNIT_A, unitB] }, createdAt: { gte: started } }] } });
    await prisma.documentUploadSession.deleteMany({ where: { documentId } });
    await prisma.document.updateMany({ where: { id: documentId }, data: { currentVersionId: null } });
    await prisma.documentVersion.deleteMany({ where: { documentId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
  }
  for (const unit of unitSnapshot ?? []) {
    await prisma.projectUnit.update({ where: { id: unit.id }, data: { version: unit.version, hasUnpublishedChanges: unit.hasUnpublishedChanges, updatedAt: unit.updatedAt } });
  }
  setStorageProvider(null);
  setFileScanner(undefined);
  await rm(storageRoot, { recursive: true, force: true });
  await reconcileStorageUsage();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("one canonical document on two units (CW-14)", () => {
  it("attaching to two units creates two links to one Document — no copy", async () => {
    const before = await prisma.document.count({ where: { companyId: contributor.companyId } });
    await attachUnitDocument(architect, UNIT_A, { documentId, category: "TECHNICAL_DRAWING" });
    await attachUnitDocument(architect, unitB, { documentId, category: "TECHNICAL_DRAWING" });

    expect(await prisma.unitDocumentLink.count({ where: { documentId } })).toBe(2);
    expect(await prisma.document.count({ where: { companyId: contributor.companyId } })).toBe(before);
    for (const unit of [UNIT_A, unitB]) {
      const files = await listUnitFiles(architect, unit);
      expect(files.documents.map((link) => link.document.documentId)).toContain(documentId);
    }
  });

  it("a restricted viewer is refused the file by id, by preview and through the unit — the link grants nothing", async () => {
    // Positive control: a Riverside member downloads and previews it.
    await expect(createDownloadGrant(architect, documentId)).resolves.toMatchObject({ url: expect.any(String) });
    await expect(createPreviewGrant(architect, documentId)).resolves.toBeTruthy();

    await expectStorageCode(createDownloadGrant(restricted, documentId), "DOCUMENT_NOT_FOUND");
    await expectStorageCode(createPreviewGrant(restricted, documentId), "DOCUMENT_NOT_FOUND");
    await expect(listUnitFiles(restricted, UNIT_A)).rejects.toBeInstanceOf(AccessError);
  });

  it("unlinking from one unit removes that link only: the Document, its object and the other unit's link stay", async () => {
    const before = await documentRow();
    const link = await prisma.unitDocumentLink.findFirstOrThrow({ where: { documentId, unitId: unitB }, select: { id: true } });

    await detachUnitDocument(architect, unitB, link.id);

    expect(await prisma.unitDocumentLink.count({ where: { documentId, unitId: unitB } })).toBe(0);
    expect(await prisma.unitDocumentLink.count({ where: { documentId, unitId: UNIT_A } })).toBe(1);
    expect(await documentRow()).toEqual(before);
    expect(await storageProvider().headObject(storageKey)).not.toBeNull();
    // Still reachable from the unit that keeps it.
    expect((await listUnitFiles(architect, UNIT_A)).documents.map((row) => row.document.documentId)).toContain(documentId);
    expect((await listUnitFiles(architect, unitB)).documents.map((row) => row.document.documentId)).not.toContain(documentId);
    await expect(createDownloadGrant(architect, documentId)).resolves.toMatchObject({ url: expect.any(String) });
    // The unlink is history on the unit, naming the canonical document.
    expect(await prisma.activity.count({ where: { entityId: unitB, action: "UNIT_DOCUMENT_REMOVED", metadata: { path: ["documentId"], equals: documentId } } })).toBe(1);
  });
});

describe("an archived shared document (CW-19)", () => {
  it("keeps its links, refuses new ones, and is not served — nothing cascades away", async () => {
    // The company's Owner archives it (the Project Manager holds no document.archive).
    await archiveDocument(await loginAs("OWNER"), documentId);

    expect((await documentRow()).status).toBe("ARCHIVED");
    // The link and the object survive the archive: history, not a cleanup.
    expect(await prisma.unitDocumentLink.count({ where: { documentId, unitId: UNIT_A } })).toBe(1);
    expect(await storageProvider().headObject(storageKey)).not.toBeNull();
    // A new link to an archived document is refused before any write.
    const refusal = await attachUnitDocument(architect, unitB, { documentId, category: "TECHNICAL_DRAWING" }).then(() => null, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(AccessError);
    expect((refusal as AccessError).code).toBe("VALIDATION_ERROR");
    expect(await prisma.unitDocumentLink.count({ where: { documentId, unitId: unitB } })).toBe(0);
    // Where the unit still lists it, it says it is archived — never presented as live.
    for (const row of (await listUnitFiles(architect, UNIT_A)).documents.filter((link) => link.document.documentId === documentId)) {
      expect(row.document.archived).toBe(true);
    }
  });
});
