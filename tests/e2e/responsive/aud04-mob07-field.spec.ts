import { expect, test, type Page } from "@playwright/test";

import { photoWithExif } from "../daily-logs-fixtures";
import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { expectNoPageOverflow, outsideProjects } from "./geometry";

/**
 * MOB-07 field work: the PDF viewer, capture -> preview -> use, the upload
 * queue's retry after a dropped connection, the upload's frozen context, and
 * photos on an HSE report. Real identities; every document is named with the
 * `mob07_` prefix and removed afterwards.
 */

const PREFIX = "mob07_";
const SIZES = /^aud04-(phone-320|phone-390|desktop-1280)$/;

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({}, testInfo) => {
  test.skip(outsideProjects(testInfo, SIZES), "MOB-07 runs at 320, 390 and 1280.");
});

async function clean() {
  const documents = await db.document.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  const ids = documents.map((document) => document.id);
  await db.documentUploadSession.deleteMany({ where: { documentId: { in: ids } } });
  await db.documentVersion.deleteMany({ where: { documentId: { in: ids } } }).catch(() => undefined);
  await db.document.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
  await db.hseHazard.deleteMany({ where: { title: { startsWith: PREFIX } } }).catch(() => undefined);
}

test.beforeAll(clean);
test.afterAll(async () => {
  await clean();
  await db.$disconnect();
});

/** A valid three-page PDF with a real xref table. */
function threePagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    ...[0, 1, 2].map(() => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>"),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function chooseFiles(page: Page, button: string, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId(button).click();
  await (await chooser).setFiles(files);
}

const photo = (label: string, n = 1) => ({ name: `${PREFIX}${label}-${n}.jpg`, mimeType: "image/jpeg", buffer: photoWithExif() });

test("a PDF opens in the viewer: pages, zoom, close", async ({ page }) => {
  await signIn(page, "OWNER");
  await page.goto("/documents/new?projectId=project_a");
  const name = `${PREFIX}Facade Detail`;
  await page.getByLabel("Document name").fill(name);
  await page.getByLabel("Choose files to upload").setInputFiles({ name: `${PREFIX}facade.pdf`, mimeType: "application/pdf", buffer: threePagePdf() });
  await expect(mainRegion(page).getByText(/· Uploaded$/)).toBeVisible({ timeout: 20_000 });
  const stored = await db.document.findFirstOrThrow({ where: { name }, select: { id: true } });

  await page.goto(`/documents/${stored.id}`);
  await mainRegion(page).getByTestId("view-document").first().click();
  const viewer = page.getByTestId("document-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByTestId("pdf-viewer")).toBeVisible({ timeout: 20_000 });
  await expect(viewer.getByTestId("pdf-page-indicator")).toHaveText("1 / 3");

  await viewer.getByRole("button", { name: "Next page" }).click();
  await expect(viewer.getByTestId("pdf-page-indicator")).toHaveText("2 / 3");
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByRole("button", { name: "Fit to width" })).toBeEnabled();
  await viewer.getByRole("button", { name: "Fit to width" }).click();

  await viewer.getByTestId("document-viewer-close").click();
  await expect(viewer).toBeHidden();
  await expectNoPageOverflow(page);
});

test("task evidence: preview, remove one, use the rest — one document each, location removed", async ({ page }) => {
  await signIn(page, "OWNER");
  const created = await page.request.post("/api/tasks", { data: { title: `${PREFIX}Site inspection`, projectId: "project_a", status: "TODO", priority: "MEDIUM" } });
  expect(created.status(), await created.text()).toBe(201);
  const task = ((await created.json()) as { data: { id: string } }).data;

  await page.goto(`/tasks/${task.id}`);
  await mainRegion(page).getByTestId("add-evidence").click();
  await chooseFiles(page, "capture-choose-photos", [photo("task", 1), photo("task", 2), photo("task", 3)]);

  const staged = mainRegion(page).getByTestId("capture-staged");
  await expect(staged.getByTestId("capture-staged-item")).toHaveCount(3);
  await expect(staged.getByTestId("capture-preview")).toBeVisible();
  // Nothing has reached NESTO yet.
  expect(await db.document.count({ where: { name: { startsWith: `${PREFIX}task-` } } })).toBe(0);

  await staged.getByRole("button", { name: `Remove ${PREFIX}task-2.jpg` }).click();
  await expect(staged.getByTestId("capture-staged-item")).toHaveCount(2);
  await staged.getByTestId("capture-use").click();

  const queue = mainRegion(page).getByTestId("upload-queue");
  await expect(queue.getByTestId("upload-queue-item")).toHaveCount(2);
  await expect.poll(() => db.document.count({ where: { name: { startsWith: `${PREFIX}task-`, }, storageStatus: "AVAILABLE" } }), { timeout: 30_000 }).toBe(2);

  const rows = await db.document.findMany({ where: { name: { startsWith: `${PREFIX}task-` } }, select: { entityType: true, entityId: true, projectId: true } });
  for (const row of rows) expect(row).toMatchObject({ entityType: "task", entityId: task.id });

  // A note is an ordinary comment on the same task.
  await mainRegion(page).getByLabel("Note (optional)").fill("Checked the north facade.");
  await mainRegion(page).getByTestId("add-evidence-note").click();
  await expect(mainRegion(page).getByText("Note added.")).toBeVisible();
  await expectNoPageOverflow(page);
  await db.task.deleteMany({ where: { id: task.id } });
});

test("a dropped connection fails the upload, Retry finishes it, and exactly one document results", async ({ page }) => {
  await signIn(page, "OWNER");
  await page.goto("/projects/project_a/documents");
  await mainRegion(page).getByTestId("project-capture").click();

  let dropped = false;
  await page.route(/\/api\/storage\/objects\//, async (route) => {
    if (route.request().method() === "PUT" && !dropped) {
      dropped = true;
      return route.abort("connectionreset");
    }
    return route.continue();
  });

  const authoriseBodies: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/documents/uploads")) authoriseBodies.push(request.postData() ?? "");
  });

  await chooseFiles(page, "capture-choose-photos", [photo("net")]);
  await page.getByTestId("capture-use").click();

  const item = page.getByTestId("upload-queue-item").first();
  await expect(item).toHaveAttribute("data-status", "failed", { timeout: 20_000 });
  // Never "uploaded" until the server confirms.
  expect(await db.document.count({ where: { name: { startsWith: `${PREFIX}net-` }, storageStatus: "AVAILABLE" } })).toBe(0);

  await item.getByRole("button", { name: /retry/i }).click();
  await expect(item).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  expect(await db.document.count({ where: { name: { startsWith: `${PREFIX}net-` } } })).toBe(1);

  // The context was fixed when "Use photo" was pressed: this project, nothing else.
  expect(authoriseBodies.length).toBeGreaterThan(0);
  for (const body of authoriseBodies) expect(JSON.parse(body)).toMatchObject({ context: "project", projectId: "project_a" });
  const stored = await db.document.findFirstOrThrow({ where: { name: { startsWith: `${PREFIX}net-` } }, select: { projectId: true } });
  expect(stored.projectId).toBe("project_a");
});

test("an HSE hazard report carries its photos to the new record", async ({ page }) => {
  await signIn(page, "OWNER");
  await page.goto("/hse/hazards/new?projectId=project_a");
  const title = `${PREFIX}Loose scaffold`;
  await page.getByLabel(/^Title/).fill(title);
  await page.getByLabel(/^Description/).fill("Scaffold boards unsecured on level 10.");
  await chooseFiles(page, "capture-choose-photos", [photo("hse", 1), photo("hse", 2)]);
  await expect(page.getByTestId("capture-staged-item")).toHaveCount(2);
  // Still on this device until the report is submitted.
  expect(await db.document.count({ where: { name: { startsWith: `${PREFIX}hse-` } } })).toBe(0);

  await page.getByRole("button", { name: /report/i }).last().click();
  await expect(page).toHaveURL(/\/hse\/hazards\/(?!new)[^/?]+$/, { timeout: 40_000 });
  const hazard = await db.hseHazard.findFirstOrThrow({ where: { title }, select: { id: true } });
  const documents = await db.document.findMany({ where: { name: { startsWith: `${PREFIX}hse-` } }, select: { entityType: true, entityId: true, storageStatus: true } });
  expect(documents).toHaveLength(2);
  for (const document of documents) expect(document).toMatchObject({ entityType: "hazard", entityId: hazard.id, storageStatus: "AVAILABLE" });
});
