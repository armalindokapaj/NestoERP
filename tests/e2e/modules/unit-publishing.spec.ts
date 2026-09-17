import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { STRUCTURE_SEED } from "../structure-fixtures";

/**
 * The unit page and publishing, desktop (E-05D §107-§115, §119, §120): the
 * Architect uploads a unit's Sales Plan and an image, sees it become ready and
 * submits it; the Architecture Manager publishes it; an edit afterwards shows as
 * unpublished changes. Sales reads the same page with nothing to change, and a
 * publisher pressing Publish on an incomplete unit is told what is missing.
 *
 * Built on a building of its own on Marina Apartments (the Architect's project),
 * removed again afterwards with everything publishing left behind.
 */

const MARINA = "project_c";
const BUILDING = "bld_e05d_e2e";
const FLOOR = "flr_e05d_e2e_2";
const READY = "unit_e05d_e2e_201";
const EMPTY = "unit_e05d_e2e_202";

test.describe.configure({ mode: "serial" });

async function clear() {
  const units = [READY, EMPTY];
  await db.unitPublicationApproval.deleteMany({ where: { recordId: { in: units } } });
  await db.unitMedia.deleteMany({ where: { unitId: { in: units } } });
  await db.unitDocumentLink.deleteMany({ where: { unitId: { in: units } } });
  await db.projectUnit.updateMany({ where: { id: { in: units } }, data: { currentPublicationId: null, salesPlanDocumentId: null } });
  await db.unitPublication.deleteMany({ where: { unitId: { in: units } } });
  const files = await db.document.findMany({ where: { entityType: "project_unit", entityId: { in: units } }, select: { id: true } });
  const fileIds = files.map((file) => file.id);
  await db.documentUploadSession.deleteMany({ where: { documentId: { in: fileIds } } });
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
  await clear();
  const apartment = await db.projectUnitType.findFirstOrThrow({ where: { companyId: "company_demo_a", code: "APARTMENT" }, select: { id: true } });
  await db.projectBuilding.create({ data: { id: BUILDING, companyId: "company_demo_a", projectId: MARINA, name: "E05D Harbour", nameKey: "E05D HARBOUR", sortOrder: 99, createdBy: "seed" } });
  await db.projectFloor.create({ data: { id: FLOOR, companyId: "company_demo_a", projectId: MARINA, buildingId: BUILDING, levelType: "STANDARD", number: 2, name: "Floor 2", floorKey: "STANDARD:2", sortOrder: 1, createdBy: "seed" } });
  const complete = { saleableArea: "96.40", internalArea: "81.20", bedrooms: 2, bathrooms: 1, rooms: 3, orientation: "S" as const, position: "CORNER" as const };
  await db.projectUnit.createMany({
    data: [
      { id: READY, companyId: "company_demo_a", projectId: MARINA, floorId: FLOOR, unitCode: "H-201", unitCodeKey: "H-201", unitTypeId: apartment.id, sortOrder: 1, createdBy: "seed", ...complete },
      { id: EMPTY, companyId: "company_demo_a", projectId: MARINA, floorId: FLOOR, unitCode: "H-202", unitCodeKey: "H-202", unitTypeId: apartment.id, sortOrder: 2, createdBy: "seed", ...complete },
    ],
  });
});

test.afterAll(async () => {
  await clear();
  await db.$disconnect();
});

const unitUrl = (unitId: string, section = "") => `/projects/${MARINA}/units/${unitId}${section}`;
const status = (page: Page) => page.getByTestId("publication-status").first();
/** The unit's own sections, never the project's tabs of the same name. */
const section = (page: Page, code: string, name: string) => page.getByRole("navigation", { name: `${code} sections` }).getByRole("link", { name, exact: true });

test("the Architect prepares a unit and submits it; nothing publishes it but a publisher", async ({ page }) => {
  await signIn(page, "ARCHITECT", { to: unitUrl(READY) });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("H-201");
  await expect(status(page)).toHaveText("Draft");
  const readiness = page.getByTestId("readiness-panel");
  await expect(readiness).toContainText("Upload the Sales Plan PDF.");
  await expect(mainRegion(page).getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);

  // The Sales Plan: one canonical document, uploaded to the unit (§33).
  await section(page, "H-201", "Documents").click();
  await page.getByTestId("sales-plan-input").setInputFiles({ name: "H-201 sales plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nH-201\n%%EOF\n") });
  await expect(page.getByTestId("sales-plan")).toContainText("v1", { timeout: 20_000 });

  // An image, which becomes primary as the first (§42).
  await section(page, "H-201", "Media").click();
  const image = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 130, b: 160 } } }).png().toBuffer();
  await page.getByTestId("unit-media-input").setInputFiles({ name: "living-room.png", mimeType: "image/png", buffer: image });
  await expect(page.getByTestId("unit-media-item").first()).toHaveAttribute("data-primary", "true", { timeout: 20_000 });

  await section(page, "H-201", "Overview").click();
  await expect(page.getByTestId("readiness-panel")).toContainText(/(\d+) \/ \1 required items complete/);
  await mainRegion(page).getByRole("button", { name: "Submit for Publishing" }).click();
  await expect(status(page)).toHaveText("Ready for Publishing");
  await expect(mainRegion(page).getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
});

test("the Architecture Manager publishes it, and a later edit shows as unpublished changes", async ({ page }) => {
  await signIn(page, "ARCHITECTURE_MANAGER", { to: unitUrl(READY, "/publishing") });
  await expect(page.getByTestId("publishing-state")).toContainText("Submitted by");
  await mainRegion(page).getByRole("button", { name: "Publish", exact: true }).click();
  await expect(status(page)).toHaveText("Published v1");
  await expect(page.getByTestId("publication-history")).toContainText("v1 Published");
  await expect(page.getByTestId("publication-history")).toContainText("Current");

  // The published version is a snapshot: open it.
  await page.getByTestId("publication-history").getByRole("link", { name: "v1 Published" }).click();
  await expect(page.getByTestId("publication-detail")).toContainText("96.40 m²");

  // Change the saleable area; version 1 stays as it was (§27, §111).
  await page.goto(unitUrl(READY));
  await mainRegion(page).getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit H-201" });
  await dialog.getByLabel("Saleable area").fill("98.10");
  await dialog.getByRole("button", { name: "Save unit" }).click();
  await expect(page.getByTestId("unpublished-changes")).toBeVisible();
  const published = await db.unitPublication.findFirstOrThrow({ where: { unitId: READY, versionNumber: 1 }, select: { snapshot: true } });
  expect((published.snapshot as { areas: { saleableArea: string } }).areas.saleableArea).toBe("96.40");
});

test("Sales reads the published unit with nothing to change", async ({ page }) => {
  await signIn(page, "SALES", { to: unitUrl(READY) });
  await expect(status(page)).toHaveText("Published v1");
  for (const name of ["Submit for Publishing", "Submit changes", "Publish", "Publish changes", "Edit"]) {
    await expect(mainRegion(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await section(page, "H-201", "Documents").click();
  await expect(page.getByTestId("sales-plan")).toContainText("H-201 Sales Plan");
  await expect(page.getByRole("button", { name: "Upload new version" })).toHaveCount(0);
});

test("a publisher is told what an incomplete unit is missing instead of a dead button", async ({ page }) => {
  await signIn(page, "ARCHITECTURE_MANAGER", { to: unitUrl(EMPTY) });
  await mainRegion(page).getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByTestId("not-ready-dialog");
  await expect(dialog).toContainText("H-202 cannot be published yet");
  await expect(dialog).toContainText("Sales Plan");
  await expect(dialog).toContainText("Primary image");
});

test("the seeded units show every publishing state in the unit list", async ({ page }) => {
  await signIn(page, "ARCHITECTURE_MANAGER", { to: `/projects/${STRUCTURE_SEED.riverside}/units?floor=${STRUCTURE_SEED.floors.a1}` });
  const rows = page.getByTestId("unit-table").getByTestId("unit-row");
  await expect(rows.filter({ hasText: "A-101" })).toContainText("Published v1");
  await expect(rows.filter({ hasText: "A-102" })).toContainText("Changed");
  await expect(rows.filter({ hasText: "A-103" })).toContainText("Ready for Publishing");
  await expect(rows.filter({ hasText: "A-104" })).toContainText("Revision Required");
});
