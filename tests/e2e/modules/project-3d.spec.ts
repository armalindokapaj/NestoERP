import { Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";

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

async function removeFixture() {
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
