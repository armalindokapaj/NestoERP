import { expect, test, type Page } from "../pw";

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
// Scoped to main: a streamed page briefly keeps a hidden copy of itself outside it (React Suspense reveal).
const heading = (page: Page) => mainRegion(page).getByTestId("structure-heading");

/** Floors without units fold behind one "N empty floors" row per building (2026-11-09): opens it when it is closed. */
async function openEmptyFloors(page: Page) {
  const fold = tree(page).getByTestId("tree-empty-floors");
  if ((await fold.count()) && (await fold.first().getAttribute("aria-expanded")) === "false") await fold.first().click();
}

async function chooseFloor(page: Page, name: string) {
  await openEmptyFloors(page);
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
  await preview.getByLabel("Name of floor 0").fill("Lobby");
  await floors.getByRole("button", { name: "Create 5 floors" }).click();
  await expect(floors).toBeHidden();
  // None has units yet, so all five fold behind one row until it is opened.
  await expect(tree(page).getByTestId("tree-empty-floors")).toHaveText(/5 empty floors/);
  await expect(tree(page).getByTestId("tree-floor")).toHaveCount(0);
  await openEmptyFloors(page);
  await expect(tree(page).getByTestId("tree-floor")).toHaveText([/Basement 1/, /Lobby/, /Floor 1/, /Floor 2/, /Floor 3/]);

  // A wider range over floors the building already has: they join the review instead of stopping it.
  // With floors in place the main button is Add units; a range of floors is in the building's menu.
  await expect(mainRegion(page).getByTestId("add-units")).toBeVisible();
  await mainRegion(page).getByRole("button", { name: "More actions for Tower" }).click();
  await page.getByRole("menuitem", { name: "Create floors by range" }).click();
  const wider = page.getByRole("dialog", { name: "Create floors" });
  await wider.getByLabel(/^From floor/).fill("-2");
  await wider.getByLabel(/^To floor/).fill("5");
  await wider.getByRole("button", { name: "Preview names" }).click();
  const review = wider.getByTestId("bulk-floor-preview");
  await expect(review.locator('li[data-state="existing"]')).toHaveCount(5);
  await expect(review.locator('li[data-state="new"]')).toHaveCount(3);
  await expect(wider.getByTestId("bulk-floor-summary")).toContainText("3 new · 5 already exist · 1 named differently");
  // Existing floors are kept by default; the ground floor's own name differs, so it offers the range's name.
  await expect(wider.getByRole("button", { name: "Create 3 floors" })).toBeEnabled();
  await review.getByLabel("Name of existing floor 0").selectOption("rename");
  await expect(review.getByLabel("Name of floor 0")).toHaveValue("Ground Floor");
  await review.getByLabel("Create floor 5").uncheck();
  await wider.getByRole("button", { name: "Create 2 floors · update 1" }).click();
  await expect(wider).toBeHidden();
  await openEmptyFloors(page);
  await expect(tree(page).getByTestId("tree-floor")).toHaveText([/Basement 2/, /Basement 1/, /Ground Floor/, /Floor 1/, /Floor 2/, /Floor 3/, /Floor 4/]);

  // Units by code pattern with shared details (§41-§43).
  await chooseFloor(page, "Floor 1");
  await expect(page.getByTestId("floor-empty")).toBeVisible();
  const bulk = await bulkAdd(page, "T-", "101", "104");
  await bulk.getByLabel("Bedrooms").selectOption("2");
  await bulk.getByLabel("Internal area").fill("80.5");
  await bulk.getByRole("button", { name: "Preview" }).click();
  await expect(bulk.getByTestId("bulk-unit-preview").getByRole("listitem")).toHaveCount(4);
  await bulk.getByRole("button", { name: "Create 4 units" }).click();
  await expect(bulk).toBeHidden();
  const rows = page.getByTestId("unit-table").getByTestId("unit-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("80.50 m²");
  // Floor 1 has units now: it leaves the fold, which counts the six floors still empty.
  await expect(tree(page).getByTestId("tree-empty-floors")).toHaveText(/6 empty floors/);

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
  // The typed batch is unsaved input: closing asks first, and Discard lets it go (AUD-03).
  await page.getByTestId("unsaved-prompt").getByTestId("unsaved-discard").click();
  await expect(duplicate).toBeHidden();

  // Add units asks where first, filled in from the floor chosen in the tree, then opens the unit form there (2026-11-09).
  await mainRegion(page).getByTestId("add-units").click();
  const where = page.getByTestId("add-units-dialog");
  await expect(where.getByLabel(/^Building/)).toContainText("Tower");
  await expect(where.getByLabel(/^Floor/)).toContainText("Floor 3");
  await where.getByText("One unit").click();
  await where.getByTestId("add-units-continue").click();
  const one = page.getByRole("dialog", { name: "Add unit" });
  await expect(one).toContainText("Tower · Floor 3");
  // The building's code shows before the unit's own.
  await expect(one.getByTestId("unit-code-prefix")).toHaveText("T-");
  await one.getByRole("button", { name: "Cancel" }).click();
  await expect(one).toBeHidden();

  // The unit page: a new code and a new floor, the same unit (§52, §55, §83).
  // A row opens the unit in the side panel (2026-11-09); its Open full page goes on to the unit page.
  await chooseFloor(page, "Floor 2");
  await page.getByTestId("unit-table").getByRole("link", { name: "T-201" }).click();
  const panel = page.getByTestId("unit-panel");
  await expect(panel.getByTestId("unit-panel-title")).toContainText("T-201");
  await panel.getByTestId("unit-panel-open-page").click();
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

test("the project manager ticks units and changes them together (2026-11-09)", async ({ page }) => {
  await signIn(page, "PM_B", { to: `/projects/${PROJECT}/units` });
  await chooseFloor(page, "Floor 1");
  const rows = page.getByTestId("unit-table").getByTestId("unit-row");
  await expect(rows).toHaveCount(4);

  // The header tick takes the page; the bar says how many and offers what this person may change.
  await mainRegion(page).getByTestId("unit-tick-page").click();
  const bar = mainRegion(page).getByTestId("unit-selection-bar");
  await expect(bar.getByTestId("unit-selection-count")).toHaveText("4 units selected");
  await expect(bar.getByTestId("bulk-details")).toBeVisible();
  await expect(bar.getByTestId("bulk-move")).toBeVisible();

  // Edit details: only the fields touched change, on every ticked unit; each saves its own new version.
  await bar.getByTestId("bulk-details").click();
  const details = page.getByRole("dialog", { name: "Edit 4 units" });
  await details.getByLabel("Bedrooms").selectOption("3");
  await details.getByTestId("bulk-details-apply").click();
  await expect(details).toBeHidden();
  await expect(rows.first()).toContainText("3");
  const edited = await db.projectUnit.findMany({ where: { projectId: PROJECT, unitCode: { in: ["T-101", "T-102", "T-103", "T-104"] } }, select: { bedrooms: true, internalArea: true } });
  expect(edited.map((unit) => [unit.bedrooms, unit.internalArea?.toFixed(2)])).toEqual(Array(4).fill([3, "80.50"]));
  // The ticks stay for the next change; Escape clears them.
  await expect(bar.getByTestId("unit-selection-count")).toHaveText("4 units selected");
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();

  // Two ticked units move to another floor together.
  await rows.filter({ hasText: "T-103" }).getByTestId("unit-tick").click();
  await rows.filter({ hasText: "T-104" }).getByTestId("unit-tick").click();
  await bar.getByTestId("bulk-move").click();
  const move = page.getByRole("dialog", { name: "Move 2 units" });
  await move.getByLabel(/^Floor/).selectOption({ label: "Floor 4" });
  await move.getByTestId("bulk-move-apply").click();
  await expect(move).toBeHidden();
  await expect(rows).toHaveCount(2);
  await expect(bar).toBeHidden();
});

test("a row opens the unit in the side panel, which steps through the list and saves its details (2026-11-09)", async ({ page }) => {
  await signIn(page, "PM_B", { to: `/projects/${PROJECT}/units` });
  await chooseFloor(page, "Floor 1");
  const rows = page.getByTestId("unit-table").getByTestId("unit-row");
  await expect(rows).toHaveCount(2);
  const panel = page.getByTestId("unit-panel");

  // A click anywhere on the row opens the panel over the list; the address names the unit.
  await rows.first().getByRole("cell").nth(2).click();
  await expect(panel.getByTestId("unit-panel-title")).toContainText("T-101");
  await expect(panel.getByTestId("unit-panel-position")).toHaveText("1 of 2");
  await expect(page).toHaveURL(/[?&]unit=/);
  await expect(page.getByTestId("unit-table")).toBeAttached();

  // Next and Previous step through the list as shown, by button and by Alt+↓ / Alt+↑.
  await panel.getByTestId("unit-panel-next").click();
  await expect(panel.getByTestId("unit-panel-title")).toContainText("T-102");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(panel.getByTestId("unit-panel-title")).toContainText("T-101");

  // The details are the Edit unit dialog's fields; net and gross are worked out as they are typed.
  await panel.getByLabel("Bedrooms").selectOption("1");
  await panel.locator("#panel-balconyArea").fill("4.5");
  await expect(panel.getByTestId("panel-grossArea-sum")).toHaveValue("85.00");
  await panel.getByTestId("unit-panel-save").click();
  await expect(panel.getByTestId("unit-panel-save")).toBeDisabled();
  const saved = await db.projectUnit.findFirstOrThrow({ where: { projectId: PROJECT, unitCode: "T-101" }, select: { bedrooms: true, grossArea: true } });
  expect([saved.bedrooms, saved.grossArea?.toFixed(2)]).toEqual([1, "85.00"]);
  await expect(rows.first()).toContainText("85.00 m²");

  // Unsaved input asks before stepping on; Escape closes the panel and the list is as it was.
  await panel.getByLabel("Bedrooms").selectOption("2");
  await panel.getByTestId("unit-panel-next").click();
  await page.getByTestId("unsaved-prompt").getByTestId("unsaved-discard").click();
  await expect(panel.getByTestId("unit-panel-title")).toContainText("T-102");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]unit=/);
  await expect(heading(page)).toHaveText("Floor 1 — Tower");

  // Back closes a panel the list opened; a link with ?unit= opens it.
  await rows.nth(1).getByRole("link", { name: "T-102" }).click();
  await expect(panel).toBeVisible();
  await page.goBack();
  await expect(panel).toBeHidden();
  await expect(heading(page)).toHaveText("Floor 1 — Tower");
  const t102 = await db.projectUnit.findFirstOrThrow({ where: { projectId: PROJECT, unitCode: "T-102" }, select: { id: true } });
  await page.goto(`/projects/${PROJECT}/units?unit=${t102.id}`);
  await expect(panel.getByTestId("unit-panel-title")).toContainText("T-102");
});

test("sales reads the units without changing them (§80)", async ({ page }) => {
  await signIn(page, "SALES", { to: `/projects/${STRUCTURE_SEED.riverside}/units?floor=${STRUCTURE_SEED.floors.a1}` });
  await expect(heading(page)).toHaveText("Floor 1 — Block A");
  await expect(mainRegion(page).getByTestId("unit-table").getByTestId("unit-row")).toHaveCount(4);
  await expect(mainRegion(page).getByRole("button", { name: "Add units" })).toHaveCount(0);
  await expect(mainRegion(page).getByRole("button", { name: /^Actions for/ })).toHaveCount(0);

  // The side panel reads the unit's details without a form to change them; its price is Sales' to set.
  await mainRegion(page).getByTestId("unit-table").getByRole("link", { name: "A-104" }).click();
  const panel = page.getByTestId("unit-panel");
  await expect(panel.getByTestId("unit-panel-title")).toContainText("A-104");
  await expect(panel.getByTestId("unit-panel-read")).toBeVisible();
  await expect(panel.locator("#panel-internalArea")).toHaveCount(0);
  await panel.getByTestId("unit-panel-open-page").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A-104");
  await expect(mainRegion(page).getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("filters the project's units in the database (§48, §49)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${STRUCTURE_SEED.riverside}/units` });
  await expect(heading(page)).toHaveText("All units");
  await mainRegion(page).getByRole("button", { name: /^Filters/ }).click();
  const filters = page.getByTestId("unit-filters");
  // The area is the sale area: saleable when typed, else gross (2026-11-09).
  await filters.getByLabel("Area (m²), saleable or gross from").fill("140");
  await filters.getByLabel("Area (m²), saleable or gross from").press("Enter");
  await expect(mainRegion(page).getByText("24 results")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search units" }).fill("B-8");
  await expect(mainRegion(page).getByText("1 result")).toBeVisible();
  await expect(page.getByTestId("unit-table").getByTestId("unit-row")).toHaveAttribute("data-unit-code", "B-804");
  await expect(page).toHaveURL(/areaMin=140/);
});

test("a unit of another company is not found under this project (§82)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER");
  const response = await page.goto(`/projects/${STRUCTURE_SEED.riverside}/units/${STRUCTURE_SEED.units.munichOffice1}`);
  expect(response?.status()).toBe(404);
  const wrongProject = await page.goto(`/projects/project_c/units/${STRUCTURE_SEED.units.a101}`);
  expect(wrongProject?.status()).toBe(404);
});
