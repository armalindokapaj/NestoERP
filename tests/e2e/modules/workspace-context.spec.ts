import { expect, test } from "@playwright/test";

import { mainRegion, signIn, switchCompany } from "../fixtures";

/**
 * The workspace switcher and what the workspace decides (Workspace Context
 * §5-§13, §24-§31, §46, §70, §83).
 *
 * The Owner of the five-company demo group starts in the Group workspace; a
 * Project Manager of one company is never offered it.
 */

const AURELIA = "company_demo_a";
const switcher = "workspace-switcher";

test("the Owner starts in the group, and the dashboard says so (§16, §70)", async ({ page }) => {
  await signIn(page, "OWNER", { workspace: "GROUP", to: "/dashboard" });

  await expect(page.getByTestId(switcher)).toHaveAccessibleName(/Workspace: NESTO/i);
  await expect(mainRegion(page).getByTestId("dashboard-workspace")).toContainText(/^Across /);
});

test("switching to a company changes the header, the list and nothing about who you are (§11, §70, §83)", async ({ page }) => {
  await signIn(page, "OWNER", { workspace: "GROUP", to: "/projects" });
  // The list streams, so wait for it before counting.
  await expect(mainRegion(page).getByTestId("project-card").first()).toBeVisible();
  const inGroup = await mainRegion(page).getByTestId("project-card").count();

  await page.getByTestId(switcher).click();
  await expect(page.getByTestId("workspace-panel")).toBeVisible();
  await page.getByTestId("workspace-search").fill("Aurelia");
  await page.getByTestId("workspace-option").filter({ hasText: "Aurelia Construction" }).click();

  await expect(page.getByTestId(switcher)).toHaveAccessibleName(/Aurelia Construction/);
  // A switch lands on the dashboard: every list belongs to the workspace just
  // left, so the browser loads a new page rather than patching one (§29, §93).
  await expect(page).toHaveURL(/\/dashboard$/);
  // The same person, still: only where they work has changed (§11).
  await expect(page.getByRole("button", { name: /open user menu/i })).toBeVisible();

  await page.goto("/projects");
  await expect(mainRegion(page).getByTestId("project-card").first()).toBeVisible();
  const inCompany = await mainRegion(page).getByTestId("project-card").count();
  expect(inCompany).toBeLessThan(inGroup);
  // A card always names its company (E-05A §7); in a company workspace every
  // one of them names the same company.
  for (const label of await mainRegion(page).getByTestId("project-company").allInnerTexts()) {
    expect(label).toBe("Aurelia Construction");
  }
});

test("a company-only employee is offered no switcher (§7, §91)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByTestId(switcher)).toHaveCount(0);
  // And asking for it directly is refused, whatever the browser sends (§14, §91).
  expect((await page.request.post("/api/workspace", { data: { scopeType: "GROUP" } })).status()).toBe(403);
});

test("a company-only page asks which company when the group is active (§25, §29)", async ({ page }) => {
  await signIn(page, "OWNER", { workspace: "GROUP" });
  // A company's own settings; Profile and Appearance are the person's and open
  // in either workspace.
  await page.goto("/settings/company");

  await expect(page).toHaveURL(/\/workspace\/company-required/);
  await expect(page.getByRole("heading", { name: /choose a company to continue/i })).toBeVisible();
});

test("a write refuses in the group and works in a company (§59)", async ({ page }) => {
  await signIn(page, "OWNER", { workspace: "GROUP" });

  const refused = await page.request.post("/api/tasks", {
    data: { title: "Workspace E2E task", status: "TODO" },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("WORKSPACE_COMPANY_REQUIRED");

  await switchCompany(page, AURELIA);
  const allowed = await page.request.post("/api/tasks", {
    data: { title: "Workspace E2E task", status: "TODO" },
  });
  expect([200, 201, 400, 422]).toContain(allowed.status());
  // Whatever the body validation says, the workspace is no longer the reason.
  if (!allowed.ok()) expect((await allowed.json()).error.code).not.toBe("WORKSPACE_COMPANY_REQUIRED");
});
