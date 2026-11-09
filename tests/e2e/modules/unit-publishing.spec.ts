import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { createSpareProject, removeSpareProject, STRUCTURE_SEED } from "../structure-fixtures";

/**
 * The unit page and publishing, desktop (E-05D §107-§115; units publish on
 * create, 2026-11): the Architect adds a unit and it is published at once,
 * incomplete as it is; the Sales Plan, the first image and an edit each go out
 * as the next version while the earlier ones keep their values. Sales reads the
 * same page with nothing to change; the Architecture head archives the unit and
 * restores it. Nobody submits, publishes or sends anything back.
 *
 * Built on a building of its own on a spare Aurelia project the Architect is on,
 * removed again afterwards with everything publishing left behind.
 */

/** A bare Aurelia project of the spec's own (see createSpareProject). */
const PROJECT = "project_e2e_harbour_05d";
const BUILDING = "bld_e05d_e2e";
const FLOOR = "flr_e05d_e2e_2";
const CODE = "H-201";

test.describe.configure({ mode: "serial" });

let unitId = "";

async function clear() {
  const units = (await db.projectUnit.findMany({ where: { floorId: FLOOR }, select: { id: true } })).map((unit) => unit.id);
  await db.unitPublicationApproval.deleteMany({ where: { recordId: { in: units } } });
  await db.unitMedia.deleteMany({ where: { unitId: { in: units } } });
  await db.unitDocumentLink.deleteMany({ where: { unitId: { in: units } } });
  await db.projectUnit.updateMany({ where: { id: { in: units } }, data: { currentPublicationId: null, salesPlanDocumentId: null } });
  await db.unitPublication.deleteMany({ where: { unitId: { in: units } } });
  const files = await db.document.findMany({ where: { entityType: "project_unit", entityId: { in: units } }, select: { id: true } });
  const fileIds = files.map((file) => file.id);
  await db.documentUploadSession.deleteMany({ where: { documentId: { in: fileIds } } });
  await db.document.updateMany({ where: { id: { in: fileIds } }, data: { currentVersionId: null } });
  await db.documentVersion.deleteMany({ where: { documentId: { in: fileIds } } });
  await db.document.deleteMany({ where: { id: { in: fileIds } } });
  await db.attentionItem.deleteMany({ where: { entityId: { in: units } } });
  await db.notification.deleteMany({ where: { entityId: { in: units } } });
  await db.notificationEventOutbox.deleteMany({ where: { entityId: { in: units } } });
  await db.activity.deleteMany({ where: { entityId: { in: [...units, FLOOR, BUILDING] } } });
  await db.projectUnit.deleteMany({ where: { id: { in: units } } });
  await db.projectFloor.deleteMany({ where: { id: FLOOR } });
  await db.projectBuilding.deleteMany({ where: { id: BUILDING } });
}

test.beforeAll(async () => {
  await createSpareProject(PROJECT, "A-E2E-05D", "Harbour Residences 05D");
  await clear();
  await db.projectBuilding.create({ data: { id: BUILDING, companyId: "company_demo_a", projectId: PROJECT, name: "E05D Harbour", nameKey: "E05D HARBOUR", sortOrder: 99, createdBy: "seed" } });
  await db.projectFloor.create({ data: { id: FLOOR, companyId: "company_demo_a", projectId: PROJECT, buildingId: BUILDING, levelType: "STANDARD", number: 2, name: "Floor 2", floorKey: "STANDARD:2", sortOrder: 1, createdBy: "seed" } });
});

test.afterAll(async () => {
  await clear();
  await removeSpareProject(PROJECT);
  await db.$disconnect();
});

const unitUrl = (section = "") => `/projects/${PROJECT}/units/${unitId}${section}`;
const status = (page: Page) => page.getByTestId("publication-status").first();
/** The unit's own sections, never the project's tabs of the same name. */
const section = (page: Page, name: string) => page.getByRole("navigation", { name: `${CODE} sections` }).getByRole("link", { name, exact: true });
const RETIRED = ["Submit for Publishing", "Submit changes", "Publish", "Publish changes", "Revision Required", "Return changes"];

test("a unit the Architect adds is published at once, incomplete as it is", async ({ page }) => {
  await signIn(page, "ARCHITECT", { to: `/projects/${PROJECT}/units` });
  const apartment = await db.projectUnitType.findFirstOrThrow({ where: { companyId: "company_demo_a", code: "APARTMENT" }, select: { id: true } });
  // The same request the Add unit dialog sends.
  const created = await page.request.post(`/api/project-floors/${FLOOR}/units`, { data: { unitCode: CODE, unitTypeId: apartment.id, saleableArea: "96.40", internalArea: "81.20", bedrooms: 2, bathrooms: 1, rooms: 3, orientation: "S", position: "CORNER" } });
  expect(created.status()).toBe(201);
  unitId = ((await created.json()) as { data: { id: string } }).data.id;

  await page.goto(unitUrl());
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(CODE);
  await expect(status(page)).toHaveText("Published v1");
  // The checklist says what a complete listing still lacks, and blocks nothing.
  const readiness = mainRegion(page).getByTestId("readiness-panel");
  await expect(readiness).toContainText("Upload the Sales Plan PDF.");
  await expect(readiness).toContainText("For information only");
  for (const name of RETIRED) await expect(mainRegion(page).getByRole("button", { name, exact: true })).toHaveCount(0);

  await section(page, "Publishing").click();
  await expect(mainRegion(page).getByTestId("publication-history")).toContainText("v1 Published");
  await expect(mainRegion(page).getByTestId("publishing-state")).toContainText("Every saved change to this unit is published at once");
});

test("the Sales Plan, the first image and an edit each go out as the next version; earlier ones keep their values", async ({ page }) => {
  await signIn(page, "ARCHITECT", { to: unitUrl("/documents") });

  // The Sales Plan: one canonical document, uploaded to the unit (§33).
  await mainRegion(page).getByTestId("sales-plan-input").setInputFiles({ name: "H-201 sales plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nH-201\n%%EOF\n") });
  await expect(page.getByTestId("sales-plan")).toContainText("v1", { timeout: 20_000 });
  await expect(status(page)).toHaveText("Published v2");

  // An image, which becomes primary as the first (§42).
  await section(page, "Media").click();
  const image = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 130, b: 160 } } }).png().toBuffer();
  await page.getByTestId("unit-media-input").setInputFiles({ name: "living-room.png", mimeType: "image/png", buffer: image });
  await expect(page.getByTestId("unit-media-item").first()).toHaveAttribute("data-primary", "true", { timeout: 20_000 });
  await page.reload();
  await expect(status(page)).toHaveText("Published v3");

  // Change the saleable area: it is published as version 4 on save, and version 3 keeps 96.40 (§27, §111).
  await section(page, "Overview").click();
  await mainRegion(page).getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit ${CODE}` });
  await dialog.getByLabel("Saleable area").fill("98.10");
  await dialog.getByRole("button", { name: "Save unit" }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page)).toHaveText("Published v4");

  await section(page, "Publishing").click();
  const history = mainRegion(page).getByTestId("publication-history");
  await expect(history.getByRole("listitem")).toHaveCount(4);
  await history.getByRole("link", { name: "v3 Published" }).click();
  await expect(page.getByTestId("publication-detail")).toContainText("96.40 m²");
  const latest = await db.unitPublication.findFirstOrThrow({ where: { unitId, versionNumber: 4 }, select: { snapshot: true } });
  expect((latest.snapshot as { areas: { saleableArea: string } }).areas.saleableArea).toBe("98.10");
});

test("Sales reads the published unit with nothing to change", async ({ page }) => {
  await signIn(page, "SALES", { to: unitUrl() });
  await expect(status(page)).toHaveText("Published v4");
  for (const name of [...RETIRED, "Edit"]) await expect(mainRegion(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(mainRegion(page).getByTestId("entity-actions")).toHaveCount(0);
  await section(page, "Documents").click();
  await expect(page.getByTestId("sales-plan")).toContainText("H-201 Sales Plan");
  await expect(page.getByRole("button", { name: "Upload new version" })).toHaveCount(0);
});

test("the Architecture head archives the unit and restores it published", async ({ page }) => {
  await signIn(page, "ARCHITECTURE_HEAD", { to: unitUrl() });
  await mainRegion(page).getByRole("button", { name: `More actions for ${CODE}` }).first().click();
  await expect(page.getByRole("menuitem", { name: "Unpublish" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("dialog", { name: `Archive ${CODE}?` }).getByRole("button", { name: "Archive" }).click();
  await expect(status(page)).toHaveText("Archived");

  await mainRegion(page).getByRole("button", { name: `More actions for ${CODE}` }).first().click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await page.getByRole("dialog", { name: `Restore ${CODE}?` }).getByRole("button", { name: "Restore" }).click();
  await expect(status(page)).toHaveText("Published v4");
});

test("every seeded unit is published, and the list filters by Published or Archived", async ({ page }) => {
  await signIn(page, "ARCHITECTURE_HEAD", { to: `/projects/${STRUCTURE_SEED.riverside}/units?floor=${STRUCTURE_SEED.floors.a1}` });
  // Scoped to main: a streamed page briefly keeps a hidden copy of itself outside it (React Suspense reveal).
  const rows = mainRegion(page).getByTestId("unit-table").getByTestId("unit-row");
  await expect(rows.filter({ hasText: "A-101" })).toContainText("Published v1");
  for (const code of ["A-102", "A-103", "A-104"]) await expect(rows.filter({ hasText: code })).toContainText("Published v");
  await expect(mainRegion(page).getByTestId("unit-table")).not.toContainText(/Ready for Publishing|Revision Required|Draft|Changed/);
  // An old link's retired filter is ignored, not an error.
  await page.goto(`/projects/${STRUCTURE_SEED.riverside}/units?floor=${STRUCTURE_SEED.floors.a1}&unpublishedChanges=true&publicationStatus=DRAFT`);
  await expect(mainRegion(page).getByTestId("unit-table").getByTestId("unit-row").filter({ hasText: "A-101" })).toBeVisible();
});
