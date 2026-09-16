import { expect, type Page, test } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";

/**
 * One person, two companies (E-05A §26, §28, §63, §70, §73).
 *
 * `multicompany` is an Architect in Company A on Greenline Villas and a Project
 * Manager in Company B on Isarvorstadt Studio Refit. Sign-in lands in Company A.
 */

const card = (page: Page, name: string) =>
  mainRegion(page).getByTestId("project-card").filter({ has: page.getByRole("link", { name }) });

test.beforeEach(async ({ page }) => {
  await signIn(page, "MULTI_COMPANY");
});

test("finds both companies' projects on one page, each company named", async ({ page }) => {
  await page.goto("/projects");

  await expect(mainRegion(page).getByText("2 projects across 2 companies")).toBeVisible();
  await expect(card(page, "Greenline Villas").getByTestId("project-company")).toHaveText("NESTO Demo Construction");
  await expect(card(page, "Isarvorstadt Studio Refit").getByTestId("project-company")).toHaveText("NESTO Second Company");
  await expect(card(page, "Isarvorstadt Studio Refit")).toContainText("Project Manager");
  await expect(card(page, "Greenline Villas")).toContainText("Architect");
  await expect(mainRegion(page).getByText("Munich Workspace Fitout")).toHaveCount(0);

  await mainRegion(page).getByLabel("Company").selectOption({ label: "NESTO Second Company" });
  await expect(card(page, "Greenline Villas")).toHaveCount(0);
  await expect(card(page, "Isarvorstadt Studio Refit")).toBeVisible();
});

test("opens a project in the other company without choosing the company first", async ({ page }) => {
  await page.goto("/projects");
  await card(page, "Isarvorstadt Studio Refit").getByTestId("project-card-link").click();

  await expect(page).toHaveURL(/\/projects\/project_b_two$/);
  await expect(page.getByRole("heading", { name: "Isarvorstadt Studio Refit" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("NESTO Second Company");

  // And back again, the same way.
  await page.goto("/projects");
  await card(page, "Greenline Villas").getByTestId("project-card-link").click();
  await expect(page).toHaveURL(/\/projects\/project_e$/);
  await expect(page.getByRole("heading", { name: "Greenline Villas" })).toBeVisible();
});

test("follows a deep link into the other company's project tab", async ({ page }) => {
  await page.goto("/projects/project_b_two/team");

  await expect(page).toHaveURL(/\/projects\/project_b_two\/team$/);
  await expect(page.getByRole("heading", { name: "Isarvorstadt Studio Refit" }).first()).toBeVisible();
});

test("reveals nothing of a project in either company it cannot open (E-05A §49)", async ({ page }) => {
  const response = await page.goto("/projects/project_b_one");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Munich Workspace Fitout")).toHaveCount(0);
  await expect(page.getByText("NESTO Second Company")).toHaveCount(0);

  const open = await page.request.post("/api/projects/project_b_one/open");
  expect(open.status()).toBe(404);

  const cover = await page.request.get("/api/projects/project_b_one/cover");
  expect(cover.status()).toBe(404);
});
