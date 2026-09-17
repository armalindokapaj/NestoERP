import { expect, type Page, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * One person, two companies (E-05A §26, §28, §63, §70, §73; E-06 §55).
 *
 * `multi-architect` is an Architect in Aurelia Construction on Riverside
 * Residences and in Forma Engineering on Marina Apartments. Sign-in lands in
 * Aurelia, the older membership.
 */

const card = (page: Page, name: string) =>
  mainRegion(page).getByTestId("project-card").filter({ has: page.getByRole("link", { name }) });

test.beforeEach(async ({ page }) => {
  await signIn(page, "MULTI_COMPANY");
});

test("finds both companies' projects on one page, each company named", async ({ page }) => {
  await page.goto("/projects");

  await expect(mainRegion(page).getByText("2 projects across 2 companies")).toBeVisible();
  await expect(card(page, "Riverside Residences").getByTestId("project-company")).toHaveText("Aurelia Construction");
  await expect(card(page, "Marina Apartments").getByTestId("project-company")).toHaveText("Forma Engineering");
  await expect(card(page, "Marina Apartments")).toContainText("Architect");
  await expect(card(page, "Riverside Residences")).toContainText("Architect");
  // A sibling company this person does not belong to lends them nothing.
  await expect(mainRegion(page).getByText("Central Office Tower")).toHaveCount(0);

  await mainRegion(page).getByLabel("Company").selectOption({ label: "Forma Engineering" });
  await expect(card(page, "Riverside Residences")).toHaveCount(0);
  await expect(card(page, "Marina Apartments")).toBeVisible();
});

test("opens a project in the other company without choosing the company first", async ({ page }) => {
  await page.goto("/projects");
  await card(page, "Marina Apartments").getByTestId("project-card-link").click();

  await expect(page).toHaveURL(/\/projects\/project_d$/);
  await expect(page.getByRole("heading", { name: "Marina Apartments" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Forma Engineering");

  // And back again, the same way.
  await page.goto("/projects");
  await card(page, "Riverside Residences").getByTestId("project-card-link").click();
  await expect(page).toHaveURL(/\/projects\/project_a$/);
  await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
});

test("follows a deep link into the other company's project tab", async ({ page }) => {
  await page.goto("/projects/project_d/team");

  await expect(page).toHaveURL(/\/projects\/project_d\/team$/);
  await expect(page.getByRole("heading", { name: "Marina Apartments" }).first()).toBeVisible();
});

test("reveals nothing of a project in either company it cannot open (E-05A §49)", async ({ page }) => {
  // Each company runs one project, so the architect is taken off Marina for
  // the length of the test: Forma is still theirs, the project no longer is.
  const where = { projectId: "project_d", companyMemberId: "member_multicompany_d" };
  await db.projectMember.updateMany({ where, data: { status: "INACTIVE" } });
  await db.companyMember.update({ where: { id: "member_multicompany_d" }, data: { accessVersion: { increment: 1 } } });
  try {
    const response = await page.goto("/projects/project_d");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Marina Apartments")).toHaveCount(0);
    await expect(page.getByText("Forma Engineering")).toHaveCount(0);

    const open = await page.request.post("/api/projects/project_d/open");
    expect(open.status()).toBe(404);

    const cover = await page.request.get("/api/projects/project_d/cover");
    expect(cover.status()).toBe(404);
  } finally {
    await db.projectMember.updateMany({ where, data: { status: "ACTIVE" } });
  }
});

test.afterAll(async () => {
  await db.$disconnect();
});
