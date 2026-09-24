import { expect, test, type Page } from "@playwright/test";

import { mainRegion, signIn } from "../fixtures";

/**
 * Streamed page sections (NAV-03 §8, §17.3). The Tasks counters can be held or
 * failed through the test hook (`section-tasks-stats`), which answers only
 * when the server was started with NESTO_TEST_SHELL_DELAYS=1.
 */

const HOOKED = process.env.NESTO_TEST_SHELL_DELAYS === "1";

async function rule(page: Page, value: string) {
  await page.context().addCookies([{ name: "nesto-test-shell-delay", value, url: new URL(page.url()).origin }]);
}

test.describe("progressive sections (S01, S03, S11, S14)", () => {
  test.skip(!HOOKED, "Start the server with NESTO_TEST_SHELL_DELAYS=1 to hold page sections.");

  test("a held optional section does not hold the page: title, tabs and Priority work arrive, then the counters (S01)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await rule(page, "section-tasks-stats=2500");
    await page.goto("/tasks", { waitUntil: "commit" });
    const main = mainRegion(page);
    await expect(main.locator('[data-section="primary"]')).toBeVisible();
    await expect(main.locator("h1").first()).toBeVisible();
    // The counters are still on their way, in their own placeholder.
    await expect(main.locator('[data-section="stats"]')).toHaveCount(0);
    await expect(main.getByTestId("section-skeleton").first()).toBeVisible();
    await expect(main.locator('[data-section="stats"]')).toBeVisible({ timeout: 10_000 });
    await expect(main.getByTestId("section-skeleton")).toHaveCount(0);
  });

  test("a failed section fails alone, in place, and says so; its siblings render (S03, S14)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await rule(page, "section-tasks-stats=0:fail");
    await page.goto("/tasks");
    const main = mainRegion(page);
    await expect(main.getByTestId("section-error")).toHaveCount(1);
    await expect(main.getByTestId("section-error")).toContainText("Couldn't load this section.");
    await expect(main.locator('[data-section="primary"]')).toBeVisible();
    await expect(main.getByRole("heading", { name: "Your week" })).toBeVisible();
    // Not a whole-page failure, and not a false empty state.
    await expect(main.locator("h1").first()).toHaveText("Tasks");
    await expect(main.locator('[data-section="stats"]')).toHaveCount(0);
  });

  test("Retry is one route refresh however often it is pressed, and the section recovers (S11)", async ({ page }) => {
    await signIn(page, "OWNER", { to: "/dashboard" });
    await rule(page, "section-tasks-stats=0:fail");
    await page.goto("/tasks");
    const main = mainRegion(page);
    await expect(main.getByTestId("section-error")).toBeVisible();
    await page.context().clearCookies({ name: "nesto-test-shell-delay" });

    let refreshes = 0;
    page.on("request", (request) => {
      const headers = request.headers();
      if (headers.rsc === "1" && !headers["next-router-prefetch"] && new URL(request.url()).pathname === "/tasks") refreshes += 1;
    });
    const retry = main.getByTestId("section-retry");
    // Two presses in the same moment: the second joins the first.
    await retry.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(main.locator('[data-section="stats"]')).toBeVisible();
    await expect(main.getByTestId("section-error")).toHaveCount(0);
    expect(refreshes).toBe(1);
  });
});
