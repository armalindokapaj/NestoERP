import { expect, test } from "@playwright/test";

test("pricing wizard remains usable at mobile width", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("heading", { name: "Build your NESTO" })).toBeVisible();
  await page.getByRole("button", { name: /NESTO ROZARIS only/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("heading", { name: "How is your organization structured?" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText("Live estimate")).toBeVisible();
});
