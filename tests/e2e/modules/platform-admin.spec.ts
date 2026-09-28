import { expect, test } from "@playwright/test";

import { db } from "../db";
import { signIn } from "../fixtures";
import { removePlatformGroup } from "../platform-fixtures";

/**
 * The Platform Admin implements a group (E-06 §20, §21, §69-§71, §116, §137).
 *
 * A group is created implementing, gets a company with its department branches,
 * the Owner and Group IT from the approved roster — each account's temporary
 * password shown once — and goes live when the checklist is met. Business
 * sessions, the Owner's included, never reach the platform area.
 */

test.describe.configure({ mode: "serial" });

const SLUG = "e2e-harbour-group";

test.beforeAll(async () => {
  await removePlatformGroup(SLUG);
});

test.afterAll(async () => {
  await removePlatformGroup(SLUG);
  await db.$disconnect();
});

test("the Platform Admin creates a group, a company and its first people, and activates it", async ({ page }) => {
  await signIn(page, "PLATFORM_ADMIN", { to: "/admin/organizations" });
  await expect(page.getByRole("heading", { level: 1, name: "Organizations" })).toBeVisible();

  // A name is all a group needs; its code is made from it (Organizations PRD §18).
  await page.getByTestId("organization-create").click();
  await page.getByRole("menuitem", { name: "Create Parent Group" }).click();
  const create = page.getByTestId("new-group-dialog");
  await create.getByRole("textbox", { name: /^Group name/ }).fill("E2E Harbour Group");
  await create.getByRole("button", { name: "Create Group" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "E2E Harbour Group" })).toBeVisible();
  await expect(page.getByText("Implementing").first()).toBeVisible();
  const actions = page.getByTestId("implementation-actions");
  await expect(actions.getByRole("button", { name: "Activate group" })).toHaveCount(0);

  await actions.getByRole("button", { name: "New company" }).click();
  const company = page.getByTestId("create-company-dialog");
  await company.getByRole("textbox", { name: /^Name/ }).fill("E2E Harbour Build");
  await company.getByLabel("Code").fill(`${SLUG}-build`);
  await company.getByLabel("Industry").fill("Construction");
  await company.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByTestId("implementation-company").filter({ hasText: "E2E Harbour Build" })).toContainText("13");

  for (const [first, role] of [["Hana", "Group Owner"], ["Ilir", "Group IT"]] as const) {
    await actions.getByRole("button", { name: "Add to roster" }).click();
    const person = page.getByTestId("initial-user-dialog");
    await person.getByLabel("First name").fill(first);
    await person.getByLabel("Last name").fill("Harbour");
    await person.getByLabel("Role").selectOption({ label: role });
    await person.getByRole("button", { name: "Create account" }).click();
    const credentials = page.getByTestId("initial-user-credentials");
    await expect(credentials).toContainText(`${first.toLowerCase()}.harbour`);
    await credentials.getByRole("button", { name: "Done" }).click();
  }
  await expect(page.getByTestId("implementation-person")).toHaveCount(2);

  await actions.getByRole("button", { name: "Activate group" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Activate group" }).click();
  await expect(page.getByText("Active since").first()).toBeVisible();
  await expect(actions.getByRole("button", { name: "Add to roster" })).toHaveCount(0);
});

test("the Owner is not let into the platform area (§116, §137)", async ({ page }) => {
  await signIn(page, "OWNER", { to: "/dashboard" });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
  const response = await page.request.post("/api/platform/parent-groups", { data: { name: "Not mine", slug: "e2e-not-mine" } });
  expect(response.status()).toBe(403);
});
