import { expect, test } from "@playwright/test";

import { signIn } from "../fixtures";

/**
 * Mobile browser behaviour (PRD #9 §182, §184; PRD #3 §6, §21–§28).
 *
 * NESTO on a phone is a website inside a browser, not an imitation of a native
 * app: a sticky header with a hamburger, a left drawer, and no permanent bottom
 * navigation (PRD #3 §6).
 */
test.describe("mobile navigation", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
  });

  test("hides the desktop sidebar and shows the hamburger", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(page.getByRole("button", { name: /open navigation/i })).toBeVisible();
  });

  test("opens the drawer, navigates, and closes on selection (PRD #3 §27)", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /open navigation/i }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await drawer.getByRole("link", { name: "Projects", exact: true }).click();

    await expect(page).toHaveURL(/\/projects/);
    await expect(drawer).toBeHidden();
  });

  test("closes the drawer on Escape (PRD #3 §27)", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("button", { name: /open navigation/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("has no permanent bottom app navigation (PRD #3 §6)", async ({ page }) => {
    await page.goto("/dashboard");

    const navigations = page.getByRole("navigation");
    const count = await navigations.count();

    for (let index = 0; index < count; index += 1) {
      const box = await navigations.nth(index).boundingBox();
      if (!box) continue;
      const viewport = page.viewportSize()!;
      // Nothing pinned to the bottom edge of the screen.
      expect(box.y).toBeLessThan(viewport.height - 60);
    }
  });

  test("shows the drawer's own close control", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /open navigation/i }).click();

    await page.getByRole("button", { name: /close navigation/i }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("mobile module layout (PRD #9 §184)", () => {
  test("renders a list as record cards rather than a squeezed table", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/all");

    // The desktop table is hidden below the tablet breakpoint.
    await expect(page.getByRole("table")).toBeHidden();
    await expect(page.getByRole("link", { name: /Riverside Residences/ }).first()).toBeVisible();
  });

  test("moves filters into a sheet (PRD #7 §88)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/all");

    await page.getByRole("button", { name: /^filters$/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("Status")).toBeVisible();
  });

  test("never scrolls the page sideways", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");

    for (const path of ["/dashboard", "/projects/all", "/projects/project_a"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });

  test("keeps the project detail usable on a phone (PRD #10 §142)", async ({ page }) => {
    await signIn(page, "PROJECT_MANAGER");
    await page.goto("/projects/project_a");

    await expect(page.getByRole("heading", { name: "Riverside Residences" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Project sections" })).toBeVisible();
  });
});
