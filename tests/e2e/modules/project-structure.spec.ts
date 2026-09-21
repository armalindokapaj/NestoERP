import { expect, test, type Page } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";
import { removeStructure, STRUCTURE_SEED } from "../structure-fixtures";

/**
 * Project structure, desktop (E-05B §135-§140, §145): the project manager sets
 * up an empty project — a building, floors by range, units by code pattern, a
 * copied floor — opens a unit, changes its code and moves it, and a duplicate
 * batch is stopped before anything is written. Sales reads units without a
 * single action; a unit of another company's project is not found.
 */

const PROJECT = STRUCTURE_SEED.emptyProject;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await removeStructure([PROJECT]);
});

test.afterAll(async () => {
  await removeStructure([PROJECT]);
  await db.$disconnect();
});

const tree = (page: Page) => page.getByTestId("structure-tree");
const heading = (page: Page) => page.getByTestId("structure-heading");

async function chooseFloor(page: Page, name: string) {
  await tree(page).getByTestId("tree-floor").filter({ hasText: new RegExp(`^${name}\\s*\\d+$`) }).click();
  await expect(heading(page)).toHaveText(`${name} — Tower`);
}

async function bulkAdd(page: Page, prefix: string, start: string, end: string) {
  await mainRegion(page).getByRole("button", { name: "Bulk add", exact: false }).first().click();
  const dialog = page.getByRole("dialog", { name: "Bulk add units" });
  await dialog.getByLabel("Prefix").fill(prefix);
  await dialog.getByLabel(/^Start/).fill(start);
  await dialog.getByLabel(/^End/).fill(end);
  await dialog.getByLabel(/^Digits/).fill("0");
  await expect(dialog.getByTestId("bulk-code-sample")).toContainText(`${prefix}${start}`);
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByLabel(/^Type/)).toHaveValue(/.+/);
  return dialog;
}

test("the project manager sets up a project's buildings, floors and units", async ({ page }) => {
  // Central Office Tower is Meridian's, run by Meridian's project manager (E-06 §45).
  await signIn(page, "PM_B", { to: `/projects/${PROJECT}/units` });
  // Scoped to the main region: the page streams, and for a moment React's parked copy is in the document too (see mainRegion).
  await expect(mainRegion(page).getByTestId("structure-empty")).toContainText("Set up project structure");

  // A building (§35) — the page moves onto it.
  await mainRegion(page).getByTestId("structure-empty").getByRole("button", { name: "Add building" }).click();
  const buildingDialog = page.getByRole("dialog", { name: "Add building" });
  await buildingDialog.getByLabel(/^Name/).fill("Tower");
  await buildingDialog.getByLabel(/^Code/).fill("T");
  await buildingDialog.getByRole("button", { name: "Add building" }).click();
  await expect(heading(page)).toHaveText("Tower");
  await expect(page.getByTestId("building-empty")).toContainText("Add floors to Tower.");

  // Floors by range, named and reviewed before they are created (§37, §38).
  await page.getByTestId("building-empty").getByRole("button", { name: "Create floors" }).click();
  const floors = page.getByRole("dialog", { name: "Create floors" });
  await floors.getByLabel(/^From floor/).fill("-1");
  await floors.getByLabel(/^To floor/).fill("3");
  await floors.getByRole("button", { name: "Preview names" }).click();
  const preview = floors.getByTestId("bulk-floor-preview");
  await expect(preview.getByRole("listitem")).toHaveCount(5);
  await expect(preview.getByLabel("Name of floor -1")).toHaveValue("Basement 1");
  await expect(preview.getByLabel("Name of floor 0")).toHaveValue("Ground Floor");
  await floors.getByRole("button", { name: "Create 5 floors" }).click();
  await expect(floors).toBeHidden();
  await expect(tree(page).getByTestId("tree-floor")).toHaveText([/Basement 1/, /Ground Floor/, /Floor 1/, /Floor 2/, /Floor 3/]);

  // Units by code pattern with shared details (§41-§43).
  await chooseFloor(page, "Floor 1");
  await expect(page.getByTestId("floor-empty")).toBeVisible();
  const bulk = await bulkAdd(page, "T-", "101", "104");
  await bulk.getByLabel("Bedrooms").fill("2");
  await bulk.getByLabel("Internal area").fill("80.5");
  await bulk.getByRole("button", { name: "Preview" }).click();
  await expect(bulk.getByTestId("bulk-unit-preview").getByRole("listitem")).toHaveCount(4);
  await bulk.getByRole("button", { name: "Create 4 units" }).click();
  await expect(bulk).toBeHidden();
  const rows = page.getByTestId("unit-table").getByTestId("unit-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("80.50 m²");

  // Copy the floor: new units, codes moved to the new floor number (§98).
  await chooseFloor(page, "Floor 2");
  await page.getByTestId("floor-empty").getByRole("button", { name: "Copy a floor" }).click();
  const copy = page.getByRole("dialog", { name: "Copy units to Floor 2" });
  await copy.getByLabel(/^Copy from/).selectOption({ label: "Floor 1 · 4 units" });
  await expect(copy.getByLabel("New code for T-101")).toHaveValue("T-201");
  await copy.getByRole("button", { name: "Copy 4 units" }).click();
  await expect(copy).toBeHidden();
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toHaveAttribute("data-unit-code", "T-201");

  // A duplicate batch is caught in the preview and cannot be created (§44).
  await chooseFloor(page, "Floor 3");
  const duplicate = await bulkAdd(page, "t-", "101", "102");
  await duplicate.getByRole("button", { name: "Preview" }).click();
  await expect(duplicate.getByTestId("bulk-unit-preview")).toContainText("exists");
  await expect(duplicate.getByRole("button", { name: "Create 2 units" })).toBeDisabled();
  await duplicate.getByRole("button", { name: "Close" }).click();

  // The unit page: a new code and a new floor, the same unit (§52, §55, §83).
  await chooseFloor(page, "Floor 2");
  await page.getByTestId("unit-table").getByRole("link", { name: "T-201" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("T-201");
  const unitUrl = page.url();
  await expect(page.getByTestId("unit-location")).toContainText("Tower · Floor 2");

  await mainRegion(page).getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit T-201" });
  await edit.getByLabel(/^Unit code/).fill("T-201A");
  await edit.getByRole("button", { name: "Save unit" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("T-201A");
  expect(page.url()).toBe(unitUrl);

  await mainRegion(page).getByRole("button", { name: "Move" }).click();
  const move = page.getByRole("dialog", { name: "Move T-201A" });
  await move.getByLabel(/^Floor/).selectOption({ label: "Floor 3" });
  await move.getByRole("button", { name: "Move unit" }).click();
  await expect(page.getByTestId("unit-location")).toContainText("Tower · Floor 3");
  expect(page.url()).toBe(unitUrl);

  // Each level of the breadcrumb goes back to the structure there (§102).
  await page.getByRole("navigation", { name: /breadcrumb/i }).getByRole("link", { name: "Floor 3" }).click();
  await expect(heading(page)).toHaveText("Floor 3 — Tower");
  await expect(page.getByTestId("unit-table").getByTestId("unit-row")).toHaveCount(1);

  const unitId = unitUrl.split("/").pop()!;
  const unit = await db.projectUnit.findUniqueOrThrow({ where: { id: unitId }, select: { unitCode: true, floor: { select: { name: true } } } });
  expect(unit).toEqual({ unitCode: "T-201A", floor: { name: "Floor 3" } });
});

test("sales reads the units without changing them (§80)", async ({ page }) => {
  await signIn(page, "SALES", { to: `/projects/${STRUCTURE_SEED.riverside}/units?floor=${STRUCTURE_SEED.floors.a1}` });
  await expect(heading(page)).toHaveText("Floor 1 — Block A");
  await expect(page.getByTestId("unit-table").getByTestId("unit-row")).toHaveCount(4);
  await expect(mainRegion(page).getByRole("button", { name: "Add unit" })).toHaveCount(0);
  await expect(mainRegion(page).getByRole("button", { name: /^Actions for/ })).toHaveCount(0);

  await page.getByTestId("unit-table").getByRole("link", { name: "A-104" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A-104");
  await expect(mainRegion(page).getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("filters the project's units in the database (§48, §49)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${STRUCTURE_SEED.riverside}/units` });
  await expect(heading(page)).toHaveText("All units");
  await mainRegion(page).getByRole("button", { name: /^Filters/ }).click();
  const filters = page.getByTestId("unit-filters");
  await filters.getByLabel("Saleable area (m²) from").fill("140");
  await filters.getByLabel("Saleable area (m²) from").press("Enter");
  await expect(mainRegion(page).getByText("24 results")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search units" }).fill("B-8");
  await expect(mainRegion(page).getByText("1 result")).toBeVisible();
  await expect(page.getByTestId("unit-table").getByTestId("unit-row")).toHaveAttribute("data-unit-code", "B-804");
  await expect(page).toHaveURL(/saleableAreaMin=140/);
});

test("a unit of another company is not found under this project (§82)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER");
  const response = await page.goto(`/projects/${STRUCTURE_SEED.riverside}/units/${STRUCTURE_SEED.units.munichOffice1}`);
  expect(response?.status()).toBe(404);
  const wrongProject = await page.goto(`/projects/project_c/units/${STRUCTURE_SEED.units.a101}`);
  expect(wrongProject?.status()).toBe(404);
});
