import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/lib/access/guards";
import {
  createDocumentSchema,
  documentListQuerySchema,
  updateDocumentSchema,
} from "@/lib/modules/documents/document.schema";
import * as documents from "@/lib/modules/documents/document.service";
import { LocalDocumentStorage } from "@/lib/storage/local.storage";
import { setDocumentStorage } from "@/lib/storage";
import { cleanupSessions, loginAs, loginAsEmail, PROJECT, prisma } from "../../helpers";

/**
 * Documents authorisation, upload and parent-access tests
 * (PRD #13 §229–§246, §270).
 *
 * Storage points at a temporary directory, so these exercise the real upload
 * and download paths rather than a mock — a suite that stubs storage proves
 * nothing about the code that stores files.
 */
let storageRoot: string;
const created: string[] = [];

beforeAll(async () => {
  storageRoot = await mkdtemp(path.join(tmpdir(), "nesto-docs-"));
  setDocumentStorage(new LocalDocumentStorage(storageRoot));
});

afterEach(async () => {
  if (created.length === 0) return;
  await prisma.activity.deleteMany({ where: { entityId: { in: created } } });
  await prisma.document.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
});

afterAll(async () => {
  setDocumentStorage(null);
  await rm(storageRoot, { recursive: true, force: true });
  await cleanupSessions();
  await prisma.$disconnect();
});

const PDF = new TextEncoder().encode("%PDF-1.4\ntest fixture\n%%EOF\n");

function upload(fileName = "Fixture.pdf", bytes: Uint8Array = PDF) {
  return { fileName, mimeType: "application/pdf", bytes };
}

function createInput(overrides: Record<string, unknown> = {}) {
  return createDocumentSchema.parse({
    name: "Authorisation Test Document",
    context: "project",
    projectId: PROJECT.a,
    ...overrides,
  });
}

async function track<T extends { id: string }>(work: Promise<T>): Promise<T> {
  const result = await work;
  created.push(result.id);
  return result;
}

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(AccessError);
  await promise.catch((error: AccessError) => expect(error.code).toBe(code));
}

/* -------------------------------------------------------------------------- */

describe("parent access (PRD #13 §229, §232, §270)", () => {
  it("gives the Owner documents across contexts", async () => {
    const context = await loginAs("OWNER");
    const result = await documents.listDocuments(
      context,
      documentListQuerySchema.parse({ limit: 100 }),
    );
    expect(result.pagination.total).toBeGreaterThan(10);
  });

  /**
   * The headline invariant: a generic document permission never reaches a
   * Finance or HR file (PRD #13 §4, §48, §255).
   */
  it("keeps company Finance and HR documents away from an Architect", async () => {
    const architect = await loginAs("ARCHITECT");
    const result = await documents.listDocuments(
      architect,
      documentListQuerySchema.parse({ limit: 100 }),
    );
    const names = result.data.map((document) => document.name);

    expect(names).not.toContain("Company Financial Summary.pdf");
    expect(names).not.toContain("Employee HR Record.pdf");

    const finance = await prisma.document.findFirstOrThrow({
      where: { companyId: architect.companyId, module: "finance", projectId: null },
      select: { id: true },
    });
    await expectError(documents.getDocument(architect, finance.id), "NOT_FOUND");
  });

  it("gives Finance its own company document", async () => {
    const context = await loginAs("FINANCE");
    const result = await documents.listDocuments(
      context,
      documentListQuerySchema.parse({ limit: 100 }),
    );
    expect(result.data.map((document) => document.name)).toContain(
      "Company Financial Summary.pdf",
    );
  });

  it("keeps a Project Manager to their own projects", async () => {
    const pm = await loginAs("PROJECT_MANAGER");
    const result = await documents.listDocuments(
      pm,
      documentListQuerySchema.parse({ limit: 100 }),
    );

    for (const document of result.data) {
      if (document.context.label === "Project") {
        expect(["Riverside Residences", "Central Office Tower"]).toContain(
          document.context.relatedRecordName,
        );
      }
    }
  });

  /** Fail closed on a parent nobody has registered (PRD #13 §45, §243). */
  it("hides a document filed under an unregistered entity type", async () => {
    const owner = await loginAs("OWNER");

    // A shape no module has registered a resolver for. Finance record types
    // are registered now (PRD #15 §188), so the fixture uses one that is not.
    const orphan = await prisma.document.create({
      data: {
        companyId: owner.companyId,
        name: "Unregistered Parent Fixture",
        module: "qaqc",
        entityType: "inspection",
        entityId: "inspection_does_not_exist",
        status: "ACTIVE",
        createdBy: owner.userId,
      },
      select: { id: true },
    });
    created.push(orphan.id);

    const result = await documents.listDocuments(
      owner,
      documentListQuerySchema.parse({ limit: 100 }),
    );
    expect(result.data.map((document) => document.id)).not.toContain(orphan.id);
    await expectError(documents.getDocument(owner, orphan.id), "NOT_FOUND");
  });
});

describe("cross-company isolation (PRD #13 §232, §261)", () => {
  it("never returns Company A documents to a Company B user", async () => {
    const contextB = await loginAsEmail("owner-b@nesto.test");
    const result = await documents.listDocuments(
      contextB,
      documentListQuerySchema.parse({ limit: 100 }),
    );

    const companyA = await prisma.document.findFirstOrThrow({
      where: { companyId: { not: contextB.companyId } },
      select: { id: true },
    });

    expect(result.data.map((document) => document.id)).not.toContain(companyA.id);
    await expectError(documents.getDocument(contextB, companyA.id), "NOT_FOUND");
  });

  it("refuses to file a document against another company's project", async () => {
    const contextB = await loginAsEmail("owner-b@nesto.test");
    await expectError(
      documents.createDocument(contextB, createInput(), upload()),
      "VALIDATION_ERROR",
    );
  });
});

describe("upload (PRD #13 §234, §235)", () => {
  it("stores the object and records what was actually written", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const document = await track(
      documents.createDocument(context, createInput(), upload("Site Report.pdf")),
    );

    expect(document.file.available).toBe(true);
    expect(document.file.extension).toBe("pdf");
    // The size is measured from the stored object, not taken on trust.
    expect(document.file.sizeBytes).toBe(String(PDF.byteLength));
    expect(document.uploadedBy?.memberId).toBe(context.membershipId);
  });

  it("refuses an unsupported file type", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    await expectError(
      documents.createDocument(context, createInput(), upload("payload.exe")),
      "VALIDATION_ERROR",
    );
  });

  it("refuses a project the caller cannot reach", async () => {
    const context = await loginAs("ARCHITECT");
    await expectError(
      documents.createDocument(context, createInput({ projectId: PROJECT.b }), upload()),
      "VALIDATION_ERROR",
    );
  });

  it("refuses a Viewer", async () => {
    const context = await loginAs("VIEWER");
    await expectError(documents.createDocument(context, createInput(), upload()), "FORBIDDEN");
  });

  /** A company document needs the company-document grant (PRD #13 §92, §234). */
  it("refuses a company document from a project-scoped user", async () => {
    const architect = await loginAs("ARCHITECT");
    await expectError(
      documents.createDocument(architect, createInput({ context: "company" }), upload()),
      "FORBIDDEN",
    );
  });

  it("allows a company document from a company-scoped user", async () => {
    const finance = await loginAs("FINANCE");
    const document = await track(
      documents.createDocument(finance, createInput({ context: "company" }), upload()),
    );
    expect(document.context.label).toBe("Company");
  });
});

describe("download (PRD #13 §233)", () => {
  it("returns the stored bytes to an authorised reader", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const document = await track(documents.createDocument(context, createInput(), upload()));

    const file = await documents.readDocumentFile(context, document.id);
    expect(new TextDecoder().decode(file.bytes)).toContain("%PDF");
    expect(file.fileName).toBe("Fixture.pdf");
    expect(file.inline).toBe(true);
  });

  it("refuses a reader who cannot reach the parent", async () => {
    // Project B: the Project Manager works on it, the Architect does not.
    const pm = await loginAs("PROJECT_MANAGER");
    const document = await track(
      documents.createDocument(pm, createInput({ projectId: PROJECT.b }), upload()),
    );

    const architect = await loginAs("ARCHITECT");
    await expectError(documents.readDocumentFile(architect, document.id), "NOT_FOUND");
  });

  it("reports a missing object rather than crashing (PRD #13 §240)", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const document = await track(documents.createDocument(context, createInput(), upload()));

    const row = await prisma.document.findUniqueOrThrow({
      where: { id: document.id },
      select: { storageKey: true },
    });
    await rm(path.join(storageRoot, row.storageKey!), { force: true });

    const detail = await documents.getDocument(context, document.id);
    expect(detail.file.available).toBe(false);
    expect(detail.capabilities.canDownload).toBe(false);

    await expectError(documents.readDocumentFile(context, document.id), "NOT_FOUND");
  });
});

describe("metadata and lifecycle (PRD #13 §238, §239)", () => {
  it("renames without touching the stored object", async () => {
    const context = await loginAs("PROJECT_MANAGER");
    const document = await track(documents.createDocument(context, createInput(), upload()));

    const before = await prisma.document.findUniqueOrThrow({
      where: { id: document.id },
      select: { storageKey: true, checksum: true },
    });

    await documents.updateDocument(
      context,
      document.id,
      updateDocumentSchema.parse({ name: "Renamed Document" }),
    );

    const after = await prisma.document.findUniqueOrThrow({
      where: { id: document.id },
      select: { storageKey: true, checksum: true, name: true },
    });

    expect(after.name).toBe("Renamed Document");
    expect(after.storageKey).toBe(before.storageKey);
    expect(after.checksum).toBe(before.checksum);
  });

  /** Archiving keeps the binary (PRD #13 §112, §238). */
  it("archives and restores while the file survives", async () => {
    const context = await loginAs("OWNER");
    const document = await track(documents.createDocument(context, createInput(), upload()));

    await documents.archiveDocument(context, document.id);
    const archived = await documents.getDocument(context, document.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.file.available).toBe(true);

    await expectError(
      documents.updateDocument(
        context,
        document.id,
        updateDocumentSchema.parse({ name: "Nope" }),
      ),
      "CONFLICT",
    );

    await documents.restoreDocument(context, document.id);
    const restored = await documents.getDocument(context, document.id);
    expect(restored.status).toBe("ACTIVE");
    expect(restored.archivedAt).toBeNull();
  });

  it("refuses a stale write", async () => {
    const context = await loginAs("OWNER");
    const document = await track(documents.createDocument(context, createInput(), upload()));

    await expectError(
      documents.updateDocument(
        context,
        document.id,
        updateDocumentSchema.parse({
          name: "Stale",
          versionUpdatedAt: "2020-01-01T00:00:00.000Z",
        }),
      ),
      "CONFLICT",
    );
  });
});
