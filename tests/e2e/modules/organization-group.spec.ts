import { expect, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn, workspaceHeader } from "../fixtures";

/**
 * The group, from inside it (E-06 §3.4, §65-§68, §96, §108).
 *
 * A person who works in two companies moves between them from the top bar; a
 * person in one company is offered no switch. Forma's finance manager puts one
 * of their people on Forma's project from the department page and takes them
 * off again — the same team the project page keeps. The Owner's dashboard
 * shows the five companies of the group.
 */

test.describe.configure({ mode: "serial" });

const FINANCE_IN_FORMA = "member_finance__d";

test.afterAll(async () => {
  await db.projectMember.deleteMany({ where: { projectId: "project_d", companyMemberId: FINANCE_IN_FORMA } });
  await db.auditEvent.deleteMany({ where: { entityId: "project_d", actionKey: { in: ["PROJECT_MEMBER_ASSIGNED", "PROJECT_MEMBER_REMOVED"] } } });
  await db.$disconnect();
});

test("somebody in two companies switches between them from the sidebar header (§3.4, §96; OW §3)", async ({ page }) => {
  await signIn(page, "MULTI_COMPANY", { to: "/dashboard" });
  const switcher = workspaceHeader(page);
  await expect(switcher).toHaveAttribute("aria-label", /Aurelia Construction/);
  await switcher.click();
  await page.getByTestId("workspace-option").filter({ hasText: "Forma Engineering" }).click();
  await expect(workspaceHeader(page)).toHaveAttribute("aria-label", /Forma Engineering/);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/projects/project_d/team");
  await expect(page.getByRole("heading", { name: "Marina Apartments" }).first()).toBeVisible();
});

test("somebody with one company and no group standing is offered no switch", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/dashboard" });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(workspaceHeader(page)).toHaveAttribute("data-options", "single");
  await expect(page.getByTestId("sidebar-header").getByRole("button")).toHaveCount(0);
});

test("a company department manager assigns one of their people to a project, and takes them off (§65, §94; E-13 §88)", async ({ page }) => {
  await signIn(page, "FINANCE_MANAGER_D", { to: "/organization/departments" });
  await mainRegion(page).getByRole("table", { name: "Group departments" }).getByRole("link", { name: "Finance", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Finance" })).toBeVisible();
  const sections = page.getByRole("navigation", { name: "Department sections" });

  // Forma's branch only: a local manager does not see the other companies.
  await sections.getByRole("link", { name: "Companies" }).click();
  await expect(mainRegion(page).getByRole("table", { name: "Finance by company" }).getByRole("row")).toHaveCount(2);

  await sections.getByRole("link", { name: "Team" }).click();
  const fiona = () => mainRegion(page).getByRole("table", { name: "Finance team" }).getByRole("row", { name: /Fiona Blake/ });
  await fiona().getByRole("button", { name: "Assign Fiona Blake to a project" }).click();
  const dialog = page.getByTestId("assign-project-dialog");
  await dialog.getByRole("combobox", { name: /^Project/ }).selectOption({ label: "D-PRJ-001 · Marina Apartments" });
  await dialog.getByRole("button", { name: "Assign" }).click();
  await expect(fiona().getByTestId("member-project")).toContainText("Marina Apartments");

  await page.goto("/projects/project_d/team");
  await expect(mainRegion(page).getByText("Fiona Blake").first()).toBeVisible();

  await page.goBack();
  await fiona().getByRole("button", { name: "Take Fiona Blake off Marina Apartments" }).click();
  await expect(fiona().getByTestId("member-project")).toHaveCount(0);
});

test("the Owner's dashboard shows the group's five companies (§108)", async ({ page }) => {
  // The group's own dashboard, which is the Group workspace's (Workspace Context §84).
  await signIn(page, "OWNER", { workspace: "GROUP", to: "/dashboard" });
  const companies = mainRegion(page).getByRole("region", { name: "Group Companies" });
  for (const name of ["Aurelia Construction", "Meridian Developments", "Terra Infrastructure", "Forma Engineering", "Nova Hospitality Development"]) {
    await expect(companies.getByText(name)).toBeVisible();
  }
});
