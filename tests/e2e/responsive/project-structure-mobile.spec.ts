import { expect, test } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";
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

  await page.getByRole("navigation", { name: "A-101 sections" }).getByRole("link", { name: "Documents", exact: true }).click();
  await expect(page.getByTestId("sales-plan")).toContainText("A-101 Sales Plan.pdf");
  await page.getByRole("navigation", { name: "A-101 sections" }).getByRole("link", { name: "Publishing", exact: true }).click();
  await expect(page.getByTestId("publication-history")).toContainText("v1 Published");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
