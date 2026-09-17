import { expect, test } from "@playwright/test";

import { db, removeTestDocuments } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * The Documents journey (PRD #13 §252–§261, §270).
 *
 * The parent-access cases here are release blockers: they are the difference
 * between a document system and a leak (PRD #13 §270).
 */
const TEST_PREFIX = "E2E document";

test.afterAll(async () => {
  await removeTestDocuments(TEST_PREFIX);
  await db.$disconnect();
});

test.describe("Project Manager (PRD #13 §254)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  /**
   * The upload journey (PRD #29 §379).
   *
   * Browser to storage and back: authorise, push the bytes at a signed URL,
   * confirm, verify, available — then download. The bytes do not pass through
   * a form submission, which is the point (PRD #29 §9, §389).
   */
  test("uploads a project document straight to storage and downloads it back", async ({
    page,
  }) => {
    await page.goto("/documents/new?projectId=project_a");

    const name = `${TEST_PREFIX} Site Report`;
    await page.getByLabel("Document name").fill(name);

    await page.getByLabel("Choose files to upload").setInputFiles({
      name: "site-report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nE2E fixture\n%%EOF\n"),
    });

    // The queue reports the real lifecycle, and "Uploaded" only appears once
    // the server has verified the object (PRD #29 §342).
    await expect(mainRegion(page).getByText(/site-report\.pdf/)).toBeVisible();
    await expect(mainRegion(page).getByText(/· Uploaded$/)).toBeVisible({ timeout: 20_000 });

    const stored = await db.document.findFirstOrThrow({
      where: { name },
      select: { id: true, storageStatus: true, checksum: true, detectedMimeType: true },
    });
    expect(stored.storageStatus).toBe("AVAILABLE");
    // Read from the object's bytes, not from the browser's claim (§31).
    expect(stored.detectedMimeType).toBe("application/pdf");
    expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);

    // A grant, not a URL to keep: it is issued on request and expires.
    const grant = await page.request.post(`/api/documents/${stored.id}/download`);
    expect(grant.status()).toBe(200);
    const body = await grant.json();
    expect(body.fileName).toBe("site-report.pdf");
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);

    const download = await page.request.get(body.url);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toContain("attachment");
    expect(download.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await download.text()).toContain("%PDF");
  });

  /**
   * Batch failure isolation (PRD #29 §168, §170).
   *
   * One file being refused must not cancel its siblings. Each queue item
   * carries its own state, its own retries and its own abort, so a rejected
   * executable sits beside a successfully uploaded PDF.
   */
  test("one refused file does not take the rest of the batch with it", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    const good = `${TEST_PREFIX} Batch Good`;
    await page.getByLabel("Document name").fill(good);

    await page.getByLabel("Choose files to upload").setInputFiles([
      {
        name: "good.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\nbatch fixture\n%%EOF\n"),
      },
      {
        name: "bad.exe",
        mimeType: "application/x-msdownload",
        buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      },
    ]);

    const queue = mainRegion(page).getByRole("list", { name: "Upload queue" });
    await expect(queue.getByText(/· Uploaded$/)).toBeVisible({ timeout: 20_000 });
    await expect(queue.getByRole("alert")).toContainText(/executable/i);

    // The good one is stored and available; the bad one produced no document.
    const stored = await db.document.findFirstOrThrow({
      where: { name: good },
      select: { storageStatus: true },
    });
    expect(stored.storageStatus).toBe("AVAILABLE");
    expect(await db.document.count({ where: { name: { contains: "bad.exe" } } })).toBe(0);
  });

  /** A refused file says why, and offers no retry (PRD #29 §164, §335). */
  test("refuses an executable and says so in the queue", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    await page.getByLabel("Choose files to upload").setInputFiles({
      name: "installer.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ\u0000\u0000"),
    });

    await expect(mainRegion(page).getByRole("alert")).toContainText(/executable/i);
    await expect(mainRegion(page).getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  /**
   * The MIME-spoof journey (PRD #29 §368).
   *
   * The name and the declared type both say PDF; the bytes say Windows
   * executable. The allowlist cannot catch this and the magic-byte check can.
   */
  test("rejects an executable wearing a PDF name", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    const name = `${TEST_PREFIX} Trojan`;
    await page.getByLabel("Document name").fill(name);

    await page.getByLabel("Choose files to upload").setInputFiles({
      name: "invoice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
    });

    await expect(mainRegion(page).getByRole("alert")).toBeVisible({ timeout: 20_000 });

    const stored = await db.document.findFirst({
      where: { name },
      select: { storageStatus: true, storageKey: true },
    });
    expect(stored?.storageStatus).toBe("REJECTED");
  });

  /** PDF previews; a spreadsheet does not (PRD #29 §383). */
  test("previews a PDF inline and offers a spreadsheet as a download only", async ({ page }) => {
    const pdf = await db.document.findFirstOrThrow({
      where: { projectId: "project_a", extension: "pdf", storageStatus: "AVAILABLE" },
      select: { id: true },
    });

    const preview = await page.request.post(`/api/documents/${pdf.id}/preview`);
    expect(preview.status()).toBe(200);
    const grant = await preview.json();
    expect(grant.kind).toBe("pdf");

    const inline = await page.request.get(grant.url);
    expect(inline.headers()["content-disposition"]).toContain("inline");
    // Even served inline, the browser is told not to guess (PRD #29 §107).
    expect(inline.headers()["x-content-type-options"]).toBe("nosniff");

    const sheet = await db.document.findFirst({
      where: { extension: "xlsx", storageStatus: "AVAILABLE" },
      select: { id: true },
    });
    if (sheet) {
      const refused = await page.request.post(`/api/documents/${sheet.id}/preview`);
      expect(refused.status()).toBe(422);
    }
  });

  test("the same document appears on the project it belongs to (PRD #13 §241)", async ({
    page,
  }) => {
    await page.goto("/projects/project_a/documents");
    await expect(
      mainRegion(page).getByText("Architectural Drawings.pdf").first(),
    ).toBeVisible();
  });

  test("answers not found for a document outside scope (PRD #13 §232)", async ({ page }) => {
    const hidden = await db.document.findFirstOrThrow({
      where: { projectId: "project_c" },
      select: { id: true },
    });

    const response = await page.goto(`/documents/${hidden.id}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("Architect confidentiality (PRD #13 §255, §270)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "ARCHITECT");
  });

  /**
   * The release blocker: a generic document permission must not reach a
   * company Finance file (PRD #13 §4, §230, §270).
   */
  test("cannot see, search or open a company Finance document", async ({ page }) => {
    await page.goto("/documents/all");
    await expect(mainRegion(page).getByText("Company Financial Summary.pdf")).toHaveCount(0);

    await page.goto("/documents/all?search=Financial");
    await expect(mainRegion(page).getByText(/no documents match these filters/i)).toBeVisible();

    const finance = await db.document.findFirstOrThrow({
      where: { module: "finance", projectId: null },
      select: { id: true },
    });

    const detail = await page.goto(`/documents/${finance.id}`);
    expect(detail?.status()).toBe(404);

    // And the download route refuses it too, not just the page.
    const download = await page.request.get(`/api/documents/${finance.id}/download`);
    expect(download.status()).toBe(404);

    /*
     * Global search is the fourth door, and it used to be open: the provider
     * filtered on company alone, so this reader was handed the document's
     * title. A title is exactly what must not be confirmable
     * (PRD #13 §270, PRD #29 §4, §248).
     */
    const search = await page.request.get("/api/search?q=Financial");
    expect(search.status()).toBe(200);
    const results = await search.json();
    const documents = (results.results ?? []).filter(
      (hit: { entityType: string }) => hit.entityType === "document",
    );
    expect(documents.map((hit: { title: string }) => hit.title)).not.toContain(
      "Company Financial Summary.pdf",
    );
  });

  test("the Context filter does not offer Company (PRD #13 §231)", async ({ page }) => {
    await page.goto("/documents/all");

    // The toolbar streams in behind a Suspense boundary, and allTextContents()
    // does not auto-wait — so the filter has to be on screen before its options
    // are read, or a slow run reads an empty list and asserts nothing.
    const contextFilter = mainRegion(page).getByLabel("Context");
    await expect(contextFilter).toBeVisible();

    const options = await contextFilter.locator("option").allTextContents();

    expect(options.join(" ")).toContain("Project");
    expect(options.join(" ")).not.toContain("Company");
  });
});

test.describe("Group IT is not a confidential-data super-user (PRD #13 §253)", () => {
  /**
   * Mandatory. Group IT runs the companies' systems and holds company-level
   * Documents access — and still cannot open a Finance document, because it is
   * filed under a module Group IT has no access to at all. Technical
   * administration is not financial authorisation (PRD #13 §53, §253, E-06).
   */
  test("cannot reach a company Finance document", async ({ page }) => {
    await signIn(page, "GROUP_IT");

    const finance = await db.document.findFirstOrThrow({
      where: { module: "finance", projectId: null },
      select: { id: true },
    });

    await page.goto("/documents/all?search=Financial");
    await expect(mainRegion(page).getByText(/no documents match these filters/i)).toBeVisible();

    const detail = await page.goto(`/documents/${finance.id}`);
    expect(detail?.status()).toBe(404);

    const download = await page.request.get(`/api/documents/${finance.id}/download`);
    expect(download.status()).toBe(404);
  });
});

test.describe("Viewer (PRD #13 §260)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "VIEWER");
  });

  test("is offered no upload, edit or archive control", async ({ page }) => {
    await page.goto("/documents/all");
    await expect(page.getByRole("link", { name: "Add document" })).toHaveCount(0);
  });

  test("is refused a direct mutation API call", async ({ page }) => {
    const document = await db.document.findFirstOrThrow({
      where: { projectId: "project_a", status: "ACTIVE" },
      select: { id: true },
    });

    const response = await page.request.post(`/api/documents/${document.id}/archive`);
    expect(response.status()).toBe(403);
  });
});

test.describe("Archive keeps the binary (PRD #29 §384)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "OWNER");
  });

  /**
   * Archive keeps the file (PRD #29 §384).
   *
   * The object survives, the document leaves the active lists, and restoring
   * brings both back. Archive is a visibility state, never a deletion.
   */
  test("archiving keeps the stored object, and restoring brings it back", async ({ page }) => {
    // Not a file an engineering revision or an issued transmittal carries:
    // those are frozen, and archiving one is refused on purpose
    // (PRD #46 §69, §123, PRD #47 §85). Project A's drawings are exactly that,
    // and `findFirst` used to land on one or another depending on row order.
    const document = await db.document.findFirstOrThrow({
      where: {
        projectId: "project_a",
        status: "ACTIVE",
        storageStatus: "AVAILABLE",
        engineeringRevisions: { none: { status: { notIn: ["DRAFT", "VOID"] } } },
        submittalRevisions: { none: { status: { notIn: ["DRAFT", "VOID"] } } },
        transmittalItems: { none: { transmittal: { status: "ISSUED" } } },
      },
      orderBy: { id: "asc" },
      select: { id: true, storageKey: true },
    });

    const archive = await page.request.post(`/api/documents/${document.id}/archive`);
    expect(archive.status()).toBeLessThan(300);

    const archived = await db.document.findUniqueOrThrow({
      where: { id: document.id },
      select: { status: true, storageKey: true },
    });
    expect(archived.status).toBe("ARCHIVED");
    // The key is untouched, so the binary is still where it was.
    expect(archived.storageKey).toBe(document.storageKey);

    const restore = await page.request.post(`/api/documents/${document.id}/restore`);
    expect(restore.status()).toBeLessThan(300);

    const restored = await db.document.findUniqueOrThrow({
      where: { id: document.id },
      select: { status: true, storageStatus: true },
    });
    expect(restored.status).toBe("ACTIVE");
    expect(restored.storageStatus).toBe("AVAILABLE");
  });
});

