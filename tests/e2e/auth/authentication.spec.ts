import { expect, test } from "@playwright/test";

import { db } from "../db";
import { DEMO_PASSWORD, DEMO_USERNAME, signIn, signOut } from "../fixtures";

/**
 * Authentication journeys (PRD #9 §145–§147, §179).
 */
test.describe("sign in", () => {
  test("signs in and lands on the dashboard (PRD #9 §145)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Project Manager").first()).toBeVisible();
    await expect(page.getByText("Aurelia Construction").first()).toBeVisible();
  });

  test("refuses a wrong password without naming the cause (PRD #6 §8)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill(DEMO_USERNAME.OWNER);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("form").getByRole("alert")).toContainText(/incorrect username or password/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("gives an unknown username the same message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("nobody.at.all");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("form").getByRole("alert")).toContainText(/incorrect username or password/i);
  });

  test("refuses an inactive account (PRD #9 §139)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("inactive-user");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("form").getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("refuses a member of a suspended company (PRD #9 §32)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("suspended-company");
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();

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

    await page.getByLabel("Username").fill(DEMO_USERNAME.PROJECT_MANAGER);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/projects\/project_a/);
    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
  });

  test("bounces an authenticated visitor off the login page", async ({ page }) => {
    await signIn(page, "VIEWER");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  /**
   * A session cookie that outlives its session row (PRD #6 §51).
   *
   * The browser still holds a valid cookie, but the row it names is gone —
   * revoked, expired, or dropped by a reseed. Middleware reads only the cookie
   * and calls them signed in; the page reads the database and does not. Unless
   * middleware is told the page already rejected them, the two trade redirects
   * forever and the login page never renders — locking the person out of the
   * one page that could have fixed it.
   */
  test("lets an expired session reach the login page instead of looping", async ({ page }) => {
    await signIn(page, "OWNER");

    // Revoke it behind their back: the cookie stays, the session row does not.
    await db.session.deleteMany({ where: { user: { username: DEMO_USERNAME.OWNER } } });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?reason=session-expired/);
    await expect(page.getByRole("status")).toContainText(/session expired/i);

    // And the login page stays reachable when asked for directly, stale cookie
    // and all — this is the navigation that used to end in ERR_TOO_MANY_REDIRECTS.
    await page.goto("/login");
    await expect(page.getByLabel("Username")).toBeVisible();

    // The whole point of getting them here: they can sign back in.
    await page.getByLabel("Username").fill(DEMO_USERNAME.OWNER);
    await page.getByLabel("Password").fill(DEMO_PASSWORD);
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();
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

test.describe("password recovery (PRD #50 §3, §268)", () => {
  test("sends people to their administrator, and offers no form", async ({ page }) => {
    await page.goto("/forgot-password");

    await expect(page.getByText(/contact your nesto administrator/i)).toBeVisible();
    // No self-service reset exists in V0.1: nothing here takes an address, and
    // nothing here sends mail.
    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /back to sign in/i })).toBeVisible();
  });

  test("an old reset link leads nowhere but the sign-in page", async ({ page }) => {
    await page.goto("/reset-password?token=not-a-real-token");

    // The route is gone from the build, so what is left is an unknown path an
    // unauthenticated visitor asked for: the middleware sends them to sign in.
    // What matters is that no link in anybody's inbox can still set a password.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel(/new password/i)).toHaveCount(0);
  });
});
