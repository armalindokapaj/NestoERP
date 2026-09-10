import { expect, test } from "@playwright/test";

import { DEMO_EMAIL, DEMO_PASSWORD, signIn, signOut } from "../fixtures";

/**
 * Authentication journeys (PRD #9 §145–§147, §179).
 */
test.describe("sign in", () => {
  test("signs in and lands on the dashboard (PRD #9 §145)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Project Manager").first()).toBeVisible();
    await expect(page.getByText("NESTO Demo Construction").first()).toBeVisible();
  });

  test("refuses a wrong password without naming the cause (PRD #6 §8)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(DEMO_EMAIL.OWNER);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("form").getByRole("alert")).toContainText(/incorrect email or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("gives an unknown email the same message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@nesto.test");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("form").getByRole("alert")).toContainText(/incorrect email or password/i);
  });

  test("refuses an inactive account (PRD #9 §139)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("inactive-user@nesto.test");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("form").getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("refuses a member of a suspended company (PRD #9 §32)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("suspended-company@nesto.test");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("form").getByRole("alert")).toBeVisible();
  });
});

test.describe("route protection", () => {
  test("sends an anonymous visitor to login (PRD #9 §146)", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("returns to the requested page after signing in (PRD #9 §147)", async ({ page }) => {
    await page.goto("/projects/project_a");
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);

    await page.getByLabel("Email").fill(DEMO_EMAIL.PROJECT_MANAGER);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/projects\/project_a/);
    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
  });

  test("bounces an authenticated visitor off the login page", async ({ page }) => {
    await signIn(page, "VIEWER");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe("sign out", () => {
  test("ends the session and re-protects the app (PRD #9 §146)", async ({ page }) => {
    await signIn(page, "OWNER");
    await signOut(page);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("password recovery (PRD #9 §225)", () => {
  test("gives the same confirmation whatever the address", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("nobody-at-all@nesto.test");
    await page.getByRole("button", { name: /send reset link/i }).click();

    await expect(page.getByText(/check your email/i)).toBeVisible();
  });

  test("refuses an invalid reset link", async ({ page }) => {
    await page.goto("/reset-password?token=not-a-real-token");
    await expect(page.getByText(/that link is not valid/i)).toBeVisible();
  });
});
