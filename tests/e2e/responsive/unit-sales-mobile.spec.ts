import { expect, test } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";
import { STRUCTURE_SEED } from "../structure-fixtures";

/**
 * Sales on a phone (E-05E §55): the inventory as cards with what decides a sale —
 * code, place, status, area, price, client and expiry — the quick filters, and a
 * card's Release opening the unit's Sales section with the dialog ready. Reads
 * only; the dialog is cancelled, so nothing needs putting back.
 */

test("finds the reserved units and opens a release from a card on a phone", async ({ page }) => {
  await signIn(page, "SALES", { to: `/projects/${STRUCTURE_SEED.riverside}/sales` });
  // Scoped to the main region: the list streams, and for a moment React's parked copy is in the document too (see mainRegion).
  await expect(mainRegion(page).getByTestId("sales-table")).toBeHidden();

  await mainRegion(page).getByTestId("sales-quick-filter").and(page.locator('[data-status="RESERVED"]')).click();
  const cards = mainRegion(page).getByTestId("sales-cards").getByTestId("sales-card");
  // Riverside's seeded reservations: A-102 and A-203.
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) await expect(card.getByTestId("commercial-status")).toHaveText("Reserved");
  const a102 = cards.and(page.locator('[data-unit-code="A-102"]'));
  await expect(a102).toContainText("ACME Developments");
  await expect(a102).toContainText("€129,500");
  await expect(a102).toContainText("expires");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await a102.getByRole("link", { name: "Release" }).click();
  // The dialog opens over the unit's page, which it hides from assistive technology until it closes.
  const release = page.getByTestId("release-dialog");
  await expect(release).toBeVisible();
  await expect(release).toContainText("Release the reservation of A-102?");
  await expect(release.getByLabel("Reason")).toBeVisible();
  await release.getByRole("button", { name: "Cancel" }).click();
  await expect(release).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A-102");
  await expect(page.getByTestId("unit-sales-summary").getByTestId("commercial-status")).toHaveText("Reserved");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
