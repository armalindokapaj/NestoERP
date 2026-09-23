import { expect, test } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";

test("record breadcrumbs expose workspace hierarchy and keep browser-style history", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/projects" });
  const card = mainRegion(page).getByTestId("project-card-link").first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);

  const header = mainRegion(page).getByTestId("record-navigation-header").first();
  const breadcrumbs = header.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumbs.getByRole("link", { name: "NESTO Demo Group" })).toBeVisible();
  await expect(breadcrumbs.getByRole("link", { name: "Aurelia Construction" })).toBeVisible();
  await expect(breadcrumbs.getByRole("link", { name: "Projects" })).toBeVisible();
  await expect(breadcrumbs.locator('[aria-current="page"]')).toBeVisible();
  await expect(header.getByRole("button", { name: "Go forward" })).toBeDisabled();

  const detailUrl = page.url();
  await page.goto(`${detailUrl}/units`);
  await expect(page).toHaveURL(/\/projects\/[^/]+\/units$/);
  const nestedHeader = mainRegion(page).getByTestId("record-navigation-header").first();
  await nestedHeader.getByRole("button", { name: "Go back" }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(header.getByRole("button", { name: "Go forward" })).toBeEnabled();
  await header.getByRole("button", { name: "Go forward" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/units$/);

  // Native browser controls and shortcuts must keep the app history cursor in sync.
  await page.goBack();
  await expect(page).toHaveURL(detailUrl);
  await expect(mainRegion(page).getByRole("button", { name: "Go forward" })).toBeEnabled();
  await page.goForward();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/units$/);

  await mainRegion(page).getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});
