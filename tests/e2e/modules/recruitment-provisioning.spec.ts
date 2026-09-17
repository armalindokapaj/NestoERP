import { expect, test } from "@playwright/test";

import { db } from "../db";
import { DEMO_PASSWORD, expectAccessDenied, mainRegion, signIn, signOut } from "../fixtures";
import { RECRUITMENT_PREFIX, restoreRecruitment } from "../recruitment-fixtures";

/**
 * From HR data to a login (E-06 §56-§58, §61-§64, §140).
 *
 * HR recruits a person with no login, selects and hires them, and asks for
 * their account; the Owner approves it — HR cannot approve its own request.
 * Group IT creates Adrian Kola's account from his approved HR record without
 * typing his details, sees the temporary password once, and Adrian signs in to
 * Terra with it. Roles without the grants never reach either screen.
 */

test.describe.configure({ mode: "serial" });

const since = new Date();

test.beforeAll(async () => {
  await restoreRecruitment(new Date(0));
});

test.afterAll(async () => {
  await restoreRecruitment(since);
  await db.$disconnect();
});

test("Group IT creates Adrian Kola's account from his HR record, and he signs in to Terra (§57, §64)", async ({ page }) => {
  await signIn(page, "GROUP_IT", { to: "/organization/provisioning?status=APPROVED" });
  const row = mainRegion(page).getByTestId("provisioning-row").filter({ hasText: "Adrian Kola" });
  await expect(row).toContainText("Terra Infrastructure");
  await row.getByRole("link", { name: "Adrian Kola" }).click();

  // The HR truth is on the page and not in a form (§29).
  const truth = mainRegion(page).getByTestId("request-hr-truth");
  await expect(truth).toContainText("adrian.kola@nesto.test");
  await expect(truth).toContainText("Finance Officer");
  await expect(truth).toContainText("Fiona Blake");
  await expect(mainRegion(page).getByRole("button", { name: "Approve" })).toHaveCount(0);

  await page.getByTestId("provisioning-actions").getByRole("button", { name: "Create account" }).click();
  const dialog = page.getByTestId("provision-dialog");
  await expect(dialog.getByLabel("Username")).toHaveAttribute("placeholder", "adrian.kola");
  await dialog.getByRole("button", { name: "Create account" }).click();

  const credentials = page.getByTestId("provisioned-credentials");
  await expect(credentials.getByTestId("provisioned-username")).toContainText("adrian.kola");
  const password = ((await credentials.getByTestId("provisioned-password").textContent()) ?? "").trim();
  expect(password).toMatch(/^\w{4}-\w{4}-\w{4}-\w{4}$/);
  await credentials.getByRole("button", { name: "Done" }).click();
  await expect(mainRegion(page).getByText("Provisioned").first()).toBeVisible();
  await expect(mainRegion(page).getByTestId("request-account")).toContainText("adrian.kola");

  await signOut(page);
  await page.goto("/login");
  await page.getByLabel("Username").fill("adrian.kola");
  await page.getByLabel("Password").fill(password);
  await page.locator("form").getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expect(page.getByText("Terra Infrastructure").first()).toBeVisible();
  expect(password).not.toBe(DEMO_PASSWORD);
});

test("HR recruits, hires and asks for an account; only somebody else approves it (§28, §62, §119)", async ({ page }) => {
  const lastName = `${RECRUITMENT_PREFIX} Rama`;
  await signIn(page, "HR", { to: "/hr/recruitment" });
  await expect(mainRegion(page).getByTestId("candidate-row").filter({ hasText: "Elira Hoxha" })).toContainText("Interviewing");

  await mainRegion(page).getByRole("button", { name: "Add candidate" }).click();
  const form = page.getByTestId("candidate-dialog");
  await form.getByLabel("First name").fill("Hana");
  await form.getByLabel("Last name").fill(lastName);
  await form.getByLabel("Work email").fill(`hana.rama.${Date.now()}@nesto.test`);
  await form.getByLabel("Company").selectOption({ label: "Terra Infrastructure" });
  await form.getByLabel("Department").selectOption({ label: "Terra Infrastructure · Finance" });
  await form.getByLabel("Role").selectOption({ label: "Finance" });
  await form.getByLabel("Job title").fill("Accounts Assistant");
  await form.getByRole("button", { name: "Add candidate" }).click();

  await expect(page.getByRole("heading", { level: 1, name: `Hana ${lastName}` })).toBeVisible();
  await expect(mainRegion(page).getByTestId("candidate-account")).toContainText("Not requested");

  const actions = page.getByTestId("candidate-actions");
  await actions.getByRole("button", { name: "Mark selected" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark selected" }).click();
  await expect(actions.getByRole("button", { name: "Create employment" })).toBeVisible();

  await actions.getByRole("button", { name: "Create employment" }).click();
  await page.getByTestId("hire-dialog").getByRole("button", { name: "Create employment" }).click();
  await expect(mainRegion(page).getByTestId("candidate-employment")).toContainText("Planned");

  await actions.getByRole("button", { name: "Request NESTO access" }).click();
  await page.getByTestId("access-dialog").getByRole("button", { name: "Submit request" }).click();
  await expect(mainRegion(page).getByTestId("candidate-account")).toContainText("Provisioning requested");

  // The Head of Group HR may approve requests, but not their own.
  await mainRegion(page).getByTestId("candidate-account").getByRole("link", { name: "Submitted" }).click();
  await page.waitForURL(/\/organization\/provisioning\/[^/]+$/);
  await expect(mainRegion(page).getByTestId("request-hr-truth")).toContainText("Accounts Assistant");
  await expect(page.getByTestId("provisioning-actions").getByRole("button", { name: "Approve" })).toHaveCount(0);
  const requestUrl = page.url();

  await signOut(page);
  await signIn(page, "OWNER", { to: new URL(requestUrl).pathname });
  await page.getByTestId("provisioning-actions").getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(mainRegion(page).getByTestId("request-history")).toContainText("Olivia");
  await expect(page.getByTestId("provisioning-actions").getByRole("button", { name: "Create account" })).toHaveCount(0);
});

test("recruitment and account requests stay closed to roles without them (§75, §140)", async ({ page }) => {
  await signIn(page, "ARCHITECT");
  await expectAccessDenied(page, "/hr/recruitment");
  await expectAccessDenied(page, "/organization/provisioning");
  await signOut(page);

  // Group IT provisions accounts but never reads recruitment.
  await signIn(page, "GROUP_IT");
  await expectAccessDenied(page, "/hr/recruitment");
});
