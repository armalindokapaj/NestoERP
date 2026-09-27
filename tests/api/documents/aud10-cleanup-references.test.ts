import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setFileScanner } from "@/lib/core/storage";
import { LocalStorageProvider } from "@/lib/core/storage/providers/local.provider";
import { setStorageProvider, storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { documentReferenceColumns, reconcileStorageUsage, runStorageCleanup } from "@/lib/modules/documents/storage/cleanup.service";
import { createUploadSession } from "@/lib/modules/documents/storage/upload.service";
import { createDocumentUploadSchema } from "@/lib/modules/documents/storage/storage.schema";
import { cleanupSessions, COMPANY, loginAs, prisma } from "../../helpers";

/**
 * Placeholder cleanup never breaks on, or breaks, a record that points at the
 * placeholder (AUD-10 §6, gap 14; PRD #29 §132, §133).
 *
 * An abandoned first upload leaves a placeholder Document. Cleanup removes it
 * outright only when nothing else names it; otherwise it marks it FAILED so
 * the record that points at it keeps a truthful, broken-upload reference.
 * Before AUD-10 "nothing else names it" was four hand-listed link tables: a
 * placeholder a project's media pointed at (a Restrict key not on the list)
 * made the delete throw — the run reported PARTIAL_FAILURE and the placeholder
 * stayed in flight forever — and one a project's cover pointed at (SET NULL)
 * was deleted from under the project. Real storage provider on a temporary
 * directory, real upload service, real cleanup.
 */

const PROJECT_ID = "aud10d_cleanup_project";
const DAILY_LOG = "daily_log_riverside_draft";
const PDF = new TextEncoder().encode("%PDF-1.4\naud10 cleanup fixture\n%%EOF\n");
let storageRoot: string;
const documents: string[] = [];

async function abandonedPlaceholder(label: string): Promise<{ documentId: string; storageKey: string }> {
  const pm = await loginAs("PROJECT_MANAGER");
  const session = await createUploadSession(
    pm,
    createDocumentUploadSchema.parse({ name: `aud10d ${label}`, context: "project", projectId: PROJECT_ID, fileName: "Fixture.pdf", mimeType: "application/pdf", sizeBytes: PDF.byteLength }),
  );
  documents.push(session.documentId);
  const row = await prisma.documentUploadSession.findUniqueOrThrow({ where: { id: session.uploadSessionId }, select: { storageKey: true } });
  await storageProvider().putObject(row.storageKey, PDF, "application/pdf");
  // Abandoned, and past the grace period.
  await prisma.documentUploadSession.update({ where: { id: session.uploadSessionId }, data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } });
  return { documentId: session.documentId, storageKey: row.storageKey };
}

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-aud10d-cleanup-"));
  process.env.STORAGE_URL_SECRET = "test-storage-signing-secret-value";
  setStorageProvider(new LocalStorageProvider({ root: storageRoot, baseUrl: "http://localhost:3000" }));
  setFileScanner(null);
  const pm = await loginAs("PROJECT_MANAGER");
  await prisma.project.create({ data: { id: PROJECT_ID, companyId: COMPANY.a, code: "AUD10D-CLN", name: "aud10d cleanup", status: "ACTIVE", projectManagerMemberId: pm.membershipId, createdBy: "test" } });
});

afterAll(async () => {
  await prisma.projectMedia.deleteMany({ where: { projectId: PROJECT_ID } });
  await prisma.dailyLogDocumentLink.deleteMany({ where: { dailyLogId: DAILY_LOG, documentId: { in: documents } } });
  await prisma.project.updateMany({ where: { id: PROJECT_ID }, data: { coverImageDocumentId: null } });
  await prisma.activity.deleteMany({ where: { OR: [{ entityId: { in: [...documents, PROJECT_ID] } }, { metadata: { path: ["projectId"], equals: PROJECT_ID } }] } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ entityId: { in: [...documents, PROJECT_ID] } }, { projectId: PROJECT_ID }] } });
  await prisma.documentUploadSession.deleteMany({ where: { documentId: { in: documents } } });
  await prisma.documentVersion.deleteMany({ where: { documentId: { in: documents } } });
  await prisma.document.deleteMany({ where: { id: { in: documents } } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  setStorageProvider(null);
  setFileScanner(undefined);
  await rm(storageRoot, { recursive: true, force: true });
  await reconcileStorageUsage();
  await cleanupSessions();
  await prisma.$disconnect();
});

describe("placeholder cleanup and the records that point at it (gap 14)", () => {
  it("knows every link table from the database, not from a list", async () => {
    const columns = (await documentReferenceColumns()).map((ref) => `${ref.table}.${ref.column}`);
    // Independently specified: the Restrict and SET NULL keys the schema declares today, and the soft references.
    for (const expected of [
      "engineering_document_revisions.documentId",
      "technical_submittal_revisions.documentId",
      "document_transmittal_items.documentId",
      "contractor_compliance_items.documentId",
      "project_media.documentId",
      "project_media.thumbnailDocumentId",
      "projects.coverImageDocumentId",
      "unit_document_links.documentId",
      "unit_media.documentId",
      "project_units.salesPlanDocumentId",
      "employee_document_links.documentId",
      "employment_assignments.sourceDocumentId",
      "employment_status_history.sourceDocumentId",
      "employment_changes.sourceDocumentId",
      "person_qualifications.supportingDocumentId",
      "daily_log_document_links.documentId",
      "unit_publications.salesPlanDocumentId",
    ]) {
      expect(columns).toContain(expected);
    }
    // The document's own parts go with it, and a composite key's company column is not a document reference.
    expect(columns).not.toContain("document_versions.documentId");
    expect(columns).not.toContain("document_upload_sessions.documentId");
    expect(columns).not.toContain("employee_document_links.companyId");
  });

  it("marks, never deletes, placeholders that a Restrict link, a SET NULL link or an unconstrained link names — and never throws", async () => {
    const media = await abandonedPlaceholder("media");
    const cover = await abandonedPlaceholder("cover");
    const evidence = await abandonedPlaceholder("evidence");
    const loose = await abandonedPlaceholder("loose");
    const pm = await loginAs("PROJECT_MANAGER");

    await prisma.projectMedia.create({ data: { companyId: COMPANY.a, projectId: PROJECT_ID, documentId: media.documentId, type: "RENDER", title: "aud10d", createdByMemberId: pm.membershipId } });
    await prisma.project.update({ where: { id: PROJECT_ID }, data: { coverImageDocumentId: cover.documentId } });
    await prisma.dailyLogDocumentLink.create({ data: { dailyLogId: DAILY_LOG, documentId: evidence.documentId, companyId: COMPANY.a } });

    // Before AUD-10 this threw PARTIAL_FAILURE: the media placeholder's delete broke its Restrict key.
    const result = await runStorageCleanup();
    expect(result.documentsFailed).toBeGreaterThanOrEqual(3);
    expect(result.documentsRemoved).toBeGreaterThanOrEqual(1);

    for (const kept of [media, cover, evidence]) {
      const row = await prisma.document.findUnique({ where: { id: kept.documentId }, select: { storageStatus: true, rejectionReason: true } });
      expect(row).toEqual({ storageStatus: "FAILED", rejectionReason: "STORAGE_OBJECT_MISSING" });
      // Its object is released — nothing verified serves that key.
      expect(await storageProvider().headObject(kept.storageKey)).toBeNull();
    }
    // The records still point at their document: nothing was nulled from under them.
    expect(await prisma.projectMedia.count({ where: { projectId: PROJECT_ID, documentId: media.documentId } })).toBe(1);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: PROJECT_ID }, select: { coverImageDocumentId: true } })).coverImageDocumentId).toBe(cover.documentId);
    expect(await prisma.dailyLogDocumentLink.count({ where: { dailyLogId: DAILY_LOG, documentId: evidence.documentId } })).toBe(1);

    // Positive control: nothing names this one, so it is removed outright with its object.
    expect(await prisma.document.findUnique({ where: { id: loose.documentId } })).toBeNull();
    expect(await storageProvider().headObject(loose.storageKey)).toBeNull();

    // A second run finds nothing more to do and still does not throw.
    const again = await runStorageCleanup();
    expect(again.documentsRemoved + again.documentsFailed).toBe(0);
  });

  it("a dry run predicts the same decisions without making them", async () => {
    const media = await abandonedPlaceholder("dry media");
    const loose = await abandonedPlaceholder("dry loose");
    const pm = await loginAs("PROJECT_MANAGER");
    await prisma.projectMedia.create({ data: { companyId: COMPANY.a, projectId: PROJECT_ID, documentId: media.documentId, type: "RENDER", title: "aud10d dry", createdByMemberId: pm.membershipId } });

    const preview = await runStorageCleanup({ dryRun: true });
    expect(preview.documentsFailed).toBe(1);
    expect(preview.documentsRemoved).toBe(1);
    for (const untouched of [media, loose]) {
      expect((await prisma.document.findUniqueOrThrow({ where: { id: untouched.documentId }, select: { storageStatus: true } })).storageStatus).toBe("PENDING_UPLOAD");
      expect(await storageProvider().headObject(untouched.storageKey)).not.toBeNull();
    }
  });
});
