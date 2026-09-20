import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";

test("the Project home opens canonical renders and their media manager", async ({ page }) => {
  await signIn(page, "PM_B", { to: "/projects/project_b" });

  await expect(page.getByRole("heading", { level: 1, name: "Central Office Tower" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Central Office Tower cover render" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Project summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My project work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();

  await page.getByRole("link", { name: /view renders/i }).click();
  await expect(page).toHaveURL(/\/projects\/project_b\/media\?type=renders$/);
  await expect(page.getByRole("heading", { name: "Renders" })).toBeVisible();
  await page.getByRole("button", { name: "Open render Central Office Tower render" }).click();
  await expect(page.getByRole("dialog")).toContainText("Central Office Tower render");
  await page.getByRole("dialog").getByText("Close", { exact: true }).click();

  await page.goto("/projects/project_b/media?manage=1");
  await expect(page.getByRole("heading", { level: 1, name: "Manage project media" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Project media" })).toContainText("Central Office Tower render");
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
});
