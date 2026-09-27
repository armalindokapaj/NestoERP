import { expect, test, type Page, type Request } from "@playwright/test";

import { db, removeTestDocuments } from "../db";
import { engineerFile, removeEmployeeFiles } from "../employee-files-fixtures";
import { mainRegion, signIn } from "../fixtures";

/**
 * Upload controls in the browser (AUD-09 §8; FV-18, FV-19).
 *
 * Written for the final AUD-09 run, not yet run. The server half is proved in
 * tests/api/documents/aud09-uploads.test.ts; this is what only a browser can
 * show: the native file chooser, what is said before a file is chosen, a
 * transfer interrupted on the wire (`page.route`), retrying one file of a
 * batch, a lost answer that must not be resent, a cancel mid-transfer, a
 * remount that loses the bytes, and a 390px phone.
 *
 * Every file is named `aud09e2e…`, so its document is `aud09e2e…` too and
 * `removeTestDocuments` sweeps it.
 */

const PREFIX = "aud09e2e";
const UPLOAD_PAGE = "/documents/new?projectId=project_a";
const PDF = (label: string) => Buffer.from(`%PDF-1.4\n${label}\n%%EOF\n`);

test.afterAll(async () => {
  await removeTestDocuments(PREFIX);
  await removeEmployeeFiles(`E2E ${PREFIX}`);
  await db.$disconnect();
});

/** Every request the page makes to a URL, counted by method. */
function track(page: Page, pattern: RegExp) {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (pattern.test(request.url())) seen.push(request);
  });
  return (method: string) => seen.filter((request) => request.method() === method).length;
}

const queue = (page: Page) => mainRegion(page).getByTestId("upload-queue");
const row = (page: Page, fileName: string) => queue(page).getByTestId("upload-queue-item").filter({ hasText: fileName });
const documentsNamed = (name: string) => db.document.count({ where: { name } });

test.describe("Documents uploader (AUD-09 §8)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("says what it takes before a file is chosen, and the chooser offers only that", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    const hint = mainRegion(page).getByTestId("upload-accepted-types");
    await expect(hint).toContainText("Required: at least one file");
    await expect(hint).toContainText("100 MB");
    await expect(hint).toContainText("Image (JPG, JPEG, PNG, WEBP)");
    const input = page.getByLabel("Choose files to upload");
    await expect(input).toHaveAttribute("accept", /\.pdf/);
    await expect(input).not.toHaveAttribute("accept", /\.exe|\.svg|\.zip/);
  });

  test("the native file chooser opens from the dropzone and the chosen file uploads", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    const chooser = page.waitForEvent("filechooser");
    await mainRegion(page).getByRole("button", { name: /Drop files here/ }).click();
    const fileChooser = await chooser;
    expect(fileChooser.isMultiple()).toBe(true);
    await fileChooser.setFiles({ name: `${PREFIX}-chooser.pdf`, mimeType: "application/pdf", buffer: PDF("chooser") });

    await expect(row(page, `${PREFIX}-chooser.pdf`)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    await expect(row(page, `${PREFIX}-chooser.pdf`)).toContainText("· Uploaded");
    expect(await documentsNamed(`${PREFIX}-chooser`)).toBe(1);
  });

  test("an unsupported format is refused before any request, with the server's sentence", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    const count = track(page, /\/api\/documents\/uploads/);
    await page.getByLabel("Choose files to upload").setInputFiles({ name: `${PREFIX}-diagram.svg`, mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });

    const refused = row(page, `${PREFIX}-diagram.svg`);
    await expect(refused).toHaveAttribute("data-status", "failed");
    await expect(refused.getByRole("alert")).toHaveText("SVG images cannot be uploaded.");
    await expect(refused.getByRole("button", { name: /Retry/ })).toHaveCount(0);
    expect(count("POST")).toBe(0);
    expect(await documentsNamed(`${PREFIX}-diagram`)).toBe(0);
  });

  test("an interrupted transfer fails one file; Retry sends only that file, under the same upload", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    const puts = new Map<string, number>();
    let dropped = false;
    await page.route(/\/api\/storage\/objects\//, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const size = route.request().postDataBuffer()?.length ?? 0;
      const label = size === PDF("flaky").length ? "flaky" : "steady";
      puts.set(label, (puts.get(label) ?? 0) + 1);
      // The first transfer of the flaky file dies on the wire.
      if (label === "flaky" && !dropped) {
        dropped = true;
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });

    await page.getByLabel("Choose files to upload").setInputFiles([
      { name: `${PREFIX}-flaky.pdf`, mimeType: "application/pdf", buffer: PDF("flaky") },
      { name: `${PREFIX}-steady-file.pdf`, mimeType: "application/pdf", buffer: PDF("steady-file") },
    ]);

    await expect(row(page, `${PREFIX}-steady-file.pdf`)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    const flaky = row(page, `${PREFIX}-flaky.pdf`);
    await expect(flaky).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
    await expect(flaky.getByRole("alert")).toContainText("connection dropped");

    await flaky.getByRole("button", { name: `Retry ${PREFIX}-flaky.pdf` }).click();
    await expect(flaky).toHaveAttribute("data-status", "done", { timeout: 20_000 });

    // The steady file went once; the flaky one twice; each is one document.
    expect(puts.get("steady")).toBe(1);
    expect(puts.get("flaky")).toBe(2);
    expect(await documentsNamed(`${PREFIX}-flaky`)).toBe(1);
    expect(await documentsNamed(`${PREFIX}-steady-file`)).toBe(1);
    expect(await db.documentUploadSession.count({ where: { document: { name: `${PREFIX}-flaky` } } })).toBe(1);
  });

  /**
   * The completion commits and its answer is lost (FV-13, FV-18). Retry asks
   * the server again — it does not send the bytes again or make a second
   * document.
   */
  test("a lost completion answer is re-asked, never resent", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    const count = track(page, /\/api\/storage\/objects\//);
    let lost = false;
    await page.route(/\/api\/documents\/uploads\/[^/]+\/complete$/, async (route) => {
      if (lost) return route.continue();
      lost = true;
      await route.fetch(); // the server completes it...
      await route.abort("connectionreset"); // ...and the browser never hears.
    });

    await page.getByLabel("Choose files to upload").setInputFiles({ name: `${PREFIX}-lost-answer.pdf`, mimeType: "application/pdf", buffer: PDF("lost-answer") });
    const item = row(page, `${PREFIX}-lost-answer.pdf`);
    await expect(item).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
    await item.getByRole("button", { name: /Retry/ }).click();
    await expect(item).toHaveAttribute("data-status", "done", { timeout: 20_000 });

    expect(count("PUT")).toBe(1);
    const stored = await db.document.findMany({ where: { name: `${PREFIX}-lost-answer` }, select: { id: true, storageStatus: true } });
    expect(stored).toHaveLength(1);
    expect(stored[0].storageStatus).toBe("AVAILABLE");
    expect(await db.activity.count({ where: { entityId: stored[0].id, action: "DOCUMENT_UPLOADED" } })).toBe(1);
  });

  test("cancelling mid-transfer removes the placeholder and says Cancelled", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/storage\/objects\//, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await held;
      await route.abort().catch(() => undefined);
    });

    await page.getByLabel("Choose files to upload").setInputFiles({ name: `${PREFIX}-cancel.pdf`, mimeType: "application/pdf", buffer: PDF("cancel") });
    const item = row(page, `${PREFIX}-cancel.pdf`);
    await expect(item).toHaveAttribute("data-status", "uploading", { timeout: 20_000 });
    const aborted = page.waitForResponse((response) => /\/api\/documents\/uploads\/[^/]+\/abort$/.test(response.url()));
    await item.getByRole("button", { name: `Cancel upload of ${PREFIX}-cancel.pdf` }).click();
    await aborted;
    release();

    await expect(item).toHaveAttribute("data-status", "cancelled");
    await expect(item).toContainText("Cancelled");
    expect(await documentsNamed(`${PREFIX}-cancel`)).toBe(0);
  });

  /**
   * FV-19: the page is left and come back to. A file that failed has lost its
   * bytes with the old page, so it comes back as its name and "Select this
   * file again" — never as attached — and choosing it again finishes the same
   * upload rather than starting a second one.
   */
  test("after a remount a failed file is a name to select again, not an attachment", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    await page.route(/\/api\/storage\/objects\//, (route) => (route.request().method() === "PUT" ? route.abort("internetdisconnected") : route.continue()));
    await page.getByLabel("Choose files to upload").setInputFiles({ name: `${PREFIX}-remount.pdf`, mimeType: "application/pdf", buffer: PDF("remount") });
    await expect(row(page, `${PREFIX}-remount.pdf`)).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
    await page.unroute(/\/api\/storage\/objects\//);

    // Away (client-side) and back: the control remounts, the tab keeps its memory.
    await page.getByRole("link", { name: /^Cancel$/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/documents/new"));
    await page.goBack();
    await page.waitForURL(/\/documents\/new/);

    const lost = queue(page).getByTestId("upload-queue-lost").filter({ hasText: `${PREFIX}-remount.pdf` });
    await expect(lost).toContainText("Not attached");
    await expect(lost).not.toContainText("Uploaded");
    const chooser = page.waitForEvent("filechooser");
    await lost.getByRole("button", { name: "Select this file again" }).click();
    await (await chooser).setFiles({ name: `${PREFIX}-remount.pdf`, mimeType: "application/pdf", buffer: PDF("remount") });

    await expect(row(page, `${PREFIX}-remount.pdf`)).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    expect(await documentsNamed(`${PREFIX}-remount`)).toBe(1);
  });
});

test.describe("on a 390px phone (AUD-09 §8, FV-19; AUD-04)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("choosing, failing and retrying one file stays inside the screen", async ({ page }) => {
    await page.goto(UPLOAD_PAGE);
    await expect(mainRegion(page).getByTestId("upload-accepted-types")).toBeVisible();

    let dropped = false;
    await page.route(/\/api\/storage\/objects\//, async (route) => {
      if (route.request().method() === "PUT" && !dropped) {
        dropped = true;
        return route.abort("internetdisconnected");
      }
      return route.continue();
    });

    const chooser = page.waitForEvent("filechooser");
    await mainRegion(page).getByRole("button", { name: /Drop files here/ }).tap();
    await (await chooser).setFiles({ name: `${PREFIX}-phone-photo.jpg`, mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]) });

    const item = row(page, `${PREFIX}-phone-photo.jpg`);
    await expect(item).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
    const retry = item.getByRole("button", { name: /Retry/ });
    const box = (await retry.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await retry.tap();
    await expect(item).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    expect(await documentsNamed(`${PREFIX}-phone-photo`)).toBe(1);
  });
});

/**
 * A form that uploads first and files second (AUD-09 §8, FV-18): a refused
 * filing keeps the uploaded file, and the corrected submit files it without
 * uploading it again or making a second document.
 */
test("HR employee document: a refused filing keeps the upload; resubmitting files it once", async ({ page }) => {
  const { employeeId } = await engineerFile();
  const title = `E2E ${PREFIX} Licence`;
  await signIn(page, "HR", { to: `/hr/employees/${employeeId}/documents` });
  const puts = track(page, /\/api\/storage\/objects\//);

  let refused = false;
  await page.route(new RegExp(`/api/hr/employees/${employeeId}/documents$`), async (route) => {
    if (route.request().method() !== "POST" || refused) return route.continue();
    refused = true;
    await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "Check the issuer.", details: { issuer: ["Check the issuer."] } } }) });
  });

  await mainRegion(page).getByTestId("add-employee-document").click();
  const dialog = page.getByTestId("add-employee-document-dialog");
  await dialog.getByLabel("What it is").selectOption({ label: "Driving licence" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Issued by").fill("DPSHTRR");
  await dialog.getByLabel("Expires on").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await dialog.getByTestId("employee-document-file").setInputFiles({ name: "licence.pdf", mimeType: "application/pdf", buffer: PDF("hr licence") });
  await dialog.getByRole("button", { name: "Add document" }).click();

  // Refused: the dialog stays, with what it said, and the file is kept.
  await expect(dialog).toContainText("Check the issuer.");
  await expect(dialog).toBeVisible();
  expect(puts("PUT")).toBe(1);

  await dialog.getByRole("button", { name: "Add document" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  expect(puts("PUT")).toBe(1);
  expect(await documentsNamed(title)).toBe(1);
  expect(await db.employeeDocumentLink.count({ where: { title } })).toBe(1);
});
