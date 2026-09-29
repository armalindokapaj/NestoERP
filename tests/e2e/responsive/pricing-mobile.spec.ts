import { expect, test } from "@playwright/test";

test("pricing wizard remains usable at mobile width", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Build your NESTO" })).toBeVisible();
  await page.getByTestId("foundation-rozaris").click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Which business functions do you need?" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("link", { name: "View breakdown" })).toBeVisible();
});
