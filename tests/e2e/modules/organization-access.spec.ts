import { expect, test } from "@playwright/test";

import { db } from "../db";
import { mainRegion, signIn } from "../fixtures";

/**
 * Access & roles (E-06 §18, §73, §127).
 *
 * The Owner delegates Finance in Aurelia to a project manager and revokes it
 * again. Group IT asks why that project manager can or cannot do something,
 * and reads the roles by position. A group head reaches only the delegated
 * access of their own function.
 */

test.describe.configure({ mode: "serial" });

const startedAt = new Date();

test.afterAll(async () => {
  const grants = await db.accessGrant.findMany({ where: { createdAt: { gte: startedAt } }, select: { id: true } });
  await db.auditEvent.deleteMany({ where: { entityId: { in: grants.map((row) => row.id) } } });
  await db.accessGrant.deleteMany({ where: { id: { in: grants.map((row) => row.id) } } });
  await db.$disconnect();
});

test("the Owner delegates Finance to a project manager, and revokes it (§18)", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/organization/access" });
  await expect(page.getByRole("heading", { level: 1, name: "Access & roles" })).toBeVisible();

  await mainRegion(page).getByRole("button", { name: "Delegate access" }).click();
  const dialog = page.getByTestId("grant-dialog");
  await dialog.getByRole("combobox", { name: /^Person/ }).selectOption({ label: "Alex Morgan" });
  await dialog.getByRole("combobox", { name: /^Module/ }).selectOption({ label: "Finance" });
  await dialog.getByRole("combobox", { name: /^Company/ }).selectOption({ label: "Aurelia Construction" });
  await dialog.getByRole("textbox", { name: /^Reason/ }).fill("Cost review for the Riverside handover");
  await dialog.getByRole("button", { name: "Delegate" }).click();

  const row = mainRegion(page).getByTestId("grant-row").filter({ hasText: "Alex Morgan" });
  await expect(row).toContainText("Finance");
  await expect(row).toContainText("In force");

  await row.getByRole("button", { name: "Revoke Alex Morgan's Finance access" }).click();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(mainRegion(page).getByTestId("grant-row").filter({ hasText: "Alex Morgan" })).toHaveCount(0);

  await page.goto("/organization/access?status=all");
  await expect(mainRegion(page).getByTestId("grant-row").filter({ hasText: "Alex Morgan" })).toContainText("Revoked");
});

test("Group IT checks why somebody can or cannot do something, and reads roles by position (§73)", async ({ page }) => {
  await signIn(page, "GROUP_IT", { to: "/organization/access?view=check" });
  // Group IT keeps access; it does not delegate it.
  await expect(mainRegion(page).getByRole("button", { name: "Delegate access" })).toHaveCount(0);

  const form = mainRegion(page);
  await form.getByRole("combobox", { name: "Person" }).selectOption({ label: "Alex Morgan (pm-a)" });
  await form.getByRole("combobox", { name: "Company" }).selectOption({ label: "Meridian Developments" });
  await form.getByRole("textbox", { name: /Permission/ }).fill("project.view");
  await form.getByRole("button", { name: "Check" }).click();

  const diagnosis = mainRegion(page).getByTestId("access-diagnosis");
  await expect(diagnosis).toContainText("Alex Morgan in Meridian Developments");
  await expect(diagnosis.getByRole("list", { name: "Blockers" })).toContainText("no membership in Meridian Developments");
  await expect(mainRegion(page).getByTestId("permission-answer")).toContainText("Not held");

  await form.getByRole("combobox", { name: "Company" }).selectOption({ label: "Aurelia Construction" });
  await form.getByRole("button", { name: "Check" }).click();
  await expect(mainRegion(page).getByTestId("permission-answer")).toContainText("Held.");
  await expect(diagnosis.getByRole("table", { name: "Module access" })).toContainText("Projects");

  await mainRegion(page).getByRole("link", { name: "Roles", exact: true }).click();
  await mainRegion(page).getByRole("link", { name: "Architect", exact: true }).click();
  await expect(mainRegion(page).getByRole("table", { name: "Architect by position" })).toContainText("Engineering");
});

test("a group head reaches only their function's delegated access (§78)", async ({ page }) => {
  await signIn(page, "ARCHITECTURE_HEAD", { to: "/organization/access" });
  await expect(page.getByRole("heading", { level: 1, name: "Delegated access" })).toBeVisible();
  await expect(mainRegion(page).getByRole("navigation", { name: "Access views" })).toHaveCount(0);

  await page.goto("/organization/access?view=check");
  await expect(mainRegion(page).getByTestId("access-diagnosis")).toHaveCount(0);
  await expect(mainRegion(page).getByRole("combobox", { name: "Person" })).toHaveCount(0);
});

test("a project manager has no access page (§127)", async ({ page }) => {
  await signIn(page, "PROJECT_MANAGER", { to: "/organization/access" });
  await expect(page).toHaveURL(/\/access-denied/);
});
