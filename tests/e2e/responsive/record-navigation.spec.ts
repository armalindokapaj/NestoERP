import { expect, test } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";

test("mobile record navigation keeps Back and the current record visible without overflow", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/projects" });
  await mainRegion(page).getByTestId("project-card-link").first().click();

  const header = mainRegion(page).getByTestId("record-navigation-header").first();
  await expect(header.getByRole("button", { name: "Go back" })).toBeVisible();
  await expect(header.locator('[aria-current="page"]')).toBeVisible();
  const collapsed = header.getByRole("button", { name: "Show hidden breadcrumb levels" });
  await expect(collapsed).toBeVisible();
  await collapsed.click();
  await expect(page.getByRole("menu").getByText("Aurelia Construction")).toBeVisible();
  await expect(page.getByRole("menu").getByText("Projects")).toBeVisible();

  const sizes = await header.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.width);
});
