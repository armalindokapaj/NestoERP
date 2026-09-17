import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";
import { STRUCTURE_SEED } from "../structure-fixtures";

/**
 * Unit finance on a phone (E-05F §45, §47, §50, DoD "responsive"): the
 * project's units as cards with what decides collection, the Overdue quick
 * filter, and a card opening the unit's Finance section with its figures and
 * schedule. Reads only.
 */

test("finds the overdue sale and reads its collection on a phone", async ({ page }) => {
  await signIn(page, "FINANCE", { to: `/projects/${STRUCTURE_SEED.riverside}/finance/units` });
  await expect(page.getByTestId("finance-table")).toBeHidden();

  await page.getByTestId("finance-quick-filter").and(page.locator('[data-status="OVERDUE"]')).click();
  const cards = page.getByTestId("finance-cards").getByTestId("finance-card");
  // Riverside's seeded sale: A-201, its first installment part paid and past due.
  const a201 = cards.and(page.locator('[data-unit-code="A-201"]'));
  await expect(a201).toBeVisible();
  await expect(a201.getByTestId("financial-status")).toHaveText("Overdue");
  await expect(a201).toContainText("CTR-2026-041");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await a201.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A-201");
  await expect(page.getByTestId("unit-finance-summary").getByTestId("financial-status")).toHaveText("Overdue");
  await expect(page.getByTestId("finance-contract-value")).toHaveText("€176,000.00");
  await expect(page.getByTestId("finance-paid")).toHaveText("€37,600.00");
  await expect(page.getByTestId("payment-schedule").getByTestId("installment-card")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
