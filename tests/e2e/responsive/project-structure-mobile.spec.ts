import { expect, test } from "../pw";

import { mainRegion, openSection, openSectionMenu, sectionMenuTrigger, signIn } from "../fixtures";
import { STRUCTURE_SEED } from "../structure-fixtures";

/**
 * Project structure on a phone (E-05B §33): no tree, a Building and a Floor
 * dropdown, units as cards, search, and a card opening the unit page. Reads
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
  await page.getByRole("searchbox", { name: "Search units" }).fill("B-104");
  await expect(cards).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await cards.first().getByRole("link").click();
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

  // A phone draws no tab rows: the unit's sections are the second group of the top bar's section menu,
  // under the project's, and the pill names the unit's section (components/layout/section-menu.tsx).
  await expect(sectionMenuTrigger(page).getByTestId("section-menu-current")).toHaveText("Overview");
  const menu = await openSectionMenu(page);
  await expect(menu).toHaveAccessibleName("Page sections");
  await expect(menu.getByRole("group")).toHaveCount(2);
  const [project, unit] = [menu.getByRole("group", { name: "Project sections" }), menu.getByRole("group", { name: "A-101 sections" })];
  await expect(project.getByRole("link", { name: "Units", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(unit.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(project.getByRole("link", { name: "Overview", exact: true })).not.toHaveAttribute("aria-current", "page");
  await unit.getByRole("link", { name: "Documents", exact: true }).click();
  await expect(page.getByTestId("sales-plan")).toContainText("A-101 Sales Plan.pdf");
  await expect(sectionMenuTrigger(page).getByTestId("section-menu-current")).toHaveText("Documents");
  await openSection(page, "Publishing", "A-101 sections");
  await expect(page.getByTestId("publication-history")).toContainText("v1 Published");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
