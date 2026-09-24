import { expect, type Page, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn, switchToGroup } from "../fixtures";

/**
 * One person, two companies (E-05A §26, §28, §63, §70, §73; E-06 §55;
 * Workspace Context §7, §16, §83).
 *
 * `multi-architect` is an Architect in Aurelia Construction on Riverside
 * Residences and in Forma Engineering on Marina Apartments. Sign-in lands in
 * Aurelia, the older membership. Both companies on one page is the Group
 * workspace, which working in two companies opens to them.
 */

const card = (page: Page, name: string) =>
  mainRegion(page).getByTestId("project-card").filter({ has: page.getByRole("link", { name }) });

test.beforeEach(async ({ page }) => {
  await signIn(page, "MULTI_COMPANY", { workspace: "GROUP" });
});

test("finds both companies' projects on one page, each company named", async ({ page }) => {
  await page.goto("/projects");

  await expect(mainRegion(page).getByText("2 projects across 2 companies")).toBeVisible();
  await expect(card(page, "Riverside Residences").getByTestId("project-company")).toHaveText("Aurelia Construction");
  await expect(card(page, "Marina Apartments").getByTestId("project-company")).toHaveText("Forma Engineering");
  // A sibling company this person does not belong to lends them nothing.
  await expect(mainRegion(page).getByText("Central Office Tower")).toHaveCount(0);

  // The workspace chose the companies; the page offers no company filter, and
  // its search finds a company by name among these cards (Projects Workspace Grid §8, §25).
  await expect(mainRegion(page).getByLabel("Company")).toHaveCount(0);
  await mainRegion(page).getByRole("searchbox", { name: "Search projects" }).fill("Forma");
  await expect(card(page, "Riverside Residences")).toHaveCount(0);
  await expect(card(page, "Marina Apartments")).toBeVisible();
});

test("opens a project in the other company without choosing the company first", async ({ page }) => {
  await page.goto("/projects");
  await card(page, "Marina Apartments").getByTestId("project-card-link").click();

  await expect(page).toHaveURL(/\/projects\/project_d$/);
  await expect(page.getByRole("heading", { name: "Marina Apartments" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Forma Engineering");

  // Opening it moved the workspace into Forma, so the portfolio is Forma's now.
  // Back in the group, the other company's project opens the same way.
  await switchToGroup(page);
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
    // Not found, and nothing about it: not its name, not the company holding it.
    // (The shell has already streamed by the time the lookup fails, so the
    // document's status is 200 while the page itself is the not-found page.)
    await page.goto("/projects/project_d");
    await expect(page.getByText("Page not found.")).toBeVisible();
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
