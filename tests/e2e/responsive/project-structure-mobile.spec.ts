import { expect, test } from "../pw";

import { currentSection, mainRegion, openSection, openSectionMenu, signIn } from "../fixtures";
import { STRUCTURE_SEED } from "../structure-fixtures";

/**
 * Project structure on a phone (E-05B §33): no tree, a Building and a Floor
 * dropdown on one line, the search line with Add units at its end, units as
 * compact lines, and a line opening the unit in a
 * full-height sheet, and from there its page. Reads
 * only, so nothing needs putting back.
 */

test("finds a unit by building and floor on a phone", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: `/projects/${STRUCTURE_SEED.riverside}/units` });
  await expect(page.getByTestId("structure-tree")).toBeHidden();

  await page.getByRole("combobox", { name: "Building", exact: true }).selectOption({ label: "Block B" });
  await expect(page.getByTestId("structure-heading")).toHaveText("Block B");
  await page.getByRole("combobox", { name: "Floor", exact: true }).selectOption({ label: "Floor 1 · 4" });
  await expect(page.getByTestId("structure-heading")).toHaveText("Floor 1 — Block B");

  const cards = page.getByTestId("unit-cards").getByTestId("unit-card");
  await expect(cards).toHaveCount(4);
  // Tight under the top bar (2026-11-12): the search line holds the main action, and the first unit is high on the screen.
  const search = page.getByRole("searchbox", { name: "Search units" });
  const add = page.getByTestId("add-units-compact");
  if (await add.count()) expect(Math.abs((await add.boundingBox())!.y - (await search.boundingBox())!.y)).toBeLessThan(8);
  expect((await cards.first().boundingBox())!.y).toBeLessThan(page.viewportSize()!.height / 2);
  await page.getByRole("searchbox", { name: "Search units" }).fill("B-104");
  await expect(cards).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A card opens the unit in a full-height sheet (2026-11-09); Open full page goes on to the unit page.
  await cards.first().getByRole("link").click();
  const panel = page.getByTestId("unit-panel");
  await expect(panel.getByTestId("unit-panel-title")).toContainText("B-104");
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.getByTestId("unit-panel-open-page").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("B-104");
  await expect(page.getByTestId("unit-location")).toContainText("Block B · Floor 1");
});

test("reads a published unit's page, sections and Sales Plan on a phone (E-05D §91, §115)", async ({ page }) => {
  await signIn(page, "SALES", { to: `/projects/${STRUCTURE_SEED.riverside}/units/${STRUCTURE_SEED.units.a101}` });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A-101");
  await expect(page.getByTestId("publication-status").first()).toHaveText("Published v1");
  // Scoped to the main region: the page streams, and for a moment React's parked copy is in the document too (see mainRegion).
  await expect(mainRegion(page).getByTestId("unit-primary-image")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A phone draws no tab rows: the row under the top bar holds the unit's sections, after a link
  // back to the project's section it sits in (components/layout/phone-sections.tsx).
  const row = await openSectionMenu(page);
  await expect(row).toHaveAccessibleName("A-101 sections");
  await expect(currentSection(page)).toHaveText("Overview");
  await expect(row.getByTestId("phone-sections-up")).toHaveText("Units");
  await row.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(page.getByTestId("sales-plan")).toContainText("A-101 Sales Plan.pdf");
  await expect(currentSection(page)).toHaveText("Documents");
  await openSection(page, "Publishing", "A-101 sections");
  await expect(page.getByTestId("publication-history")).toContainText("v1 Published");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
