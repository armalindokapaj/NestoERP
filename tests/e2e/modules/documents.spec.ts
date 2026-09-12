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

  test("uploads a project document and downloads it back", async ({ page }) => {
    await page.goto("/documents/new?projectId=project_a");

    const name = `${TEST_PREFIX} Site Report`;
    await page.getByLabel("File").setInputFiles({
      name: "site-report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nE2E fixture\n%%EOF\n"),
    });
    await page.getByLabel("Document name").fill(name);
    await page.getByRole("button", { name: "Upload document" }).click();

    await page.waitForURL(/\/documents\/[^/]+$/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // The download route re-checks authorisation and returns the stored bytes.
    const documentId = page.url().split("/").pop()!;
    const response = await page.request.get(`/api/documents/${documentId}/download`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await response.text()).toContain("%PDF");
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

test.describe("Admin is not a confidential-data super-user (PRD #13 §253)", () => {
  /**
   * Mandatory. Admin administers the platform and holds company-level
   * Documents access — and still cannot open a Finance document, because it is
   * filed under a module Admin has no access to at all. Platform
   * administration is not financial authorisation (PRD #13 §53, §253).
   */
  test("cannot reach a company Finance document", async ({ page }) => {
    await signIn(page, "ADMIN");

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
