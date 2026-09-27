import { Prisma } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

import { storageProvider } from "@/lib/core/storage/storage-provider.factory";
import { db } from "../db";
import { signIn } from "../fixtures";

test.describe.configure({ mode: "serial" });

const PROJECT_ID = "project_e2e_3d";
const PROJECT_CODE = "E2E-3D";
const PROJECT_NAME = "E2E Native 3D Project";
const COMPANY_ID = "company_demo_a";
const SLOT_ID = "project_e2e_3d_slot";
const VERSION_ID = "project_e2e_3d_version";
const RELEASE_ID = "project_e2e_3d_release";
const SOURCE_KEY = `companies/${COMPANY_ID}/projects/${PROJECT_ID}/3d/source/e2e-source.glb`;
const RUNTIME_KEY = `companies/${COMPANY_ID}/projects/${PROJECT_ID}/3d/runtime/e2e-runtime.glb`;
let groupName = "";
let companyName = "";

function emptyGlb(): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}], nodes: [] }));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  return bytes;
}

/** A GLB with one named triangle: small, valid, and preparable by the real pipeline. */
function triangleGlb(nodeName: string): Uint8Array {
  const binary = new Uint8Array(44);
  new Float32Array(binary.buffer, 0, 9).set([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  new Uint16Array(binary.buffer, 36, 3).set([0, 1, 2]);
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: nodeName, mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [10, 10, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    buffers: [{ byteLength: 44 }],
  }));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(20 + jsonLength + 8 + binary.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  view.setUint32(20 + jsonLength, binary.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  bytes.set(binary, 28 + jsonLength);
  return bytes;
}

async function removeFixture() {
  // Every object an upload in these tests wrote, not only the fixture's own two.
  const uploaded = await db.project3DModelVersion.findMany({ where: { projectId: PROJECT_ID }, select: { sourceStorageKey: true, runtimeStorageKey: true } });
  for (const key of uploaded.flatMap((version) => [version.sourceStorageKey, version.runtimeStorageKey])) {
    if (key && key !== SOURCE_KEY && key !== RUNTIME_KEY) await storageProvider().deleteObject(key).catch(() => undefined);
  }
  await db.project3DConfig.updateMany({ where: { projectId: PROJECT_ID }, data: { activeReleaseId: null } });
  await db.project3DUnitMeshBinding.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.project3DRelease.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.project3DModelVersion.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.project3DModelSlot.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.project3DConfig.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.project3DEntitlement.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.auditEvent.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.projectMember.deleteMany({ where: { projectId: PROJECT_ID } });
  await db.project.deleteMany({ where: { id: PROJECT_ID } });
  await storageProvider().deleteObject(SOURCE_KEY).catch(() => undefined);
  await storageProvider().deleteObject(RUNTIME_KEY).catch(() => undefined);
}

async function publishFixture() {
  const [config, platformUser] = await Promise.all([
    db.project3DConfig.findUniqueOrThrow({ where: { projectId: PROJECT_ID } }),
    db.user.findUniqueOrThrow({ where: { username: "platform-admin" }, select: { id: true } }),
  ]);
  const bytes = emptyGlb();
  await storageProvider().putObject(RUNTIME_KEY, bytes, "model/gltf-binary");
  const experience = (config.authoringDocument as { config: Record<string, unknown> }).config;
  const createdAt = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    companyId: COMPANY_ID,
    releaseId: RELEASE_ID,
    releaseNumber: 1,
    createdAt,
    experience,
    models: [{
      slotId: SLOT_ID,
      slotName: "Building",
      slotRole: "BUILDING",
      transformParentSlotId: null,
      versionId: VERSION_ID,
      versionNumber: 1,
      runtimeStorageKey: RUNTIME_KEY,
      runtimeFileName: "building.glb",
      runtimeContentType: "model/gltf-binary",
      transform: { scale: 1, rotationDeg: 0, altitudeOffset: 0, positionX: 0, positionZ: 0, rotationXDeg: 0, rotationZDeg: 0 },
      visible: true,
      castShadow: true,
      receiveShadow: true,
      selectable: true,
      sceneManifest: [],
      nodeOverrides: [],
      unitBindings: [],
    }],
  };

  await db.project3DModelSlot.create({ data: { id: SLOT_ID, companyId: COMPANY_ID, projectId: PROJECT_ID, configId: config.id, kind: "DETAIL", role: "BUILDING", slotKey: "building", displayName: "Building" } });
  await db.project3DModelVersion.create({ data: {
    id: VERSION_ID,
    companyId: COMPANY_ID,
    projectId: PROJECT_ID,
    slotId: SLOT_ID,
    version: 1,
    originalFileName: "building.glb",
    sourceStorageKey: SOURCE_KEY,
    runtimeStorageKey: RUNTIME_KEY,
    storageProvider: storageProvider().key,
    sourceSizeBytes: BigInt(bytes.length),
    runtimeSizeBytes: BigInt(bytes.length),
    sourceContentType: "model/gltf-binary",
    runtimeContentType: "model/gltf-binary",
    status: "PUBLISHED",
    validationStatus: "READY",
    sceneManifest: [],
    nodeOverrides: [],
    unitNodeNames: [],
    uploadedByUserId: platformUser.id,
    publishedByUserId: platformUser.id,
    publishedAt: new Date(),
  } });
  await db.project3DRelease.create({ data: {
    id: RELEASE_ID,
    companyId: COMPANY_ID,
    projectId: PROJECT_ID,
    configId: config.id,
    releaseNumber: 1,
    schemaVersion: 1,
    experienceSnapshot: config.authoringDocument as Prisma.InputJsonValue,
    manifest: manifest as Prisma.InputJsonValue,
    manifestHash: "e2e-release",
    status: "PUBLISHED",
    publishedByUserId: platformUser.id,
  } });
  await db.project3DConfig.update({ where: { id: config.id }, data: { activeReleaseId: RELEASE_ID } });
}

test.beforeAll(async () => {
  await removeFixture();
  const [platformUser, company] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { username: "platform-admin" }, select: { id: true } }),
    db.company.findUniqueOrThrow({ where: { id: COMPANY_ID }, select: { name: true, parentGroup: { select: { name: true } } } }),
  ]);
  groupName = company.parentGroup.name;
  companyName = company.name;
  await db.project.create({ data: { id: PROJECT_ID, companyId: COMPANY_ID, code: PROJECT_CODE, name: PROJECT_NAME, status: "ACTIVE", createdBy: platformUser.id } });
});

test.afterAll(async () => {
  await removeFixture();
  await db.$disconnect();
});

test("Platform Admin provisions the native Project 3D workspace", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: `/platform-admin/3d?q=${encodeURIComponent(PROJECT_CODE)}` });
  await expect(page.getByRole("heading", { name: "3D Experiences", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Experience" }).click();
  await expect(page.getByRole("heading", { name: "New 3D Experience" })).toBeVisible();
  await page.getByLabel("Group").selectOption({ label: groupName });
  await page.getByLabel("Company").selectOption({ label: companyName });
  await page.getByLabel("Project").selectOption({ label: `${PROJECT_CODE} · ${PROJECT_NAME}` });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Experience name")).toHaveValue(`${PROJECT_NAME} 3D Experience`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Create structure now/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Experience" }).click();
  await expect(page).toHaveURL(new RegExp(`/platform-admin/3d/projects/${PROJECT_ID}/structure$`));
  await expect(page.getByRole("heading", { level: 1, name: `${PROJECT_NAME} 3D Experience` })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "3D Experience workspace" })).toBeVisible();
});

test("Company sees only the active read-only release", async ({ page }) => {
  await publishFixture();
  await signIn(page, "OWNER", { to: `/projects/${PROJECT_ID}` });
  const launch = page.getByRole("link", { name: "View in 3D" });
  await expect(launch).toHaveAttribute("target", "_blank");
  const explorerPromise = page.waitForEvent("popup");
  await launch.click();
  const explorer = await explorerPromise;
  await expect(explorer.getByRole("heading", { level: 1, name: `${PROJECT_NAME} · 3D Explorer` })).toBeVisible();
  await expect(explorer.getByTestId("project-3d-viewer")).toBeVisible();
  await expect(explorer.getByText("Published experience · Release 1")).toBeVisible();
  await expect(explorer.getByRole("button", { name: /upload|publish|save experience|rollback/i })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_ID}$`));

  const bootstrap = await page.request.get(`/api/projects/${PROJECT_ID}/3d/bootstrap`);
  expect(bootstrap.status()).toBe(200);
  const payload = await bootstrap.json();
  expect(payload.data.models[0].asset.contentType).toBe("model/gltf-binary");
  expect(payload.data.models[0]).not.toHaveProperty("sourceStorageKey");
  expect(payload.data).not.toHaveProperty("authoringDocument");
  expect(payload.data).not.toHaveProperty("processingDiagnostics");

  const platformApi = await page.request.get("/api/platform/3d/projects");
  expect(platformApi.status()).toBe(403);
});

/* ---- The Experience Editor in its own tab (3D Editor PRD §218-§243) ---- */

const EDITOR_URL = `/platform-admin/3d/projects/${PROJECT_ID}/editor`;
const TOOLS = ["Scene", "Materials", "Environment", "Lighting", "Rendering", "Camera", "Shots", "Sections", "Performance", "Unit binding"];

async function authoring() {
  const config = await db.project3DConfig.findUniqueOrThrow({ where: { projectId: PROJECT_ID }, select: { authoringDocument: true, activeReleaseId: true } });
  const document = config.authoringDocument as { revision: number; config: Record<string, unknown> };
  return { revision: document.revision, config: document.config, activeReleaseId: config.activeReleaseId };
}

async function releasedExperience() {
  const release = await db.project3DRelease.findUniqueOrThrow({ where: { id: RELEASE_ID }, select: { manifest: true } });
  return (release.manifest as { experience: Record<string, unknown> }).experience;
}

/*
 * Scoped to a landmark: while React holds a streamed segment back (its reveal
 * hold), a hidden copy sits at the end of <body>, and text or test-id locators
 * would match both.
 */
function saveStatus(editor: Page) {
  return editor.getByRole("banner").getByTestId("editor-save-status");
}

function draftState(page: Page) {
  return page.getByRole("main").getByTestId("experience-draft-state");
}

function tool(editor: Page, name: string) {
  return editor.getByRole("navigation", { name: "Editor tools" }).getByRole("button", { name, exact: true });
}

test("Experience detail opens the editor in its own tab, with no Platform Admin shell around it", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: `/platform-admin/3d/projects/${PROJECT_ID}` });
  await expect(page.getByRole("navigation", { name: "3D Experience workspace" }).getByRole("link")).toHaveText(["Overview", "Project Structure", "Models", "Unit Binding", "Releases"]);
  const open = page.getByRole("link", { name: "Open Experience Editor" });
  await expect(open).toHaveAttribute("href", EDITOR_URL);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");

  const editorOpened = page.waitForEvent("popup");
  await open.click();
  const editor = await editorOpened;
  await expect(editor).toHaveURL(new RegExp(`${EDITOR_URL}$`));
  await expect(editor.getByRole("heading", { level: 1, name: `${PROJECT_NAME} 3D Experience` })).toBeVisible();
  await expect(editor).toHaveTitle(`${PROJECT_NAME} 3D Experience — 3D Experience Editor · NESTO`);
  await expect(editor.getByRole("banner").getByText(`${groupName} · ${companyName} · ${PROJECT_CODE}`)).toBeVisible();
  await expect(saveStatus(editor)).toHaveText("Saved");
  await expect(editor.getByRole("banner").getByText("Live: Release 1")).toBeVisible();

  // Only the editor: scene tree, viewport, properties and its tools.
  await expect(editor.getByRole("complementary", { name: "Scene" })).toBeVisible();
  await expect(editor.getByRole("main", { name: "3D viewport" })).toBeVisible();
  await expect(editor.getByRole("complementary", { name: "Properties" })).toBeVisible();
  await expect(editor.getByRole("navigation", { name: "Editor tools" }).getByRole("button")).toHaveText(TOOLS);
  await expect(editor.getByRole("navigation", { name: "Platform administration" })).toHaveCount(0);
  await expect(editor.getByRole("navigation", { name: "3D Experience workspace" })).toHaveCount(0);
  await expect(editor.getByLabel("Search NESTO Platform")).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Sign out" })).toHaveCount(0);

  // The editor fills the window, and the page itself never scrolls.
  const frame = await editor.evaluate(() => {
    const box = document.querySelector("[data-experience-editor]")!.getBoundingClientRect();
    const root = document.scrollingElement!;
    return { width: box.width, height: box.height, innerWidth, innerHeight, scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight };
  });
  expect(frame.width).toBe(frame.innerWidth);
  expect(frame.height).toBe(frame.innerHeight);
  expect(frame.scrollWidth).toBeLessThanOrEqual(frame.innerWidth);
  expect(frame.scrollHeight).toBeLessThanOrEqual(frame.innerHeight);

  // Panels collapse and resize, and the renderer's canvas follows the viewport.
  const viewport = editor.getByRole("main", { name: "3D viewport" });
  const canvas = viewport.locator("canvas").first();
  await expect(canvas).toBeAttached({ timeout: 30_000 });
  const narrow = (await viewport.boundingBox())!.width;
  await editor.getByRole("button", { name: "Hide scene panel" }).click();
  await expect.poll(async () => (await viewport.boundingBox())!.width).toBeGreaterThan(narrow + 150);
  const wide = (await viewport.boundingBox())!.width;
  await expect.poll(async () => Math.round((await canvas.boundingBox())!.width)).toBe(Math.round(wide));
  await editor.getByRole("button", { name: "Show scene panel" }).click();
  const splitter = editor.getByRole("separator", { name: "Resize properties panel" });
  await splitter.focus();
  await editor.keyboard.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", "336");

  // The management tab is still where it was.
  await expect(page).toHaveURL(new RegExp(`/platform-admin/3d/projects/${PROJECT_ID}$`));
});

test("Save keeps a draft: unsaved work is guarded, a reason is required, and the live release does not change", async ({ page, browser }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: `/platform-admin/3d/projects/${PROJECT_ID}` });
  await expect(draftState(page)).toContainText("Draft revision 1");
  const editorOpened = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open Experience Editor" }).click();
  const editor = await editorOpened;
  const status = saveStatus(editor);
  await expect(status).toHaveText("Saved");
  const released = await releasedExperience();

  await tool(editor, "Environment").click();
  await editor.getByRole("checkbox", { name: "Sky", exact: true }).click();
  await expect(status).toHaveText("Unsaved changes");

  // Closing a tab with unsaved changes asks first.
  const warning = editor.waitForEvent("dialog");
  await editor.close({ runBeforeUnload: true });
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(status).toHaveText("Unsaved changes");

  // Save needs a reason; Ctrl/Cmd+S saves from the reason field.
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByText("Give a reason for these changes before saving.")).toBeVisible();
  const reason = editor.getByLabel("Reason for this change");
  await expect(reason).toBeFocused();
  await reason.fill("Draft the sky for the next release");
  await reason.press("ControlOrMeta+s");
  await expect(status).toHaveText("Saved");

  const draft = await authoring();
  expect(draft.revision).toBe(2);
  expect(draft.config.skyEnabled).toBe(!released.skyEnabled);
  // Save is not Publish: the active release, and what it serves, are unchanged.
  expect(draft.activeReleaseId).toBe(RELEASE_ID);
  expect(await releasedExperience()).toEqual(released);
  expect(await db.project3DRelease.count({ where: { projectId: PROJECT_ID } })).toBe(1);
  const tenant = await browser.newContext();
  const tenantPage = await tenant.newPage();
  await signIn(tenantPage, "OWNER");
  const bootstrap = await tenantPage.request.get(`/api/projects/${PROJECT_ID}/3d/bootstrap`);
  expect(bootstrap.status()).toBe(200);
  expect((await bootstrap.json()).data.experience.skyEnabled).toBe(released.skyEnabled);
  await tenant.close();

  // The management tab hears about the save and reads again.
  await expect(draftState(page)).toContainText("Draft revision 2");

  // A clean tab closes without a warning.
  let warnedAgain = false;
  editor.on("dialog", (again) => { warnedAgain = true; void again.dismiss(); });
  await editor.close({ runBeforeUnload: true });
  await expect.poll(() => editor.isClosed()).toBe(true);
  expect(warnedAgain).toBe(false);
});

test("Reset defaults asks first and only changes this tab's draft", async ({ page }) => {
  // The address works on its own, in the same session.
  await signIn(page, "PLATFORM_ADMIN", { to: EDITOR_URL });
  const status = saveStatus(page);
  await expect(status).toHaveText("Saved");
  const reset = page.getByRole("button", { name: "Reset defaults" });
  const dialog = page.getByRole("dialog", { name: "Reset this Experience to default editor settings?" });

  await reset.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(status).toHaveText("Saved");

  await reset.click();
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(status).toHaveText("Unsaved changes");
  expect((await authoring()).revision).toBe(2);
});

test("A save from another tab is noticed, and the stale tab cannot overwrite it", async ({ page, context }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: EDITOR_URL });
  const second = await context.newPage();
  await second.goto(EDITOR_URL);
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(saveStatus(second)).toHaveText("Saved");
  const before = await authoring();

  await tool(second, "Environment").click();
  await second.getByRole("checkbox", { name: "Fog", exact: true }).click();
  await second.getByLabel("Reason for this change").fill("Fog from the second tab");
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await expect(saveStatus(second)).toHaveText("Saved");

  // The first tab is told at once.
  await expect(page.getByText(`This Experience was updated in another session (draft revision ${before.revision + 1}).`)).toBeVisible();

  // Saving there anyway is refused rather than silently applied.
  await tool(page, "Environment").click();
  await page.getByRole("checkbox", { name: "Clouds", exact: true }).click();
  await page.getByLabel("Reason for this change").fill("Clouds from the stale tab");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(saveStatus(page)).toHaveText("Save failed");
  const after = await authoring();
  expect(after.revision).toBe(before.revision + 1);
  expect(after.config.fogEnabled).toBe(!before.config.fogEnabled);
  expect(after.config.cloudsEnabled).toBe(before.config.cloudsEnabled);

  // Reload latest discards this tab's changes without asking twice.
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect(page.getByText(/updated in another session/)).toHaveCount(0);
  await tool(page, "Environment").click();
  await expect(page.getByRole("checkbox", { name: "Fog", exact: true })).toBeChecked({ checked: after.config.fogEnabled as boolean });
  await second.close();
});

test("A model that fails to load stays a local error with a retry", async ({ page }) => {
  const runtimeModel = `**/api/storage/objects/**/${RUNTIME_KEY.split("/").pop()}*`;
  await page.context().route(runtimeModel, (route) => route.fulfill({ status: 500, body: "" }));
  await signIn(page, "PLATFORM_ADMIN", { to: EDITOR_URL });
  const failure = page.getByRole("alert").filter({ hasText: "A model failed to load." });
  await expect(failure).toBeVisible({ timeout: 30_000 });

  // The rest of the editor keeps working.
  await tool(page, "Lighting").click();
  await page.getByRole("checkbox", { name: "Shadows", exact: true }).click();
  await expect(saveStatus(page)).toHaveText("Unsaved changes");

  await page.context().unroute(runtimeModel);
  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(failure).toHaveCount(0);
  await expect(saveStatus(page)).toHaveText("Unsaved changes");
});

test("The editor address checks access for itself", async ({ page, browser }) => {
  // Signed out: to sign in, and back here afterwards.
  await page.goto(EDITOR_URL);
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);

  // A missing Experience is a real 404, answered inside the editor frame.
  await signIn(page, "PLATFORM_ADMIN");
  const missing = await page.goto(`/platform-admin/3d/projects/missing-${Date.now()}/editor`);
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This 3D Experience does not exist." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Platform administration" })).toHaveCount(0);

  // A company session never reaches authoring, by address or by API, and is never linked to it.
  const tenant = await browser.newContext();
  const tenantPage = await tenant.newPage();
  await signIn(tenantPage, "OWNER");
  await tenantPage.goto(EDITOR_URL);
  await expect(tenantPage).not.toHaveURL(/\/editor/);
  await expect(saveStatus(tenantPage)).toHaveCount(0);
  expect((await tenantPage.request.get(`/api/platform/3d/projects/${PROJECT_ID}/config`)).status()).toBe(403);
  await tenantPage.goto(`/projects/${PROJECT_ID}`);
  await expect(tenantPage.getByRole("link", { name: "View in 3D" })).toBeVisible();
  await expect(tenantPage.locator('a[href*="/editor"]')).toHaveCount(0);
  await tenant.close();
});

test("A GLB uploaded in the editor is prepared, shown and editable, and a removed model leaves the scene", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: EDITOR_URL });
  const scene = page.getByRole("complementary", { name: "Scene" });
  const upload = scene.getByRole("region", { name: "Upload a model" });
  await upload.getByLabel("GLB file").setInputFiles({ name: "e2e-tower.glb", mimeType: "model/gltf-binary", buffer: Buffer.from(triangleGlb("E2E_Tower")) });
  await expect(upload.getByLabel("Model name")).toHaveValue("e2e-tower");
  await upload.getByLabel("Model name").fill("E2E tower");
  await upload.getByLabel("Reason").fill("Upload from the editor");
  await upload.getByRole("button", { name: "Upload GLB" }).click();

  // No worker runs here: the request that completed the upload prepares it.
  await expect(upload.getByRole("status")).toHaveText("Model ready in the scene.", { timeout: 60_000 });
  const slot = await db.project3DModelSlot.findFirstOrThrow({ where: { projectId: PROJECT_ID, displayName: "E2E tower" }, include: { versions: true } });
  expect(slot.versions).toHaveLength(1);
  expect(slot.versions[0]).toMatchObject({ status: "READY", validationStatus: "READY", originalFileName: "e2e-tower.glb" });
  await expect(scene.getByRole("button", { name: /v1 · e2e-tower\.glb/ })).toHaveAttribute("aria-pressed", "true");
  await expect(scene.getByRole("button", { name: "E2E_Tower", exact: true })).toBeVisible();

  // Selected once ready, and its settings save like any other model's.
  const positionX = page.getByRole("complementary", { name: "Properties" }).getByLabel("Position X");
  await expect(positionX).toBeEnabled();
  await positionX.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByLabel("Reason for this change").fill("Move the uploaded tower");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(saveStatus(page)).toHaveText("Saved");
  await expect.poll(async () => (await db.project3DModelVersion.findUniqueOrThrow({ where: { id: slot.versions[0].id } })).positionX).toBe(0.5);

  await scene.getByRole("button", { name: "Remove E2E tower" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove E2E tower?" });
  await dialog.getByLabel("Reason").fill("Only an upload check");
  await dialog.getByRole("button", { name: "Remove model" }).click();
  await expect(scene.getByRole("button", { name: "Remove E2E tower" })).toHaveCount(0);
  await expect(db.project3DModelSlot.findUniqueOrThrow({ where: { id: slot.id } })).resolves.toMatchObject({ isActive: false });
});
